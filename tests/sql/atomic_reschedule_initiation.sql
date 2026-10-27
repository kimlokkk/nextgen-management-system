-- Atomic reschedule initiation (migration 025) on an ISOLATED, fully synthetic PostgreSQL.
-- Run after replacement_fixture.sql and migrations 011-015 and 025.
-- Touches no real data; never run against Supabase Local or any cloud project.
set test.actor = '00000000-0000-4000-8000-000000000001';

-- Asserts the call is rejected with a message matching p_pattern AND that the
-- booking and its obligations are byte-for-byte unchanged afterwards.
create function pg_temp.expect_reject(p_booking uuid, p_session uuid, p_pattern text)
returns void language plpgsql as $$
declare
    v_status text; v_count integer; v_msg text; v_rejected boolean := false;
begin
    select attendance_status into v_status from public.student_bookings where id = p_booking;
    select count(*) into v_count from public.makeup_obligations where source_booking_id = p_booking;
    begin
        perform public.initiate_reschedule_obligation(p_booking, p_session);
    exception when others then
        v_msg := sqlerrm; v_rejected := true;
    end;
    if not v_rejected then
        raise exception 'Expected rejection "%", but the call succeeded', p_pattern;
    end if;
    if v_msg not like p_pattern then
        raise exception 'Expected rejection "%", got "%"', p_pattern, v_msg;
    end if;
    if (select attendance_status from public.student_bookings where id = p_booking)
       is distinct from v_status then
        raise exception 'Booking status changed after rejected call ("%")', p_pattern;
    end if;
    if (select count(*) from public.makeup_obligations where source_booking_id = p_booking) <> v_count then
        raise exception 'Obligation rows changed after rejected call ("%")', p_pattern;
    end if;
end $$;

