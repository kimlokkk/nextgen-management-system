-- Atomic reschedule initiation.
--
-- Replaces the previous multi-request server action (read checks, then insert/reopen a
-- reschedule obligation, then update the booking, with best-effort compensating
-- cleanup whose result was never checked). All checks and both writes now happen
-- in ONE database transaction, serialised per source booking with FOR UPDATE.
--
-- Scope: this changes NO existing rows and adds no data. It adds one function and
-- its execute grants. Apply to Supabase LOCAL / disposable databases first; do not
-- apply to a company cloud project without a separate approved migration review.
--
-- Pattern mirrors public.initiate_replacement_obligation (011/015): SECURITY DEFINER,
-- search_path pinned, active admin/super_admin required, anon and PUBLIC denied.
-- Error messages intentionally match the former TypeScript action so the UI is unchanged.

create or replace function public.initiate_reschedule_obligation(
    p_booking_id uuid,
    p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_booking record;
    v_class record;
    v_existing public.makeup_obligations%rowtype;
    v_obligation_id uuid;
    v_rows integer;
begin
    if v_actor_id is null or not exists (
        select 1
        from public.profiles p
        where p.id = v_actor_id
          and p.is_active = true
          and p.role in ('admin', 'super_admin')
    ) then
        raise exception 'You do not have permission to reschedule students';
    end if;

    if p_booking_id is null or p_session_id is null then
        raise exception 'Invalid reschedule request';
    end if;

    -- Serialise concurrent requests for the same source booking.
    select b.id, b.class_session_id, b.student_id, b.enrollment_id,
           b.booking_type, b.attendance_status
    into v_booking
    from public.student_bookings b
    where b.id = p_booking_id
    for update;

    if not found then
        raise exception 'Student booking not found';
    end if;

    if v_booking.class_session_id <> p_session_id then
        raise exception 'Booking does not belong to this class';
    end if;

    if v_booking.booking_type <> 'regular' then
        raise exception 'Only regular bookings can be rescheduled';
    end if;

    if v_booking.attendance_status <> 'upcoming' then
        raise exception 'Only upcoming bookings can be rescheduled';
    end if;

    select c.class_date, c.status as class_status, sb.status as batch_status
    into v_class
    from public.class_sessions c
    join public.schedule_batches sb on sb.id = c.schedule_batch_id
    where c.id = p_session_id;

    if not found then
        raise exception 'Class session not found';
    end if;

    if v_class.class_status <> 'scheduled' then
        raise exception 'Only scheduled classes can be rescheduled';
    end if;

    -- "Today" is evaluated in Malaysia local time, not the DB server timezone.
    if v_class.class_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then
        raise exception 'Past classes cannot be rescheduled';
    end if;

    if v_class.batch_status <> 'locked' then
        raise exception 'Schedule must be locked before rescheduling students';
    end if;

    -- A new or active replacement must not coexist with a reschedule.
    if exists (
        select 1
        from public.makeup_obligations m
        where m.source_booking_id = p_booking_id
          and m.obligation_type = 'replacement'
          and m.status in ('open', 'scheduled', 'completed')
    ) then
        raise exception 'This booking already has an active replacement obligation';
    end if;

    select *
    into v_existing
    from public.makeup_obligations m
    where m.source_booking_id = p_booking_id
      and m.obligation_type = 'reschedule'
    for update;

    if v_existing.id is not null then
        if v_existing.status <> 'cancelled' then
            raise exception 'This booking already has a makeup obligation';
        end if;

        -- Fail closed: a cancelled obligation that still points at a target booking
        -- must not be silently detached (it would orphan that booking).
        if v_existing.target_booking_id is not null then
            raise exception 'This reschedule cannot be reopened';
        end if;

        update public.makeup_obligations
        set status = 'open',
            target_booking_id = null,
            reason = null,
            created_by = v_actor_id,
            updated_at = now()
        where id = v_existing.id
        returning id into v_obligation_id;
    else
        insert into public.makeup_obligations (
            student_id,
            enrollment_id,
            source_booking_id,
            obligation_type,
            status,
            created_by
        )
        values (
            v_booking.student_id,
            v_booking.enrollment_id,
            p_booking_id,
            'reschedule',
            'open',
            v_actor_id
        )
        returning id into v_obligation_id;
    end if;

    -- Mark the original class as rescheduled (NOT absent).
    update public.student_bookings
    set attendance_status = 'rescheduled',
        updated_at = now()
    where id = p_booking_id
      and attendance_status = 'upcoming';

    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        -- Raising rolls back the obligation insert/reopen above as well.
        raise exception 'Booking status changed before reschedule could be completed';
    end if;

    return v_obligation_id;
end;
$$;

revoke all on function public.initiate_reschedule_obligation(uuid, uuid)
from public, anon;
grant execute on function public.initiate_reschedule_obligation(uuid, uuid)
to authenticated;
