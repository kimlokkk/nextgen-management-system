-- Replacement Engine V1 — Phase 3 lifecycle.
-- Keep all state transitions atomic. Staff authorization is re-checked inside
-- each SECURITY DEFINER RPC. Do not mutate live rows during deployment.

-- A planned absence can be confirmed after the replacement is already attended.
-- Replaces the Phase 1 function to support that cross-date lifecycle.
create or replace function public.initiate_replacement_obligation(
    p_booking_id uuid, p_session_id uuid, p_mode text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_source record;
    v_existing public.makeup_obligations%rowtype;
    v_has_ended boolean;
    v_obligation_id uuid;
begin
    if v_actor_id is null or not exists (
        select 1 from public.profiles p
        where p.id = v_actor_id and p.is_active = true
          and p.role in ('admin', 'super_admin')
    ) then
        raise exception 'You do not have permission to manage replacements';
    end if;

    if p_mode is null or p_mode not in ('planned', 'absent') then
        raise exception 'Invalid replacement mode';
    end if;

    select
        b.id, b.student_id, b.enrollment_id, b.booking_type, b.attendance_status,
        c.class_date, c.end_time, c.status as class_status,
        sb.status as batch_status
    into v_source
    from public.student_bookings b
    join public.class_sessions c on c.id = b.class_session_id
    join public.schedule_batches sb on sb.id = c.schedule_batch_id
    where b.id = p_booking_id and b.class_session_id = p_session_id
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

    if v_source.attendance_status not in ('upcoming','absent') then
        raise exception 'This booking cannot initiate a replacement';
    end if;

    v_has_ended := (v_source.class_date + v_source.end_time)
        <= (now() at time zone 'Asia/Kuala_Lumpur');

    if p_mode = 'planned' then
        if v_has_ended then
            raise exception 'Class already ended; confirm absence instead';
        end if;
        if v_source.attendance_status <> 'upcoming' then
            raise exception 'Only upcoming bookings can plan a replacement';
        end if;
    elsif not v_has_ended then
        raise exception 'Cannot confirm absence before class ends';
    end if;

    select * into v_existing
    from public.makeup_obligations m
    where m.source_booking_id = p_booking_id for update;

    if v_existing.id is not null then
        if v_existing.obligation_type <> 'replacement' then
            raise exception 'This booking already has a reschedule obligation';
        end if;

        if v_existing.status in ('open', 'scheduled', 'completed') then
            if p_mode = 'absent' and v_source.attendance_status = 'upcoming' then
                update public.student_bookings
                set attendance_status = 'absent', updated_at = now()
                where id = p_booking_id;
                return v_existing.id;
            end if;
            raise exception 'This booking already has an active or completed replacement';
        end if;

        if v_existing.status <> 'cancelled'
            or v_existing.target_booking_id is not null then
            raise exception 'This replacement cannot be reopened';
        end if;

        update public.makeup_obligations
        set status = 'open', target_booking_id = null, reason = null,
            created_by = v_actor_id, updated_at = now()
        where id = v_existing.id returning id into v_obligation_id;
    else
        insert into public.makeup_obligations (
            student_id, enrollment_id, source_booking_id,
            obligation_type, status, created_by
        ) values (
            v_source.student_id, v_source.enrollment_id, p_booking_id,
            'replacement', 'open', v_actor_id
        ) returning id into v_obligation_id;
    end if;

    if p_mode = 'absent' and v_source.attendance_status = 'upcoming' then
        update public.student_bookings
        set attendance_status = 'absent', updated_at = now()
        where id = p_booking_id;
    end if;
    return v_obligation_id;
end;
$$;
revoke all on function public.initiate_replacement_obligation(uuid,uuid,text)
    from public, anon;
grant execute on function public.initiate_replacement_obligation(uuid,uuid,text)
    to authenticated;

-- Change a scheduled replacement into another yellow slot; reuse its booking ID.
-- An UPDATE preserves referential integrity, cannot leave an orphan, and rolls
-- back completely if the new slot fails any check.
create or replace function public.change_replacement_slot(
    p_obligation_id uuid, p_target_session_id uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_obligation public.makeup_obligations%rowtype;
    v_current public.student_bookings%rowtype;
    v_old record;
    v_source record;
    v_target record;
    v_local_now timestamp := now() at time zone 'Asia/Kuala_Lumpur';
    v_occupied integer;
begin
    if v_actor_id is null or not exists (
        select 1 from public.profiles p where p.id = v_actor_id
        and p.is_active = true and p.role in ('admin','super_admin')
    ) then
        raise exception 'You do not have permission to change replacements';
    end if;

    select * into v_obligation from public.makeup_obligations
    where id = p_obligation_id for update;
    if not found or v_obligation.obligation_type <> 'replacement' then
        raise exception 'Replacement obligation not found';
    end if;
    if v_obligation.status <> 'scheduled'
       or v_obligation.target_booking_id is null then
        raise exception 'Only scheduled replacements can change slots';
    end if;

    perform 1 from public.students s
        where s.id = v_obligation.student_id for update;
    if not found then raise exception 'Student not found'; end if;

    select * into v_current from public.student_bookings
    where id = v_obligation.target_booking_id for update;
    if not found
       or v_current.student_id <> v_obligation.student_id
       or v_current.booking_type <> 'replacement'
       or v_current.attendance_status <> 'upcoming' then
        raise exception 'Assigned booking must be an upcoming replacement';
    end if;

    select c.class_date,c.start_time,c.status,sb.status as batch_status
    into v_old from public.class_sessions c
    join public.schedule_batches sb on sb.id=c.schedule_batch_id
    where c.id=v_current.class_session_id;
    if not found or v_old.status <> 'scheduled' or v_old.batch_status <> 'locked'
       or (v_old.class_date + v_old.start_time) <= v_local_now then
        raise exception 'Cannot move a replacement after its class starts';
    end if;

    select b.student_id,b.booking_type,b.attendance_status,
        c.id as class_id,c.branch_id,c.programme_id,c.session_template_id,
        c.class_date,c.start_time,c.end_time,c.status as class_status,
        sb.status as batch_status
    into v_source from public.student_bookings b
    join public.class_sessions c on c.id=b.class_session_id
    join public.schedule_batches sb on sb.id=c.schedule_batch_id
    where b.id=v_obligation.source_booking_id;
    if not found or v_source.student_id <> v_obligation.student_id
       or v_source.booking_type <> 'regular'
       or v_source.attendance_status not in ('upcoming','absent')
       or v_source.class_status <> 'scheduled'
       or v_source.batch_status <> 'locked' then
        raise exception 'Original booking is no longer eligible';
    end if;

    select c.*,sb.status as batch_status into v_target
    from public.class_sessions c
    join public.schedule_batches sb on sb.id=c.schedule_batch_id
    where c.id=p_target_session_id for update of c;
    if not found then raise exception 'Target class not found'; end if;
    if v_target.id=v_current.class_session_id then
        raise exception 'Choose a different yellow slot';
    end if;
    if v_target.id=v_source.class_id
       or v_target.branch_id <> v_source.branch_id
       or v_target.programme_id <> v_source.programme_id then
        raise exception 'Target class must belong to the original branch and programme';
    end if;
    if v_target.status <> 'scheduled' or v_target.batch_status <> 'locked'
       or (v_target.class_date + v_target.start_time) <= v_local_now then
        raise exception 'Target must be a future scheduled class in a locked batch';
    end if;

    if v_target.session_template_id=v_source.session_template_id
       or (
          extract(dow from v_target.class_date)=extract(dow from v_source.class_date)
          and v_target.start_time < v_source.end_time
          and v_source.start_time < v_target.end_time
       ) then
        raise exception 'Replacement cannot take the student own regular session time';
    end if;

    if exists (
        select 1 from public.enrollments e
        join public.session_templates t on t.id=e.default_session_id
        where e.student_id=v_obligation.student_id
          and e.branch_id=v_source.branch_id and e.programme_id=v_source.programme_id
          and e.status in ('active','paused')
          and t.day_of_week=extract(dow from v_target.class_date)
          and v_target.start_time < t.end_time
          and t.start_time < v_target.end_time
    ) then
        raise exception 'Target overlaps the student current regular class time';
    end if;

    if exists (
        select 1 from public.student_bookings b
        where b.class_session_id=v_target.id
          and b.student_id=v_obligation.student_id
          and b.id <> v_current.id
    ) then
        raise exception 'Student already has a booking in the target class';
    end if;
    if exists (
        select 1 from public.student_bookings b
        join public.class_sessions c on c.id=b.class_session_id
        where b.student_id=v_obligation.student_id
          and b.id <> v_current.id
          and b.attendance_status not in ('rescheduled','cancelled','not_scheduled')
          and c.class_date=v_target.class_date
          and c.start_time < v_target.end_time
          and v_target.start_time < c.end_time
    ) then
        raise exception 'Student already has an overlapping class';
    end if;

    select count(*) into v_occupied from public.student_bookings b
    where b.class_session_id=v_target.id
      and b.booking_type='replacement'
      and b.attendance_status not in ('cancelled','not_scheduled');
    if v_occupied >= v_target.replacement_capacity then
        raise exception 'No replacement (yellow) seats remain in target class';
    end if;

    update public.student_bookings
    set class_session_id=v_target.id, updated_at=now()
    where id=v_current.id;
    update public.makeup_obligations
    set updated_at=now() where id=v_obligation.id;

    return v_current.id;
end;
$$;
revoke all on function public.change_replacement_slot(uuid,uuid)
    from public, anon;
grant execute on function public.change_replacement_slot(uuid,uuid)
    to authenticated;

-- 'release': give back the yellow seat and keep entitlement OPEN.
-- 'cancel': abandon the entitlement and give back the seat (if assigned).
-- Never rewrite the original regular class attendance.
create or replace function public.cancel_replacement(
    p_obligation_id uuid, p_mode text, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_obligation public.makeup_obligations%rowtype;
    v_booking public.student_bookings%rowtype;
    v_class record;
    v_local_now timestamp := now() at time zone 'Asia/Kuala_Lumpur';
begin
    if v_actor_id is null or not exists (
        select 1 from public.profiles p where p.id=v_actor_id
        and p.is_active=true and p.role in ('admin','super_admin')
    ) then
        raise exception 'You do not have permission to cancel replacements';
    end if;
    if p_mode not in ('release','cancel') or p_mode is null then
        raise exception 'Invalid cancellation mode';
    end if;
    select * into v_obligation from public.makeup_obligations
    where id=p_obligation_id for update;
    if not found or v_obligation.obligation_type <> 'replacement' then
        raise exception 'Replacement obligation not found';
    end if;
    if v_obligation.status not in ('open','scheduled') then
        raise exception 'Only open or scheduled replacements can be cancelled';
    end if;
    if p_mode='release' and v_obligation.status <> 'scheduled' then
        raise exception 'Only an assigned replacement slot can be released';
    end if;

    perform 1 from public.students s
    where s.id=v_obligation.student_id for update;
    if not found then raise exception 'Student not found'; end if;

    if v_obligation.status='scheduled' then
        if v_obligation.target_booking_id is null then
            raise exception 'Scheduled replacement has no target booking';
        end if;
        select * into v_booking from public.student_bookings
        where id=v_obligation.target_booking_id for update;
        if not found or v_booking.booking_type <> 'replacement'
            or v_booking.student_id <> v_obligation.student_id
            or v_booking.attendance_status <> 'upcoming' then
            raise exception 'Only an upcoming assigned replacement can be released';
        end if;
        select c.class_date,c.start_time,c.status,sb.status as batch_status
        into v_class from public.class_sessions c
        join public.schedule_batches sb on sb.id=c.schedule_batch_id
        where c.id=v_booking.class_session_id for update of c;
        if not found or v_class.status <> 'scheduled'
            or v_class.batch_status <> 'locked'
            or (v_class.class_date + v_class.start_time) <= v_local_now then
            raise exception 'Cannot cancel an assigned replacement after class starts';
        end if;

        -- Detach first, then delete the unused target booking. This releases
        -- the yellow capacity and allows rebooking the same class later.
        update public.makeup_obligations
        set target_booking_id=null,
            status=case when p_mode='cancel' then 'cancelled' else 'open' end,
            reason=coalesce(nullif(btrim(p_reason),''),reason),
            updated_at=now()
        where id=v_obligation.id;
        delete from public.student_bookings where id=v_booking.id;
    else
        update public.makeup_obligations
        set status='cancelled',
            reason=coalesce(nullif(btrim(p_reason),''),reason),
            updated_at=now()
        where id=v_obligation.id;
    end if;
    return v_obligation.id;
end;
$$;
revoke all on function public.cancel_replacement(uuid,text,text)
    from public, anon;
grant execute on function public.cancel_replacement(uuid,text,text)
    to authenticated;

-- Completion requires confirmed attendance AFTER the target class ends.
-- This does not change the source attendance: the original class could be
-- later in the calendar, in which case absence is confirmed separately.
create or replace function public.complete_replacement(
    p_obligation_id uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_obligation public.makeup_obligations%rowtype;
    v_booking public.student_bookings%rowtype;
    v_target record;
    v_local_now timestamp := now() at time zone 'Asia/Kuala_Lumpur';
begin
    if v_actor_id is null or not exists (
        select 1 from public.profiles p where p.id=v_actor_id
        and p.is_active=true and p.role in ('admin','super_admin')
    ) then
        raise exception 'You do not have permission to complete replacements';
    end if;
    select * into v_obligation from public.makeup_obligations
    where id=p_obligation_id for update;
    if not found or v_obligation.obligation_type <> 'replacement' then
        raise exception 'Replacement obligation not found';
    end if;
    if v_obligation.status <> 'scheduled'
       or v_obligation.target_booking_id is null then
        raise exception 'Only scheduled replacements can be completed';
    end if;
    perform 1 from public.students s where s.id=v_obligation.student_id for update;
    if not found then raise exception 'Student not found'; end if;

    select * into v_booking from public.student_bookings
    where id=v_obligation.target_booking_id for update;
    if not found or v_booking.booking_type <> 'replacement'
       or v_booking.student_id <> v_obligation.student_id
       or v_booking.attendance_status <> 'upcoming' then
        raise exception 'Assigned replacement is not awaiting attendance';
    end if;
    select c.class_date,c.end_time,c.status,sb.status as batch_status
    into v_target from public.class_sessions c
    join public.schedule_batches sb on sb.id=c.schedule_batch_id
    where c.id=v_booking.class_session_id;
    if not found or v_target.status <> 'scheduled'
       or v_target.batch_status <> 'locked' then
        raise exception 'Replacement class must belong to a locked scheduled batch';
    end if;
    if (v_target.class_date+v_target.end_time)>v_local_now then
        raise exception 'Cannot confirm attendance before replacement class ends';
    end if;

    update public.student_bookings
    set attendance_status='present', updated_at=now()
    where id=v_booking.id;
    update public.makeup_obligations
    set status='completed', updated_at=now()
    where id=v_obligation.id;
    return v_booking.id;
end;
$$;
revoke all on function public.complete_replacement(uuid)
    from public, anon;
grant execute on function public.complete_replacement(uuid)
    to authenticated;
