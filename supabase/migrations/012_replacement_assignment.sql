-- Replacement Engine V1, Phase 2
-- Assigns an open replacement to a yellow seat in a locked schedule.
-- This RPC is the authoritative validator; UI candidate filters are advisory.

create or replace function public.assign_replacement_obligation(
    p_obligation_id uuid,
    p_target_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_obligation public.makeup_obligations%rowtype;
    v_source record;
    v_target record;
    v_regular_template record;
    v_occupied integer;
    v_target_booking_id uuid;
    v_local_now timestamp := now() at time zone 'Asia/Kuala_Lumpur';
begin
    if v_actor_id is null or not exists (
        select 1
        from public.profiles p
        where p.id = v_actor_id
          and p.is_active = true
          and p.role in ('admin', 'super_admin')
    ) then
        raise exception 'You do not have permission to assign replacements';
    end if;

    -- The obligation and student locks serialize competing assignments.
    select *
    into v_obligation
    from public.makeup_obligations m
    where m.id = p_obligation_id
    for update;

    if not found or v_obligation.obligation_type <> 'replacement' then
        raise exception 'Replacement obligation not found';
    end if;

    if v_obligation.status <> 'open'
       or v_obligation.target_booking_id is not null then
        raise exception 'Only open, unassigned replacements can be assigned';
    end if;

    perform 1 from public.students s
    where s.id = v_obligation.student_id
    for update;
    if not found then
        raise exception 'Student not found';
    end if;

    select
        b.student_id,
        b.booking_type,
        b.attendance_status,
        c.id as class_id,
        c.branch_id,
        c.programme_id,
        c.session_template_id,
        c.class_date,
        c.start_time,
        c.end_time,
        c.status as class_status,
        sb.status as batch_status
    into v_source
    from public.student_bookings b
    join public.class_sessions c on c.id = b.class_session_id
    join public.schedule_batches sb on sb.id = c.schedule_batch_id
    where b.id = v_obligation.source_booking_id;

    if not found
       or v_source.student_id <> v_obligation.student_id
       or v_source.booking_type <> 'regular'
       or v_source.attendance_status not in ('upcoming', 'absent') then
        raise exception 'Replacement source booking is no longer eligible';
    end if;

    if v_source.class_status <> 'scheduled'
       or v_source.batch_status <> 'locked' then
        raise exception 'Original class must belong to a locked schedule';
    end if;

    -- Serializes concurrent replacement assignments to the same class.
    select c.*, sb.status as batch_status
    into v_target
    from public.class_sessions c
    join public.schedule_batches sb on sb.id = c.schedule_batch_id
    where c.id = p_target_session_id
    for update of c;

    if not found then
        raise exception 'Target class not found';
    end if;

    if v_target.id = v_source.class_id then
        raise exception 'Cannot assign a replacement to its original class';
    end if;

    if v_target.branch_id <> v_source.branch_id
       or v_target.programme_id <> v_source.programme_id then
        raise exception 'Replacement must stay within the original branch and programme';
    end if;

    if v_target.status <> 'scheduled' or v_target.batch_status <> 'locked' then
        raise exception 'Target class must belong to a locked, scheduled batch';
    end if;

    if (v_target.class_date + v_target.start_time) <= v_local_now then
        raise exception 'Cannot assign a replacement to a started or past class';
    end if;

    -- For recurring own regular class, also block a parallel template
    -- scheduled at the same weekday and overlapping time.
    if v_target.session_template_id = v_source.session_template_id
       or (
         extract(dow from v_target.class_date) = extract(dow from v_source.class_date)
         and v_target.start_time < v_source.end_time
         and v_source.start_time < v_target.end_time
       ) then
        raise exception 'Replacement cannot take the student own regular session time';
    end if;

    -- If their active regular enrollment changed since the source class,
    -- still protect the currently registered weekly timeslot.
    if exists (
        select 1
        from public.enrollments e
        join public.session_templates t on t.id = e.default_session_id
        where e.student_id = v_obligation.student_id
          and e.branch_id = v_source.branch_id
          and e.programme_id = v_source.programme_id
          and e.status in ('active', 'paused')
          and t.day_of_week = extract(dow from v_target.class_date)
          and v_target.start_time < t.end_time
          and t.start_time < v_target.end_time
    ) then
        raise exception 'Target overlaps the student current regular class time';
    end if;

    -- A unique (class_session_id,student_id) constraint also protects this.
    if exists (
        select 1 from public.student_bookings b
        where b.class_session_id = v_target.id
          and b.student_id = v_obligation.student_id
    ) then
        raise exception 'Student already has a booking in the target class';
    end if;

    -- Prevent overlapping sessions across branch/programme boundaries.
    if exists (
        select 1
        from public.student_bookings b
        join public.class_sessions c on c.id = b.class_session_id
        where b.student_id = v_obligation.student_id
          and b.attendance_status not in ('rescheduled', 'cancelled', 'not_scheduled')
          and c.class_date = v_target.class_date
          and c.start_time < v_target.end_time
          and v_target.start_time < c.end_time
    ) then
        raise exception 'Student already has an overlapping class';
    end if;

    select count(*) into v_occupied
    from public.student_bookings b
    where b.class_session_id = v_target.id
      and b.booking_type = 'replacement'
      and b.attendance_status not in ('cancelled', 'not_scheduled');

    if v_occupied >= v_target.replacement_capacity then
        raise exception 'No replacement (yellow) seats remain in target class';
    end if;

    insert into public.student_bookings (
        class_session_id,
        student_id,
        enrollment_id,
        booking_type,
        attendance_status
    ) values (
        v_target.id,
        v_obligation.student_id,
        v_obligation.enrollment_id,
        'replacement',
        'upcoming'
    )
    returning id into v_target_booking_id;

    update public.makeup_obligations
    set status = 'scheduled',
        target_booking_id = v_target_booking_id,
        updated_at = now()
    where id = v_obligation.id;

    return v_target_booking_id;
end;
$$;

revoke all on function public.assign_replacement_obligation(uuid, uuid)
from public, anon;
grant execute on function public.assign_replacement_obligation(uuid, uuid)
to authenticated;
