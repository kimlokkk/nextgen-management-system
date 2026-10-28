-- Offline SQL integration test; ephemeral fixture only.
-- Never run directly against staging or production data.
set test.actor = '00000000-0000-4000-8000-000000000001';

-- Existing fixture session 1 has one yellow seat and no replacement booking.
update public.schedule_batches
set status = 'draft'
where id = '60000000-0000-4000-8000-000000000001';

select public.adjust_class_replacement_capacity(
    '70000000-0000-4000-8000-000000000001'::uuid,
    1, 2, 'Operations approved extra chair and facilitator'
);

do $$
begin
    if (select replacement_capacity from public.class_sessions
        where id = '70000000-0000-4000-8000-000000000001') <> 2 then
        raise exception 'Per-class capacity did not change';
    end if;
    if (select replacement_capacity from public.class_sessions
        where id = '70000000-0000-4000-8000-000000000002') <> 1 then
        raise exception 'A sibling class was unintentionally changed';
    end if;
    if (select count(*) from public.class_replacement_capacity_audit
        where class_session_id = '70000000-0000-4000-8000-000000000001'
          and old_capacity = 1 and new_capacity = 2
          and changed_by = '00000000-0000-4000-8000-000000000001') <> 1 then
        raise exception 'Capacity change not audited';
    end if;

    begin
        perform public.adjust_class_replacement_capacity(
            '70000000-0000-4000-8000-000000000001'::uuid,
            1, 3, 'Operations approved this exception'
        );
        raise exception 'Stale old capacity incorrectly accepted';
    exception when raise_exception then
        if SQLERRM not like '%Capacity changed since%' then raise; end if;
    end;

    begin
        perform public.adjust_class_replacement_capacity(
            '70000000-0000-4000-8000-000000000003'::uuid,
            1, 2, 'Operations approved this exception'
        );
        raise exception 'Locked schedule incorrectly changed';
    exception when raise_exception then
        if SQLERRM not like '%Only scheduled classes in a draft batch%' then raise; end if;
    end;

    begin
        perform public.adjust_class_replacement_capacity(
            '70000000-0000-4000-8000-000000000001'::uuid,
            2, 3, 'short'
        );
        raise exception 'Missing audit reason incorrectly accepted';
    exception when raise_exception then
        if SQLERRM not like '%explicit reason%' then raise; end if;
    end;
end;
$$;

-- Source booking and existing regular seat must remain intact.
do $$
begin
    if (select count(*) from public.student_bookings
        where class_session_id = '70000000-0000-4000-8000-000000000001'
          and booking_type = 'regular') <> 1 then
        raise exception 'Existing regular booking changed';
    end if;
end;
$$;

-- Verify staff role restriction even when executed by superuser.
set test.actor = '00000000-0000-4000-8000-000000000002';
do $$
begin
    begin
        perform public.adjust_class_replacement_capacity(
            '70000000-0000-4000-8000-000000000001'::uuid,
            2, 3, 'Someone wants extra replacement places'
        );
        raise exception 'Non-admin capacity change incorrectly accepted';
    exception when raise_exception then
        if SQLERRM not like '%Only active administrators%' then raise; end if;
    end;
end;
$$;
set test.actor = '00000000-0000-4000-8000-000000000001';

-- Direct read of audit is limited by RLS for authenticated accounts.
grant select on public.class_replacement_capacity_audit to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.profiles to authenticated;

set role authenticated;
do $$
begin
    if (select count(*) from public.class_replacement_capacity_audit) <> 1 then
        raise exception 'Admin cannot read capacity audit';
    end if;
end;
$$;
set test.actor = '00000000-0000-4000-8000-000000000002';
do $$
begin
    if exists (select 1 from public.class_replacement_capacity_audit) then
        raise exception 'Non-admin can read class capacity audit';
    end if;
end;
$$;
reset role;

select 'Audited class capacity RPC and access tests passed' as result;
