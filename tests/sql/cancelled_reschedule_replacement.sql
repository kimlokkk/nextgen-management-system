-- Cancelled Reschedule -> Absent -> Replacement:
-- verifies both history rows persist and competing active entitlements fail.
-- Run after attendance integration tests and migration 015 on isolated PostgreSQL.
set test.actor = '00000000-0000-4000-8000-000000000001';

do $$
declare
    v_source uuid := '80000000-0000-4000-8000-000000000003';
    v_session uuid := '70000000-0000-4000-8000-000000000007';
    v_obligation uuid;
    v_target uuid;
    v_history_id uuid := '90000000-0000-4000-8000-000000000006';
    v_rejected boolean;
begin
    -- Attendance fixture left this normal regular booking PRESENT.
    -- Correct it to ABSENT, then simulate a previous cancelled reschedule.
    perform public.record_class_attendance(v_source,v_session,'absent');

    insert into public.makeup_obligations (
        id,student_id,source_booking_id,obligation_type,status,reason
    ) values (
        v_history_id, '30000000-0000-4000-8000-000000000003',v_source,
        'reschedule','cancelled','Original reschedule cancelled in admin test'
    );

    v_obligation := public.initiate_replacement_obligation(
        v_source,v_session,'absent'
    );

    if v_obligation is null or
        (select count(*) from public.makeup_obligations
         where source_booking_id=v_source) <> 2 then
        raise exception 'Replacement not created beside cancelled reschedule history';
    end if;

    if not exists (
        select 1 from public.makeup_obligations
        where id=v_history_id and source_booking_id=v_source
          and obligation_type='reschedule' and status='cancelled'
          and reason='Original reschedule cancelled in admin test'
    ) then
        raise exception 'Reschedule cancellation history was modified or lost';
    end if;

    if not exists (
        select 1 from public.makeup_obligations
        where id=v_obligation and obligation_type='replacement' and status='open'
    ) then raise exception 'Replacement was not opened'; end if;

    -- A second concurrent-active entitlement is forbidden by the DB index.
    v_rejected:=false;
    begin
        update public.makeup_obligations
        set status='open' where id=v_history_id;
    exception when unique_violation then v_rejected:=true;
    end;
    if not v_rejected then
        raise exception 'Unique active-entitlement index did not reject reschedule reopen';
    end if;

    -- Historical cancellation can coexist with actual yellow-seat booking.
    v_target := public.assign_replacement_obligation(
        v_obligation,'70000000-0000-4000-8000-000000000003'
    );
    if v_target is null or not exists (
        select 1 from public.makeup_obligations
        where id=v_obligation and status='scheduled' and target_booking_id=v_target
    ) then raise exception 'Yellow slot assignment after cancellation failed'; end if;

    v_rejected:=false;
    begin
        perform public.record_class_attendance(v_source,v_session,'present');
    exception when others then
        if SQLERRM like '%replacement entitlement%' then v_rejected:=true;
        else raise; end if;
    end;
    if not v_rejected then
        raise exception 'Original attendance was changed despite active replacement';
    end if;

    -- Release and reopen do not rewrite the historical reschedule.
    perform public.cancel_replacement(v_obligation,'release',null);
    perform public.cancel_replacement(v_obligation,'cancel','Test teardown');
    if not exists (
        select 1 from public.makeup_obligations
        where id=v_history_id and status='cancelled' and obligation_type='reschedule'
    ) then raise exception 'Reschedule history changed after replacement cancellation'; end if;

    if public.initiate_replacement_obligation(v_source,v_session,'absent') <> v_obligation then
        raise exception 'Cancelled replacement was not reopened with stable ID';
    end if;

    -- Another source with a LIVE reschedule may not start a replacement.
    insert into public.makeup_obligations (
        id,student_id,source_booking_id,obligation_type,status
    ) values (
        '90000000-0000-4000-8000-000000000007',
        '30000000-0000-4000-8000-000000000003',
        '80000000-0000-4000-8000-000000000004',
        'reschedule','open'
    );
    v_rejected:=false;
    begin
        perform public.initiate_replacement_obligation(
            '80000000-0000-4000-8000-000000000004',
            '70000000-0000-4000-8000-000000000008','planned'
        );
    exception when others then
        if SQLERRM like '%active reschedule obligation%' then v_rejected:=true;
        else raise; end if;
    end;
    if not v_rejected then raise exception 'Active reschedule allowed competing replacement'; end if;

    raise notice 'Cancelled reschedule -> replacement regression tests PASSED';
end;
$$;
