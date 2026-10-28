-- Replacement Engine V1, Phase 1
-- An absence can be planned before class end; it becomes confirmed after class end.
-- The source regular booking always retains its regular capacity allocation.

create or replace function public.initiate_replacement_obligation(
    p_booking_id uuid,
    p_session_id uuid,
    p_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_source record;
    v_existing public.makeup_obligations%rowtype;
    v_has_ended boolean;
    v_obligation_id uuid;
begin
    if v_actor_id is null or not exists (
        select 1
        from public.profiles p
        where p.id = v_actor_id
          and p.is_active = true
          and p.role in ('admin', 'super_admin')
    ) then
        raise exception 'You do not have permission to manage replacements';
    end if;

    if p_mode is null or p_mode not in ('planned', 'absent') then
        raise exception 'Invalid replacement mode';
    end if;

    -- Serialise concurrent requests for the same source booking.
    select
        b.id,
        b.student_id,
        b.enrollment_id,
        b.booking_type,
        b.attendance_status,
        c.class_date,
        c.end_time,
        c.status as class_status,
        sb.status as batch_status
    into v_source
    from public.student_bookings b
    join public.class_sessions c on c.id = b.class_session_id
    join public.schedule_batches sb on sb.id = c.schedule_batch_id
    where b.id = p_booking_id
      and b.class_session_id = p_session_id
    for update of b;

    if not found then
        raise exception 'Source booking or class was not found';
    end if;

    if v_source.booking_type <> 'regular' then
        raise exception 'Only regular bookings can initiate replacements';
    end if;

    if v_source.class_status <> 'scheduled'
       or v_source.batch_status <> 'locked' then
        raise exception 'Source class must be scheduled in a locked batch';
    end if;

    if v_source.attendance_status not in ('upcoming', 'absent') then
        raise exception 'This booking cannot initiate a replacement';
    end if;

    -- Class end is evaluated in Malaysia local time, not the DB server timezone.
    v_has_ended := (v_source.class_date + v_source.end_time)
        <= (now() at time zone 'Asia/Kuala_Lumpur');

    if p_mode = 'planned' then
        if v_has_ended then
            raise exception 'Class already ended; confirm absence instead';
        end if;
        if v_source.attendance_status <> 'upcoming' then
            raise exception 'Only upcoming bookings can plan a replacement';
        end if;
    else
        if not v_has_ended then
            raise exception 'Cannot confirm absence before class ends';
        end if;
    end if;

    select *
    into v_existing
    from public.makeup_obligations m
    where m.source_booking_id = p_booking_id
    for update;

    if v_existing.id is not null then
        if v_existing.obligation_type <> 'replacement' then
            raise exception 'This booking already has a reschedule obligation';
        end if;

        if v_existing.status in ('open', 'scheduled') then
            -- Previously planned absence; confirming later must reuse its obligation,
            -- even when a replacement class was already assigned.
            if p_mode = 'absent'
               and v_source.attendance_status = 'upcoming' then
                update public.student_bookings
                set attendance_status = 'absent',
                    updated_at = now()
                where id = p_booking_id;
                return v_existing.id;
            end if;

            raise exception 'This booking already has an active replacement';
        end if;

        if v_existing.status <> 'cancelled'
           or v_existing.target_booking_id is not null then
            raise exception 'This replacement cannot be reopened';
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
            v_source.student_id,
            v_source.enrollment_id,
            p_booking_id,
            'replacement',
            'open',
            v_actor_id
        )
        returning id into v_obligation_id;
    end if;

    if p_mode = 'absent'
       and v_source.attendance_status = 'upcoming' then
        update public.student_bookings
        set attendance_status = 'absent',
            updated_at = now()
        where id = p_booking_id;
    end if;

    return v_obligation_id;
end;
$$;

revoke all on function public.initiate_replacement_obligation(uuid, uuid, text)
from public, anon;
grant execute on function public.initiate_replacement_obligation(uuid, uuid, text)
to authenticated;
