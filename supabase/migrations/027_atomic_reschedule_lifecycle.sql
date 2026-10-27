-- Atomic reschedule lifecycle: assign to a slot, reopen an assignment, cancel a reschedule.
--
-- Replaces three multi-request server actions (reschedules/[id]/actions.ts) that read state,
-- wrote several tables one request at a time, and tried to undo partial work with
-- unchecked compensating writes. Most importantly, capacity was checked by reading booking
-- rows and inserting afterwards, so two admins acting at the same moment could both pass the
-- check and overfill a class. Nothing in the database enforced regular capacity for
-- 'reschedule' bookings (migration 019 only guards yellow/replacement seats).
--
-- Each function now runs in ONE transaction. Locks are always taken in the same order
-- (source booking -> obligation -> class row whose capacity changes -> target booking), which
-- matches initiate_reschedule_obligation (025). Locking the class row serialises concurrent
-- capacity-changing requests for that class.
--
-- Adds three functions and their execute grants only; no rows are read into or changed by the
-- migration itself. Error messages match the former TypeScript so the UI is unchanged.
-- Apply to Supabase LOCAL / disposable databases first; company cloud only with approval.

-- ---------------------------------------------------------------------------------------
-- assign_reschedule_slot: create the target booking and mark the obligation scheduled.
-- ---------------------------------------------------------------------------------------
create or replace function public.assign_reschedule_slot(
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
    v_ob public.makeup_obligations%rowtype;
    v_src record;
    v_orig record;
    v_target record;
    v_batch_status text;
    v_occupied integer;
    v_new_booking_id uuid;
    v_rows integer;
begin
    if v_actor_id is null or not exists (
        select 1 from public.profiles p
        where p.id = v_actor_id and p.is_active = true
          and p.role in ('admin', 'super_admin')
    ) then
        raise exception 'You do not have permission to assign reschedules';
    end if;

    if p_obligation_id is null or p_target_session_id is null then
        raise exception 'Invalid reschedule assignment';
    end if;

    select * into v_ob from public.makeup_obligations where id = p_obligation_id;
    if not found then
        raise exception 'Reschedule obligation not found';
    end if;

    -- Lock order: source booking, then obligation.
    select b.id, b.class_session_id, b.attendance_status
    into v_src
    from public.student_bookings b
    where b.id = v_ob.source_booking_id
    for update;
    if not found then
        raise exception 'Original booking not found';
    end if;

    select * into v_ob from public.makeup_obligations where id = p_obligation_id for update;
    if not found then
        raise exception 'Reschedule obligation not found';
    end if;

    if v_ob.obligation_type <> 'reschedule' then
        raise exception 'This obligation is not a reschedule';
    end if;
    if v_ob.status <> 'open' then
        raise exception 'Only open reschedules can be assigned';
    end if;
    if v_ob.target_booking_id is not null then
        raise exception 'This reschedule already has a target booking';
    end if;
    if v_src.attendance_status <> 'rescheduled' then
        raise exception 'Original booking is not marked as rescheduled';
    end if;

    select c.id, c.branch_id, c.programme_id
    into v_orig
    from public.class_sessions c
    where c.id = v_src.class_session_id;
    if not found then
        raise exception 'Original class not found';
    end if;

    -- Lock the target class row: concurrent assignments into the same class are serialised.
    select c.id, c.schedule_batch_id, c.branch_id, c.programme_id,
           c.class_date, c.regular_capacity, c.status
    into v_target
    from public.class_sessions c
    where c.id = p_target_session_id
    for update;
    if not found then
        raise exception 'Target class not found';
    end if;

    if v_target.id = v_orig.id then
        raise exception 'Student cannot be rescheduled into the original class';
    end if;
    if v_target.branch_id <> v_orig.branch_id then
        raise exception 'Reschedule must remain in the same branch';
    end if;
    if v_target.programme_id <> v_orig.programme_id then
        raise exception 'Reschedule must remain in the same programme';
    end if;
    if v_target.status <> 'scheduled' then
        raise exception 'Target class is not scheduled';
    end if;
    if v_target.class_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then
        raise exception 'Cannot assign a reschedule to a past class';
    end if;

    select sb.status into v_batch_status
    from public.schedule_batches sb
    where sb.id = v_target.schedule_batch_id;
    if v_batch_status is distinct from 'locked' then
        raise exception 'Target schedule must be locked';
    end if;

    if exists (
        select 1 from public.student_bookings b
        where b.class_session_id = v_target.id and b.student_id = v_ob.student_id
    ) then
        raise exception 'Student already has a booking in this class';
    end if;

    -- Provisional V1 policy (unchanged): a reschedule uses vacant REGULAR capacity.
    select count(*) into v_occupied
    from public.student_bookings b
    where b.class_session_id = v_target.id
      and b.booking_type in ('regular', 'reschedule')
      and b.attendance_status not in ('rescheduled', 'cancelled', 'not_scheduled');
    if v_occupied >= v_target.regular_capacity then
        raise exception 'Target class has no vacant regular capacity';
    end if;

    insert into public.student_bookings (
        class_session_id, student_id, enrollment_id, booking_type, attendance_status
    )
    values (
        v_target.id, v_ob.student_id, v_ob.enrollment_id, 'reschedule', 'upcoming'
    )
    returning id into v_new_booking_id;

    update public.makeup_obligations
    set status = 'scheduled',
        target_booking_id = v_new_booking_id,
        updated_at = now()
    where id = p_obligation_id and status = 'open';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        raise exception 'Reschedule status changed before assignment completed';
    end if;

    return v_new_booking_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- reopen_reschedule_assignment: release the target booking, obligation returns to open.
-- ---------------------------------------------------------------------------------------
create or replace function public.reopen_reschedule_assignment(p_obligation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_ob public.makeup_obligations%rowtype;
    v_src_id uuid;
    v_tb record;
    v_tc record;
    v_rows integer;
begin
    if v_actor_id is null or not exists (
        select 1 from public.profiles p
        where p.id = v_actor_id and p.is_active = true
          and p.role in ('admin', 'super_admin')
    ) then
        raise exception 'You do not have permission to reassign reschedules';
    end if;

    if p_obligation_id is null then
        raise exception 'Invalid reschedule request';
    end if;

    select * into v_ob from public.makeup_obligations where id = p_obligation_id;
    if not found then
        raise exception 'Reschedule obligation not found';
    end if;

    select b.id into v_src_id
    from public.student_bookings b
    where b.id = v_ob.source_booking_id
    for update;
    if not found then
        raise exception 'Original booking not found';
    end if;

    select * into v_ob from public.makeup_obligations where id = p_obligation_id for update;
    if not found then
        raise exception 'Reschedule obligation not found';
    end if;

    if v_ob.obligation_type <> 'reschedule' then
        raise exception 'This obligation is not a reschedule';
    end if;
    if v_ob.status <> 'scheduled' then
        raise exception 'Only scheduled reschedules can be reassigned';
    end if;
    if v_ob.target_booking_id is null then
        raise exception 'This reschedule does not have an assigned booking';
    end if;

    select b.id, b.class_session_id, b.booking_type, b.attendance_status
    into v_tb
    from public.student_bookings b
    where b.id = v_ob.target_booking_id
    for update;
    if not found then
        raise exception 'Assigned booking could not be found';
    end if;
    if v_tb.booking_type <> 'reschedule' then
        raise exception 'Assigned booking is not a reschedule booking';
    end if;
    if v_tb.attendance_status <> 'upcoming' then
        raise exception 'Only upcoming reschedule bookings can be reassigned';
    end if;

    select c.id, c.class_date, c.status
    into v_tc
    from public.class_sessions c
    where c.id = v_tb.class_session_id;
    if not found then
        raise exception 'Assigned class could not be found';
    end if;
    if v_tc.status <> 'scheduled' then
        raise exception 'Assigned class is no longer scheduled';
    end if;
    if v_tc.class_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then
        raise exception 'A past reschedule cannot be reassigned';
    end if;

    -- Detach first (the obligation references the booking), then remove the booking.
    update public.makeup_obligations
    set status = 'open',
        target_booking_id = null,
        updated_at = now()
    where id = p_obligation_id
      and status = 'scheduled'
      and target_booking_id = v_tb.id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        raise exception 'Reschedule status changed before reassignment';
    end if;

    delete from public.student_bookings where id = v_tb.id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        raise exception 'Assigned booking could not be removed';
    end if;

    return p_obligation_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- cancel_reschedule: restore the original seat, cancel the obligation, drop any target booking.
-- ---------------------------------------------------------------------------------------
create or replace function public.cancel_reschedule(p_obligation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_ob public.makeup_obligations%rowtype;
    v_prev_status text;
    v_src record;
    v_oc record;
    v_batch_status text;
    v_occupied integer;
    v_tb record;
    v_tc record;
    v_rows integer;
begin
    if v_actor_id is null or not exists (
        select 1 from public.profiles p
        where p.id = v_actor_id and p.is_active = true
          and p.role in ('admin', 'super_admin')
    ) then
        raise exception 'You do not have permission to cancel reschedules';
    end if;

    if p_obligation_id is null then
        raise exception 'Invalid cancel reschedule request';
    end if;

    select * into v_ob from public.makeup_obligations where id = p_obligation_id;
    if not found then
        raise exception 'Reschedule obligation not found';
    end if;

    select b.id, b.class_session_id, b.booking_type, b.attendance_status
    into v_src
    from public.student_bookings b
    where b.id = v_ob.source_booking_id
    for update;
    if not found then
        raise exception 'Original booking not found';
    end if;

    select * into v_ob from public.makeup_obligations where id = p_obligation_id for update;
    if not found then
        raise exception 'Reschedule obligation not found';
    end if;

    if v_ob.obligation_type <> 'reschedule' then
        raise exception 'This obligation is not a reschedule';
    end if;
    if v_ob.status not in ('open', 'scheduled') then
        raise exception 'Only open or scheduled reschedules can be cancelled';
    end if;
    v_prev_status := v_ob.status;

    if v_src.booking_type <> 'regular' then
        raise exception 'Original booking is not a regular booking';
    end if;
    if v_src.attendance_status <> 'rescheduled' then
        raise exception 'Original booking is not marked as rescheduled';
    end if;

    -- Lock the original class row: restoring the seat changes its occupancy, so concurrent
    -- assignments into / cancellations for the same class are serialised.
    select c.id, c.schedule_batch_id, c.class_date, c.regular_capacity, c.status
    into v_oc
    from public.class_sessions c
    where c.id = v_src.class_session_id
    for update;
    if not found then
        raise exception 'Original class not found';
    end if;
    if v_oc.status <> 'scheduled' then
        raise exception 'Original class is no longer scheduled';
    end if;
    if v_oc.class_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then
        raise exception 'A past reschedule cannot be cancelled back to the original class';
    end if;

    -- The student's old seat may have been taken by another incoming reschedule.
    select count(*) into v_occupied
    from public.student_bookings b
    where b.class_session_id = v_oc.id
      and b.booking_type in ('regular', 'reschedule')
      and b.attendance_status not in ('rescheduled', 'cancelled', 'not_scheduled');
    if v_occupied >= v_oc.regular_capacity then
        raise exception 'Original class no longer has a vacant regular seat';
    end if;

    select sb.status into v_batch_status
    from public.schedule_batches sb
    where sb.id = v_oc.schedule_batch_id;
    if v_batch_status is distinct from 'locked' then
        raise exception 'Original schedule must be locked';
    end if;

    if v_prev_status = 'scheduled' then
        if v_ob.target_booking_id is null then
            raise exception 'Scheduled reschedule has no target booking';
        end if;

        select b.id, b.class_session_id, b.booking_type, b.attendance_status
        into v_tb
        from public.student_bookings b
        where b.id = v_ob.target_booking_id
        for update;
        if not found then
            raise exception 'Assigned booking could not be found';
        end if;
        if v_tb.booking_type <> 'reschedule' then
            raise exception 'Assigned booking is not a reschedule booking';
        end if;
        if v_tb.attendance_status <> 'upcoming' then
            raise exception 'Only upcoming reschedule bookings can be cancelled';
        end if;

        select c.id, c.class_date into v_tc
        from public.class_sessions c
        where c.id = v_tb.class_session_id;
        if not found then
            raise exception 'Assigned class could not be found';
        end if;
        if v_tc.class_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then
            raise exception 'A reschedule with a past assigned class cannot be cancelled';
        end if;
    end if;

    -- Writes: every failure below raises and rolls the whole transaction back.
    update public.student_bookings
    set attendance_status = 'upcoming', updated_at = now()
    where id = v_src.id and attendance_status = 'rescheduled';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        raise exception 'Original booking could not be restored';
    end if;

    update public.makeup_obligations
    set status = 'cancelled', target_booking_id = null, updated_at = now()
    where id = p_obligation_id and status = v_prev_status;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        raise exception 'Reschedule status changed before cancellation completed';
    end if;

    if v_prev_status = 'scheduled' then
        delete from public.student_bookings where id = v_tb.id;
        get diagnostics v_rows = row_count;
        if v_rows <> 1 then
            raise exception 'Assigned booking could not be removed';
        end if;
    end if;

    return p_obligation_id;
end;
$$;

revoke all on function public.assign_reschedule_slot(uuid, uuid) from public, anon;
revoke all on function public.reopen_reschedule_assignment(uuid) from public, anon;
revoke all on function public.cancel_reschedule(uuid) from public, anon;
grant execute on function public.assign_reschedule_slot(uuid, uuid) to authenticated;
grant execute on function public.reopen_reschedule_assignment(uuid) to authenticated;
grant execute on function public.cancel_reschedule(uuid) to authenticated;
