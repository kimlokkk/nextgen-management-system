-- Phase 3 runs AFTER the Phase 1+2 smoke tests, within the same test DB.
-- All fixtures use a disposable PostgreSQL service in GitHub Actions.
set test.actor = '00000000-0000-4000-8000-000000000001';

insert into public.class_sessions (
    id, schedule_batch_id, session_template_id, branch_id, programme_id,
    class_date, start_time, end_time, status, replacement_capacity
) values
    ('70000000-0000-4000-8000-000000000006',
     '60000000-0000-4000-8000-000000000002',
     '40000000-0000-4000-8000-000000000002',
     '10000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001',
     (date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date + interval '1 month 21 days')::date,
     '12:00','13:00','scheduled',1);

do $$
declare
    o1 uuid;
    o2 uuid;
    b1 uuid;
    b2 uuid;
    next_booking uuid;
    result_id uuid;
    rejected boolean;
begin
    select id into o1 from public.makeup_obligations
    where source_booking_id = '80000000-0000-4000-8000-000000000001';
    select id into o2 from public.makeup_obligations
    where source_booking_id = '80000000-0000-4000-8000-000000000002';
    select target_booking_id into b1 from public.makeup_obligations where id=o1;
    select target_booking_id into b2 from public.makeup_obligations where id=o2;
    if b1 is null or b2 is null then
        raise exception 'Phase 2 tests must assign both replacements first';
    end if;

    rejected:=false;
    begin
        perform public.change_replacement_slot(o1,'70000000-0000-4000-8000-000000000005');
    exception when others then
        if SQLERRM like '%No replacement (yellow) seats remain%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Change slot overbooked occupied yellow seat'; end if;
    if (select class_session_id from public.student_bookings where id=b1)
         <> '70000000-0000-4000-8000-000000000003' then
        raise exception 'Failed change must leave old booking untouched';
    end if;

    rejected:=false;
    begin
        perform public.change_replacement_slot(o1,'70000000-0000-4000-8000-000000000004');
    exception when others then
        if SQLERRM like '%own regular session time%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Change allowed student own regular class'; end if;

    next_booking:=public.change_replacement_slot(
        o1,'70000000-0000-4000-8000-000000000006'
    );
    if next_booking <> b1 or
       (select class_session_id from public.student_bookings where id=b1)
          <> '70000000-0000-4000-8000-000000000006' then
        raise exception 'Change must keep existing booking ID and move the slot';
    end if;
    if exists (select 1 from public.student_bookings
        where class_session_id='70000000-0000-4000-8000-000000000003') then
        raise exception 'Old yellow seat was not released by change';
    end if;

    next_booking:=public.change_replacement_slot(
        o2,'70000000-0000-4000-8000-000000000003'
    );
    if next_booking <> b2 then raise exception 'Second change lost booking ID'; end if;

    rejected:=false;
    begin
        perform public.change_replacement_slot(o2,'70000000-0000-4000-8000-000000000006');
    exception when others then
        if SQLERRM like '%No replacement (yellow) seats remain%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Concurrent occupied target was not protected'; end if;

    -- Release returns obligation OPEN and removes the unused target booking.
    perform public.cancel_replacement(o2,'release',null);
    if not exists (select 1 from public.makeup_obligations
        where id=o2 and status='open' and target_booking_id is null) then
        raise exception 'Release did not restore open entitlement';
    end if;
    if exists (select 1 from public.student_bookings where id=b2) then
        raise exception 'Release did not free yellow seat';
    end if;

    -- Cancelling an OPEN entitlement makes it cancelled, without a booking.
    perform public.cancel_replacement(o2,'cancel','No longer needed');
    if (select status from public.makeup_obligations where id=o2) <> 'cancelled' then
        raise exception 'Open replacement cancellation failed';
    end if;

    -- Phase 1 can reopen a cancelled replacement; the same yellow slot
    -- is again bookable because release removed the stale booking.
    result_id := public.initiate_replacement_obligation(
        '80000000-0000-4000-8000-000000000002',
        '70000000-0000-4000-8000-000000000002',
        'planned'
    );
    if result_id <> o2 then raise exception 'Cancelled obligation was not reopened'; end if;
    next_booking := public.assign_replacement_obligation(
        o2, '70000000-0000-4000-8000-000000000003'
    );
    perform public.cancel_replacement(o2,'cancel','Attendance not needed');
    if (select status from public.makeup_obligations where id=o2) <> 'cancelled' or
        exists(select 1 from public.student_bookings where id=next_booking) then
        raise exception 'Scheduled cancellation did not release yellow seat';
    end if;

    -- Attendance cannot be completed early or without a booked seat.
    rejected:=false;
    begin
        perform public.complete_replacement(o1);
    exception when others then
        if SQLERRM like '%before replacement class ends%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Attendance was allowed before target ended'; end if;

    -- Travel time forward in fixture by moving the target date back. The
    -- original class is STILL in the future: completion must be allowed.
    update public.class_sessions set class_date=(
        (now() at time zone 'Asia/Kuala_Lumpur')::date - 2
    ) where id='70000000-0000-4000-8000-000000000006';
    perform public.complete_replacement(o1);
    if not exists (select 1 from public.makeup_obligations m
        join public.student_bookings b on b.id=m.target_booking_id
        where m.id=o1 and m.status='completed' and b.id=b1
          and b.attendance_status='present') then
        raise exception 'Completion failed to mark present and complete entitlement';
    end if;
    if (select attendance_status from public.student_bookings
        where id='80000000-0000-4000-8000-000000000001') <> 'upcoming' then
        raise exception 'Early replacement completion rewrote original attendance';
    end if;

    rejected:=false;
    begin
        perform public.change_replacement_slot(o1,'70000000-0000-4000-8000-000000000005');
    exception when others then
        if SQLERRM like '%Only scheduled replacements can change slots%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Completed replacement was moveable'; end if;

    rejected:=false;
    begin
        perform public.cancel_replacement(o1,'cancel',null);
    exception when others then
        if SQLERRM like '%Only open or scheduled replacements%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Completed replacement was cancellable'; end if;

    -- Once the ORIGINAL class ends, its source absence is still confirmable,
    -- without reopening the already COMPLETED obligation.
    update public.class_sessions set class_date=(
        (now() at time zone 'Asia/Kuala_Lumpur')::date - 1
    ) where id='70000000-0000-4000-8000-000000000001';

    result_id := public.initiate_replacement_obligation(
        '80000000-0000-4000-8000-000000000001',
        '70000000-0000-4000-8000-000000000001',
        'absent'
    );
    if result_id <> o1
        or (select status from public.makeup_obligations where id=o1) <> 'completed'
        or (select attendance_status from public.student_bookings
            where id='80000000-0000-4000-8000-000000000001') <> 'absent' then
        raise exception 'Late original absence confirmation changed completed replacement';
    end if;

    -- Non-admins cannot call the lifecycle SECURITY DEFINER RPCs.
    perform set_config('test.actor','00000000-0000-4000-8000-000000000002',true);
    rejected:=false;
    begin
        perform public.complete_replacement(o1);
    exception when others then
        if SQLERRM like '%do not have permission%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Non-admin completed a replacement'; end if;

    raise notice 'Replacement Phase 3 lifecycle tests PASSED';
end;
$$;
