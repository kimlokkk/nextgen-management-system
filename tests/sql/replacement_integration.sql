-- Execute after replacement_fixture.sql and both RPC migrations.
-- Raises on any failed assertion so GitHub Actions fails deterministically.
set test.actor = '00000000-0000-4000-8000-000000000001';
do $$
declare
    o1 uuid;
    o2 uuid;
    b1 uuid;
    b2 uuid;
    rejected boolean;
begin
    o1 := public.initiate_replacement_obligation(
        '80000000-0000-4000-8000-000000000001',
        '70000000-0000-4000-8000-000000000001',
        'planned'
    );
    o2 := public.initiate_replacement_obligation(
        '80000000-0000-4000-8000-000000000002',
        '70000000-0000-4000-8000-000000000002',
        'planned'
    );

    if (select attendance_status from public.student_bookings
        where id = '80000000-0000-4000-8000-000000000001') <> 'upcoming' then
        raise exception 'Planning must preserve original upcoming regular booking';
    end if;

    if (select count(*) from public.makeup_obligations
        where source_booking_id = '80000000-0000-4000-8000-000000000001') <> 1 then
        raise exception 'Expected exactly one replacement obligation';
    end if;

    rejected := false;
    begin
        perform public.initiate_replacement_obligation(
            '80000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            'planned'
        );
    exception when others then
        if SQLERRM like '%already has an active replacement%' then
            rejected := true;
        else
            raise;
        end if;
    end;
    if not rejected then
        raise exception 'Duplicate planned replacement was allowed';
    end if;

    rejected := false;
    begin
        perform public.initiate_replacement_obligation(
            '80000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            'absent'
        );
    exception when others then
        if SQLERRM like '%before class ends%' then
            rejected := true;
        else
            raise;
        end if;
    end;
    if not rejected then
        raise exception 'Premature absence confirmation was allowed';
    end if;

    rejected := false;
    begin
        perform public.assign_replacement_obligation(
            o1, '70000000-0000-4000-8000-000000000004'
        );
    exception when others then
        if SQLERRM like '%own regular session time%' then
            rejected := true;
        else
            raise;
        end if;
    end;
    if not rejected then
        raise exception 'Replacement into own weekly regular class was allowed';
    end if;

    -- Yellow capacity 1. Source class is in a later month than target.
    b1 := public.assign_replacement_obligation(
        o1, '70000000-0000-4000-8000-000000000003'
    );

    if not exists (
        select 1
        from public.student_bookings b
        where b.id = b1
          and b.booking_type = 'replacement'
          and b.attendance_status = 'upcoming'
          and b.class_session_id = '70000000-0000-4000-8000-000000000003'
    ) then
        raise exception 'Replacement target booking has incorrect type/session';
    end if;

    if not exists (
        select 1 from public.makeup_obligations m
        where m.id = o1
          and m.status = 'scheduled'
          and m.target_booking_id = b1
    ) then
        raise exception 'Scheduled obligation not linked to inserted target booking';
    end if;

    rejected := false;
    begin
        perform public.assign_replacement_obligation(
            o2, '70000000-0000-4000-8000-000000000003'
        );
    exception when others then
        if SQLERRM like '%No replacement (yellow) seats remain%' then
            rejected := true;
        else
            raise;
        end if;
    end;
    if not rejected then
        raise exception 'Target replacement capacity was overbooked';
    end if;

    if (select status from public.makeup_obligations where id = o2) <> 'open' then
        raise exception 'Failed assignment must not alter obligation';
    end if;

    if (select count(*) from public.student_bookings
        where class_session_id = '70000000-0000-4000-8000-000000000003') <> 1 then
        raise exception 'Failed assignment created an orphan booking';
    end if;

    -- Student with stopped enrollment can still fulfill their obligation.
    b2 := public.assign_replacement_obligation(
        o2, '70000000-0000-4000-8000-000000000005'
    );

    if b2 is null then
        raise exception 'Assignment for stopped enrollment failed';
    end if;

    rejected := false;
    begin
        perform public.assign_replacement_obligation(
            o2, '70000000-0000-4000-8000-000000000003'
        );
    exception when others then
        if SQLERRM like '%Only open, unassigned replacements%' then
            rejected := true;
        else
            raise;
        end if;
    end;
    if not rejected then
        raise exception 'Already-scheduled obligation allowed second assignment';
    end if;

    -- RLS bypass from SECURITY DEFINER is prevented by the explicit role check.
    perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
    rejected := false;
    begin
        perform public.assign_replacement_obligation(
            o1, '70000000-0000-4000-8000-000000000005'
        );
    exception when others then
        if SQLERRM like '%do not have permission%' then
            rejected := true;
        else
            raise;
        end if;
    end;
    if not rejected then
        raise exception 'Non-admin successfully invoked security definer RPC';
    end if;

    raise notice 'Replacement RPC smoke tests PASSED';
end;
$$;