-- ---------- synthetic extra data ----------
insert into public.schedule_batches values
    ('b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'draft');

insert into public.class_sessions
    (id, schedule_batch_id, session_template_id, branch_id, programme_id,
     class_date, start_time, end_time, status, replacement_capacity)
select v.id, v.batch, '40000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
       v.d, '10:00', '11:00', v.st, 1
from (values
    ('b1000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, (now() at time zone 'Asia/Kuala_Lumpur')::date + 20, 'scheduled'), -- draft batch
    ('b1000000-0000-4000-8000-000000000002'::uuid, '60000000-0000-4000-8000-000000000001'::uuid, (now() at time zone 'Asia/Kuala_Lumpur')::date - 3,  'scheduled'), -- past
    ('b1000000-0000-4000-8000-000000000003'::uuid, '60000000-0000-4000-8000-000000000001'::uuid, (now() at time zone 'Asia/Kuala_Lumpur')::date + 20, 'cancelled'), -- cancelled class
    ('b1000000-0000-4000-8000-000000000004'::uuid, '60000000-0000-4000-8000-000000000001'::uuid, (now() at time zone 'Asia/Kuala_Lumpur')::date + 20, 'scheduled'), -- shared future class
    ('b1000000-0000-4000-8000-000000000005'::uuid, '60000000-0000-4000-8000-000000000001'::uuid, (now() at time zone 'Asia/Kuala_Lumpur')::date,      'scheduled')  -- today (boundary)
) as v(id, batch, d, st);

-- one student per scenario so (class, student) stays unique
insert into public.students (id, status)
select ('b3000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'active'
from generate_series(1, 14) g;

-- bookings: b2..NN uses student b3..NN
insert into public.student_bookings (id, class_session_id, student_id, booking_type, attendance_status)
select ('b2000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       cls::uuid, ('b3000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, bt, st
from (values
    (1,  'b1000000-0000-4000-8000-000000000001', 'regular',     'upcoming'),  -- draft batch
    (2,  'b1000000-0000-4000-8000-000000000002', 'regular',     'upcoming'),  -- past class
    (3,  'b1000000-0000-4000-8000-000000000003', 'regular',     'upcoming'),  -- cancelled class
    (4,  'b1000000-0000-4000-8000-000000000005', 'regular',     'upcoming'),  -- today
    (5,  'b1000000-0000-4000-8000-000000000004', 'replacement', 'upcoming'),  -- not regular
    (6,  'b1000000-0000-4000-8000-000000000004', 'regular',     'present'),   -- not upcoming (also a target FK below)
    (7,  'b1000000-0000-4000-8000-000000000004', 'regular',     'upcoming'),  -- reopen cancelled obligation
    (8,  'b1000000-0000-4000-8000-000000000004', 'regular',     'upcoming'),  -- cancelled obligation WITH target
    (9,  'b1000000-0000-4000-8000-000000000004', 'regular',     'upcoming'),  -- active replacement exists
    (10, 'b1000000-0000-4000-8000-000000000004', 'regular',     'upcoming'),  -- active reschedule already exists
    (11, 'b1000000-0000-4000-8000-000000000004', 'regular',     'upcoming'),  -- forced mid-transaction failure
    (12, 'b1000000-0000-4000-8000-000000000004', 'regular',     'upcoming'),  -- permission checks
    (13, 'b1000000-0000-4000-8000-000000000004', 'regular',     'upcoming')   -- wrong-session check
) as v(n, cls, bt, st);

insert into public.makeup_obligations
    (id, student_id, source_booking_id, target_booking_id, obligation_type, status, reason, created_by)
values
    ('b4000000-0000-4000-8000-000000000007', 'b3000000-0000-4000-8000-000000000007', 'b2000000-0000-4000-8000-000000000007', null, 'reschedule', 'cancelled', 'old cancellation', '00000000-0000-4000-8000-000000000002'),
    ('b4000000-0000-4000-8000-000000000008', 'b3000000-0000-4000-8000-000000000008', 'b2000000-0000-4000-8000-000000000008', 'b2000000-0000-4000-8000-000000000006', 'reschedule', 'cancelled', 'has target', null),
    ('b4000000-0000-4000-8000-000000000009', 'b3000000-0000-4000-8000-000000000009', 'b2000000-0000-4000-8000-000000000009', null, 'replacement', 'open', null, null),
    ('b4000000-0000-4000-8000-000000000010', 'b3000000-0000-4000-8000-000000000010', 'b2000000-0000-4000-8000-000000000010', null, 'reschedule', 'open', null, null);

-- ---------- 1. happy path ----------
do $$
declare
    v_id uuid;
    v_before integer := (select count(*) from public.makeup_obligations);
begin
    v_id := public.initiate_reschedule_obligation(
        '80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001');
    if v_id is null then raise exception 'Happy path returned no obligation id'; end if;

    if not exists (
        select 1 from public.makeup_obligations m
        join public.student_bookings b on b.id = m.source_booking_id
        where m.id = v_id
          and m.obligation_type = 'reschedule' and m.status = 'open'
          and m.source_booking_id = '80000000-0000-4000-8000-000000000001'
          and m.student_id = b.student_id and m.enrollment_id is not distinct from b.enrollment_id
          and m.created_by = '00000000-0000-4000-8000-000000000001'
          and m.target_booking_id is null
    ) then raise exception 'Reschedule obligation was not created correctly'; end if;

    if (select attendance_status from public.student_bookings
        where id = '80000000-0000-4000-8000-000000000001') <> 'rescheduled' then
        raise exception 'Original booking was not marked rescheduled';
    end if;
    if (select booking_type from public.student_bookings
        where id = '80000000-0000-4000-8000-000000000001') <> 'regular' then
        raise exception 'Regular seat must be retained';
    end if;
    if (select count(*) from public.makeup_obligations) <> v_before + 1 then
        raise exception 'Expected exactly one new obligation';
    end if;
end $$;

-- second call on the same booking: rejected, nothing duplicated
select pg_temp.expect_reject('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
    'Only upcoming bookings can be rescheduled');

-- ---------- 2. rejections leave no side effects ----------
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Schedule must be locked before rescheduling students');
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'Past classes cannot be rescheduled');
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', 'Only scheduled classes can be rescheduled');
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000004', 'Only regular bookings can be rescheduled');
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000004', 'Only upcoming bookings can be rescheduled');
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000013', '70000000-0000-4000-8000-000000000002', 'Booking does not belong to this class');
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000099', 'b1000000-0000-4000-8000-000000000004', 'Student booking not found');
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000009', 'b1000000-0000-4000-8000-000000000004', 'This booking already has an active replacement obligation');
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000010', 'b1000000-0000-4000-8000-000000000004', 'This booking already has a makeup obligation');
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000008', 'b1000000-0000-4000-8000-000000000004', 'This reschedule cannot be reopened');

-- ---------- 3. boundary: a class TODAY (Malaysia) is not "past" ----------
do $$
begin
    perform public.initiate_reschedule_obligation(
        'b2000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000005');
    if (select attendance_status from public.student_bookings
        where id = 'b2000000-0000-4000-8000-000000000004') <> 'rescheduled' then
        raise exception 'Class dated today should be reschedulable';
    end if;
end $$;

-- ---------- 4. reopen a cancelled reschedule: stable obligation id, no duplicate ----------
do $$
declare v_id uuid;
begin
    v_id := public.initiate_reschedule_obligation(
        'b2000000-0000-4000-8000-000000000007', 'b1000000-0000-4000-8000-000000000004');
    if v_id <> 'b4000000-0000-4000-8000-000000000007' then
        raise exception 'Cancelled reschedule was not reopened with its original id';
    end if;
    if not exists (
        select 1 from public.makeup_obligations
        where id = v_id and status = 'open' and reason is null and target_booking_id is null
          and created_by = '00000000-0000-4000-8000-000000000001'
    ) then raise exception 'Reopened obligation has wrong state'; end if;
    if (select count(*) from public.makeup_obligations
        where source_booking_id = 'b2000000-0000-4000-8000-000000000007') <> 1 then
        raise exception 'Reopen must not create a second obligation row';
    end if;
    if (select attendance_status from public.student_bookings
        where id = 'b2000000-0000-4000-8000-000000000007') <> 'rescheduled' then
        raise exception 'Booking not rescheduled after reopen';
    end if;
end $$;

-- ---------- 5. ATOMICITY: failure after the obligation insert rolls it back ----------
create function public.test_force_reschedule_failure() returns trigger language plpgsql as $$
begin raise exception 'forced failure after obligation insert'; end $$;
create trigger test_force_failure before update on public.student_bookings
    for each row when (new.id = 'b2000000-0000-4000-8000-000000000011' and new.attendance_status = 'rescheduled')
    execute function public.test_force_reschedule_failure();

select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000011', 'b1000000-0000-4000-8000-000000000004', '%forced failure%');

drop trigger test_force_failure on public.student_bookings;
drop function public.test_force_reschedule_failure();

-- control: same booking now succeeds, proving the failure above came from the injected trigger
do $$
begin
    perform public.initiate_reschedule_obligation(
        'b2000000-0000-4000-8000-000000000011', 'b1000000-0000-4000-8000-000000000004');
    if (select count(*) from public.makeup_obligations
        where source_booking_id = 'b2000000-0000-4000-8000-000000000011') <> 1 then
        raise exception 'Control run should leave exactly one obligation';
    end if;
end $$;

-- ---------- 6. authorization ----------
set test.actor = '00000000-0000-4000-8000-000000000002';   -- non-admin
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000012', 'b1000000-0000-4000-8000-000000000004', 'You do not have permission to reschedule students');

set test.actor = '';                                         -- unauthenticated
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000012', 'b1000000-0000-4000-8000-000000000004', 'You do not have permission to reschedule students');

set test.actor = '00000000-0000-4000-8000-000000000001';
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-000000000001';
select pg_temp.expect_reject('b2000000-0000-4000-8000-000000000012', 'b1000000-0000-4000-8000-000000000004', 'You do not have permission to reschedule students');
update public.profiles set is_active = true  where id = '00000000-0000-4000-8000-000000000001';

do $$
begin
    if has_function_privilege('anon', 'public.initiate_reschedule_obligation(uuid,uuid)', 'execute') then
        raise exception 'anon must not execute initiate_reschedule_obligation'; end if;
    if has_function_privilege('public', 'public.initiate_reschedule_obligation(uuid,uuid)', 'execute') then
        raise exception 'PUBLIC must not execute initiate_reschedule_obligation'; end if;
    if not has_function_privilege('authenticated', 'public.initiate_reschedule_obligation(uuid,uuid)', 'execute') then
        raise exception 'authenticated must be able to execute initiate_reschedule_obligation'; end if;
    if not (select prosecdef from pg_proc where oid = 'public.initiate_reschedule_obligation(uuid,uuid)'::regprocedure) then
        raise exception 'expected SECURITY DEFINER (matches initiate_replacement_obligation)'; end if;
    if not exists (select 1 from pg_proc where oid = 'public.initiate_reschedule_obligation(uuid,uuid)'::regprocedure
                   and proconfig @> array['search_path=""']) then
        raise exception 'search_path must be pinned'; end if;
end $$;

do $$ begin raise notice 'atomic reschedule initiation: all assertions passed'; end $$;
