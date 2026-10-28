-- Offline test using the temporary replacement fixture only.
-- This DOES NOT import actual minors' names and must never run on live data.
\i supabase/migrations/018_legacy_replacement_review.sql

insert into public.legacy_replacement_reviews (
    source_batch, source_ref, branch_id, student_name,
    original_date, replacement_date, programme_code, space_number,
    start_time, end_time, technical_status
) values (
    'fixture', 'test-ref-1', '10000000-0000-4000-8000-000000000001',
    'Fixture student', '2026-09-12', '2026-10-03', 'JR_MAKER', 1,
    '09:00', '10:30', 'ORIGINAL_BOOKING_MISSING'
);

set test.actor = '00000000-0000-4000-8000-000000000001';

do $$
declare v_id uuid; v_bookings integer;
begin
    select id into v_id from public.legacy_replacement_reviews where source_ref = 'test-ref-1';
    select count(*) into v_bookings from public.student_bookings;

    perform public.record_legacy_replacement_review(
        v_id, 'evidence_requested', 'Need original Sep attendance from operations'
    );
    if (select review_state from public.legacy_replacement_reviews where id=v_id)
       <> 'evidence_requested' then
        raise exception 'Evidence status did not persist';
    end if;
    if (select count(*) from public.legacy_replacement_review_audit where review_id=v_id) <> 1 then
        raise exception 'Audit record missing';
    end if;
    if (select count(*) from public.student_bookings) <> v_bookings then
        raise exception 'Legacy review changed active student bookings';
    end if;
    if exists (select 1 from public.makeup_obligations where reason='Need original Sep attendance from operations') then
        raise exception 'Legacy review created entitlement';
    end if;

    begin
        perform public.record_legacy_replacement_review(v_id, 'evidence_received', 'short');
        raise exception 'Short evidence note incorrectly accepted';
    exception when raise_exception then
        if SQLERRM not like '%Explain the evidence%' then raise; end if;
    end;
end;
$$;

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.profiles to authenticated;

set role authenticated;
set test.actor = '00000000-0000-4000-8000-000000000001';
do $$
begin
    if (select count(*) from public.legacy_replacement_reviews where source_batch='fixture') <> 1 then
        raise exception 'Admin cannot read imported reviews';
    end if;
    if (select count(*) from public.legacy_replacement_review_audit) <> 1 then
        raise exception 'Admin cannot read audit trail';
    end if;
    begin
        update public.legacy_replacement_reviews set review_state='excluded'
        where source_ref='test-ref-1';
        raise exception 'Direct review updates incorrectly permitted';
    exception when insufficient_privilege then null;
    end;
end;
$$;

set test.actor = '00000000-0000-4000-8000-000000000002';
do $$
declare v_id uuid;
begin
    if exists (select 1 from public.legacy_replacement_reviews where source_batch='fixture')
       or exists (select 1 from public.legacy_replacement_review_audit) then
        raise exception 'Non-admin saw historical evidence';
    end if;
    select id into v_id from public.legacy_replacement_reviews where source_ref='test-ref-1';
    -- Result invisible under RLS, but knowing a UUID must still not grant RPC rights.
    begin
        perform public.record_legacy_replacement_review(
            '00000000-0000-4000-8000-000000000099',
            'evidence_requested', 'Parent must not review this record'
        );
        raise exception 'Non-admin review improperly permitted';
    exception when raise_exception then
        if SQLERRM not like '%Only active admins%' then raise; end if;
    end;
end;
$$;

reset role;
set test.actor = '00000000-0000-4000-8000-000000000001';

select 'Historical review queue, admin RPC and permissions passed' as result;
