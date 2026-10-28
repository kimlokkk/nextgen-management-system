-- Atomic reschedule lifecycle (migration 027) on an ISOLATED, fully synthetic PostgreSQL.
-- Run after replacement_fixture.sql, migrations 011-015, 025 and 027.
-- Never run against Supabase Local or any cloud project.
set test.actor = '00000000-0000-4000-8000-000000000001';

-- The shared fixture has no regular_capacity column (the real schema has one, NOT NULL).
alter table public.class_sessions add column regular_capacity integer not null default 10;

create function pg_temp.u(p text, n int) returns uuid language sql immutable as
$$ select (p || '000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- Fingerprint of ALL obligations + bookings: proves rejected/rolled-back calls changed nothing.
create function pg_temp.fp() returns text language sql as $$
    select md5(coalesce((select string_agg(m::text, '|' order by m.id) from public.makeup_obligations m), '')
         || '#' || coalesce((select string_agg(b::text, '|' order by b.id) from public.student_bookings b), ''))
$$;

create function pg_temp.expect_reject(p_sql text, p_pattern text) returns void language plpgsql as $$
declare v_before text := pg_temp.fp(); v_msg text; v_rejected boolean := false;
begin
    begin execute p_sql; exception when others then v_msg := sqlerrm; v_rejected := true; end;
    if not v_rejected then raise exception 'Expected rejection "%", but succeeded: %', p_pattern, p_sql; end if;
    if v_msg not like p_pattern then raise exception 'Expected "%" but got "%" for: %', p_pattern, v_msg, p_sql; end if;
    if pg_temp.fp() <> v_before then raise exception 'State changed after rejected call ("%"): %', p_pattern, p_sql; end if;
end $$;

-- regular upcoming booking n in class OC, then initiate a reschedule through the real RPC (025)
create function pg_temp.mk_open(n int, p_class int default 1) returns uuid language plpgsql as $$
begin
    insert into public.student_bookings (id, class_session_id, student_id, booking_type, attendance_status)
    values (pg_temp.u('d2', n), pg_temp.u('d1', p_class), pg_temp.u('d3', n), 'regular', 'upcoming');
    perform public.initiate_reschedule_obligation(pg_temp.u('d2', n), pg_temp.u('d1', p_class));
    return (select id from public.makeup_obligations where source_booking_id = pg_temp.u('d2', n));
end $$;
create function pg_temp.ob(n int) returns uuid language sql as
$$ select id from public.makeup_obligations where source_booking_id = pg_temp.u('d2', n) $$;
create function pg_temp.asn(n int, cls int) returns text language sql as
$$ select format('select public.assign_reschedule_slot(%L, %L)', pg_temp.ob(n), pg_temp.u('d1', cls)) $$;
create function pg_temp.reopen(n int) returns text language sql as
$$ select format('select public.reopen_reschedule_assignment(%L)', pg_temp.ob(n)) $$;
create function pg_temp.cancel(n int) returns text language sql as
$$ select format('select public.cancel_reschedule(%L)', pg_temp.ob(n)) $$;

-- ---------- synthetic data ----------
insert into public.branches values ('10000000-0000-4000-8000-000000000002');
insert into public.programmes values ('20000000-0000-4000-8000-000000000002');
insert into public.schedule_batches values (pg_temp.u('d0', 1), '10000000-0000-4000-8000-000000000001', 'draft');
insert into public.students (id, status) select pg_temp.u('d3', g), 'active' from generate_series(1, 60) g;

insert into public.class_sessions
    (id, schedule_batch_id, session_template_id, branch_id, programme_id, class_date, start_time, end_time, status, replacement_capacity, regular_capacity)
select pg_temp.u('d1', v.n), v.batch, '40000000-0000-4000-8000-000000000001', v.br, v.pr,
       (now() at time zone 'Asia/Kuala_Lumpur')::date + v.off, '10:00', '11:00', v.st, 1, v.cap
from (values
  (1,  '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  30, 'scheduled', 20), -- OC: original class
  (2,  '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  30, 'scheduled', 1),  -- OC2: capacity 1
  (3,  '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  31, 'scheduled', 20), -- T2: roomy target
  (4,  '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  32, 'scheduled', 1),  -- T1: capacity 1
  (5,  '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  33, 'scheduled', 20), -- other branch
  (6,  '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000002'::uuid,  34, 'scheduled', 20), -- other programme
  (7,  pg_temp.u('d0', 1),                           '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  35, 'scheduled', 20), -- draft batch
  (8,  '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  36, 'cancelled', 20), -- cancelled class
  (9,  '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  -3, 'scheduled', 20), -- past
  (10, '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,   0, 'scheduled', 20), -- today (boundary)
  (11, '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  37, 'cancelled', 20), -- cancelled ORIGINAL
  (12, '60000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  -4, 'scheduled', 20), -- past ORIGINAL
  (13, pg_temp.u('d0', 1),                           '10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid,  38, 'scheduled', 20)  -- draft ORIGINAL
) as v(n, batch, br, pr, off, st, cap);

-- =========================== ASSIGN ===========================
do $$ declare v_before integer; v_tb uuid; begin
    perform pg_temp.mk_open(1);
    v_tb := public.assign_reschedule_slot(pg_temp.ob(1), pg_temp.u('d1', 3));
    if not exists (select 1 from public.student_bookings b where b.id = v_tb and b.class_session_id = pg_temp.u('d1', 3)
                   and b.booking_type = 'reschedule' and b.attendance_status = 'upcoming' and b.student_id = pg_temp.u('d3', 1)) then
        raise exception 'Target booking not created correctly'; end if;
    if not exists (select 1 from public.makeup_obligations m where m.id = pg_temp.ob(1) and m.status = 'scheduled' and m.target_booking_id = v_tb) then
        raise exception 'Obligation not scheduled with target'; end if;
    if (select attendance_status from public.student_bookings where id = pg_temp.u('d2', 1)) <> 'rescheduled' then
        raise exception 'Source booking must stay rescheduled'; end if;
end $$;

select pg_temp.expect_reject(pg_temp.asn(1, 3), 'Only open reschedules can be assigned');   -- double assign

do $$ begin
    perform pg_temp.mk_open(4);
    -- student 4 is already booked into T2 (for the "already has a booking" rejection)
    insert into public.student_bookings (class_session_id, student_id, booking_type, attendance_status)
        values (pg_temp.u('d1', 3), pg_temp.u('d3', 4), 'regular', 'upcoming');
end $$;
-- a REPLACEMENT obligation, to prove assign refuses non-reschedule obligations
do $$ begin
    insert into public.student_bookings (id, class_session_id, student_id, booking_type, attendance_status)
        values (pg_temp.u('d2', 14), pg_temp.u('d1', 1), pg_temp.u('d3', 14), 'regular', 'upcoming');
    perform public.initiate_replacement_obligation(pg_temp.u('d2', 14), pg_temp.u('d1', 1), 'planned');
end $$;

select pg_temp.expect_reject(pg_temp.asn(4, 1),  'Student cannot be rescheduled into the original class');
select pg_temp.expect_reject(pg_temp.asn(4, 5),  'Reschedule must remain in the same branch');
select pg_temp.expect_reject(pg_temp.asn(4, 6),  'Reschedule must remain in the same programme');
select pg_temp.expect_reject(pg_temp.asn(4, 7),  'Target schedule must be locked');
select pg_temp.expect_reject(pg_temp.asn(4, 8),  'Target class is not scheduled');
select pg_temp.expect_reject(pg_temp.asn(4, 9),  'Cannot assign a reschedule to a past class');
select pg_temp.expect_reject(pg_temp.asn(4, 3),  'Student already has a booking in this class');
select pg_temp.expect_reject(format('select public.assign_reschedule_slot(%L, %L)', pg_temp.ob(4), pg_temp.u('ee', 1)), 'Target class not found');
select pg_temp.expect_reject(format('select public.assign_reschedule_slot(%L, %L)', pg_temp.u('ee', 2), pg_temp.u('d1', 10)), 'Reschedule obligation not found');
select pg_temp.expect_reject(format('select public.assign_reschedule_slot(%L, %L)', (select id from public.makeup_obligations where obligation_type = 'replacement' limit 1), pg_temp.u('d1', 10)), 'This obligation is not a reschedule');

-- boundary: a class dated TODAY (Malaysia) is not "past"
do $$ begin
    perform pg_temp.mk_open(6);
    perform public.assign_reschedule_slot(pg_temp.ob(6), pg_temp.u('d1', 10));
    if (select status from public.makeup_obligations where id = pg_temp.ob(6)) <> 'scheduled' then raise exception 'Today class should be assignable'; end if;
end $$;

-- regular capacity: T1 has ONE seat
do $$ begin
    perform pg_temp.mk_open(2); perform pg_temp.mk_open(3);
    perform public.assign_reschedule_slot(pg_temp.ob(2), pg_temp.u('d1', 4));
end $$;
select pg_temp.expect_reject(pg_temp.asn(3, 4), 'Target class has no vacant regular capacity');
do $$ begin
    if (select count(*) from public.student_bookings where class_session_id = pg_temp.u('d1', 4)) <> 1 then
        raise exception 'T1 must hold exactly its capacity'; end if;
end $$;

-- =========================== REOPEN ===========================
do $$ declare v_old uuid; v_new uuid; begin
    perform pg_temp.mk_open(7);
    v_old := public.assign_reschedule_slot(pg_temp.ob(7), pg_temp.u('d1', 3));
    perform public.reopen_reschedule_assignment(pg_temp.ob(7));
    if exists (select 1 from public.student_bookings where id = v_old) then raise exception 'Old target booking must be deleted'; end if;
    if not exists (select 1 from public.makeup_obligations where id = pg_temp.ob(7) and status = 'open' and target_booking_id is null) then
        raise exception 'Obligation must return to open with no target'; end if;
    if (select attendance_status from public.student_bookings where id = pg_temp.u('d2', 7)) <> 'rescheduled' then
        raise exception 'Source booking must remain rescheduled after reopen'; end if;
    v_new := public.assign_reschedule_slot(pg_temp.ob(7), pg_temp.u('d1', 3));   -- reassign works
    if v_new = v_old then raise exception 'Reassignment must create a new booking'; end if;
end $$;
select pg_temp.expect_reject(pg_temp.reopen(4),  'Only scheduled reschedules can be reassigned');   -- n=4 is still open

-- synthetic edge states: target booking in a past / cancelled class, and not-upcoming target
do $$
declare r record;
begin
    for r in select * from (values (20, 9), (21, 8), (22, 3)) as t(n, cls) loop
        insert into public.student_bookings (id, class_session_id, student_id, booking_type, attendance_status)
            values (pg_temp.u('d2', r.n), pg_temp.u('d1', 1), pg_temp.u('d3', r.n), 'regular', 'rescheduled');
        insert into public.student_bookings (id, class_session_id, student_id, booking_type, attendance_status)
            values (pg_temp.u('d5', r.n), pg_temp.u('d1', r.cls), pg_temp.u('d3', r.n), 'reschedule', case when r.n = 22 then 'present' else 'upcoming' end);
        insert into public.makeup_obligations (student_id, source_booking_id, target_booking_id, obligation_type, status)
            values (pg_temp.u('d3', r.n), pg_temp.u('d2', r.n), pg_temp.u('d5', r.n), 'reschedule', 'scheduled');
    end loop;
end $$;
select pg_temp.expect_reject(pg_temp.reopen(20), 'A past reschedule cannot be reassigned');
select pg_temp.expect_reject(pg_temp.reopen(21), 'Assigned class is no longer scheduled');
select pg_temp.expect_reject(pg_temp.reopen(22), 'Only upcoming reschedule bookings can be reassigned');
select pg_temp.expect_reject(pg_temp.cancel(20), 'A reschedule with a past assigned class cannot be cancelled');
select pg_temp.expect_reject(pg_temp.cancel(22), 'Only upcoming reschedule bookings can be cancelled');

-- =========================== CANCEL ===========================
do $$ declare v_tb uuid; begin     -- scheduled -> cancelled
    perform pg_temp.mk_open(8);
    v_tb := public.assign_reschedule_slot(pg_temp.ob(8), pg_temp.u('d1', 3));
    perform public.cancel_reschedule(pg_temp.ob(8));
    if (select attendance_status from public.student_bookings where id = pg_temp.u('d2', 8)) <> 'upcoming' then raise exception 'Source seat must be restored'; end if;
    if not exists (select 1 from public.makeup_obligations where id = pg_temp.ob(8) and status = 'cancelled' and target_booking_id is null) then
        raise exception 'Obligation must be cancelled with no target'; end if;
    if exists (select 1 from public.student_bookings where id = v_tb) then raise exception 'Target booking must be deleted'; end if;
    -- integration with 025: initiating again reopens the SAME cancelled obligation
    if public.initiate_reschedule_obligation(pg_temp.u('d2', 8), pg_temp.u('d1', 1)) <> pg_temp.ob(8) then
        raise exception 'Cancelled reschedule should be reopened with its stable id'; end if;
end $$;
do $$ begin                         -- open -> cancelled
    perform pg_temp.mk_open(9);
    perform public.cancel_reschedule(pg_temp.ob(9));
    if (select attendance_status from public.student_bookings where id = pg_temp.u('d2', 9)) <> 'upcoming' then raise exception 'Seat not restored (open case)'; end if;
end $$;
select pg_temp.expect_reject(pg_temp.cancel(9), 'Only open or scheduled reschedules can be cancelled');

-- original class full: the old seat was taken while the student was away
do $$ begin
    perform pg_temp.mk_open(30, 2);
    insert into public.student_bookings (class_session_id, student_id, booking_type, attendance_status)
        values (pg_temp.u('d1', 2), pg_temp.u('d3', 31), 'regular', 'upcoming');
end $$;
select pg_temp.expect_reject(pg_temp.cancel(30), 'Original class no longer has a vacant regular seat');
do $$ begin
    delete from public.student_bookings where student_id = pg_temp.u('d3', 31) and class_session_id = pg_temp.u('d1', 2);
    perform public.cancel_reschedule(pg_temp.ob(30));
    if (select attendance_status from public.student_bookings where id = pg_temp.u('d2', 30)) <> 'upcoming' then raise exception 'Seat not restored once vacant'; end if;
end $$;

-- original class cancelled / past / in a draft batch
do $$
declare r record;
begin
    for r in select * from (values (40, 11), (41, 12), (42, 13)) as t(n, cls) loop
        insert into public.student_bookings (id, class_session_id, student_id, booking_type, attendance_status)
            values (pg_temp.u('d2', r.n), pg_temp.u('d1', r.cls), pg_temp.u('d3', r.n), 'regular', 'rescheduled');
        insert into public.makeup_obligations (student_id, source_booking_id, obligation_type, status)
            values (pg_temp.u('d3', r.n), pg_temp.u('d2', r.n), 'reschedule', 'open');
    end loop;
end $$;
select pg_temp.expect_reject(pg_temp.cancel(40), 'Original class is no longer scheduled');
select pg_temp.expect_reject(pg_temp.cancel(41), 'A past reschedule cannot be cancelled back to the original class');
select pg_temp.expect_reject(pg_temp.cancel(42), 'Original schedule must be locked');

-- =========================== ATOMICITY (forced failure mid-transaction) ===========================
do $$ begin perform pg_temp.mk_open(50); perform pg_temp.mk_open(51); perform pg_temp.mk_open(52); end $$;

-- assign: fails AFTER the target booking insert, on the obligation update
create function public.test_force_failure() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$;
create trigger test_fail_assign before update on public.makeup_obligations
    for each row when (new.status = 'scheduled' and new.source_booking_id = 'd2000000-0000-4000-8000-000000000050')
    execute function public.test_force_failure();
select pg_temp.expect_reject(pg_temp.asn(50, 3), '%forced failure%');
drop trigger test_fail_assign on public.makeup_obligations;
do $$ begin perform public.assign_reschedule_slot(pg_temp.ob(50), pg_temp.u('d1', 3)); end $$;  -- control

-- reopen: fails on deleting the target booking, AFTER the obligation was detached
do $$ begin perform public.assign_reschedule_slot(pg_temp.ob(51), pg_temp.u('d1', 3)); end $$;
create trigger test_fail_delete before delete on public.student_bookings
    for each row when (old.student_id = 'd3000000-0000-4000-8000-000000000051' and old.booking_type = 'reschedule')
    execute function public.test_force_failure();
select pg_temp.expect_reject(pg_temp.reopen(51), '%forced failure%');
select pg_temp.expect_reject(pg_temp.cancel(51), '%forced failure%');   -- cancel: fails after source restored + obligation cancelled
do $$ begin
    if (select attendance_status from public.student_bookings where id = pg_temp.u('d2', 51)) <> 'rescheduled' then raise exception 'cancel rollback left source restored'; end if;
    if (select status from public.makeup_obligations where id = pg_temp.ob(51)) <> 'scheduled' then raise exception 'cancel rollback left obligation changed'; end if;
end $$;
drop trigger test_fail_delete on public.student_bookings;
drop function public.test_force_failure();
do $$ begin perform public.reopen_reschedule_assignment(pg_temp.ob(51)); perform public.cancel_reschedule(pg_temp.ob(52)); end $$;  -- controls

-- =========================== AUTHORIZATION ===========================
do $$ begin perform pg_temp.mk_open(60); end $$;
set test.actor = '00000000-0000-4000-8000-000000000002';   -- non-admin
select pg_temp.expect_reject(pg_temp.asn(60, 3), 'You do not have permission to assign reschedules');
select pg_temp.expect_reject(pg_temp.reopen(1),  'You do not have permission to reassign reschedules');
select pg_temp.expect_reject(pg_temp.cancel(60), 'You do not have permission to cancel reschedules');
set test.actor = '';                                         -- unauthenticated
select pg_temp.expect_reject(pg_temp.asn(60, 3), 'You do not have permission to assign reschedules');
select pg_temp.expect_reject(pg_temp.cancel(60), 'You do not have permission to cancel reschedules');
set test.actor = '00000000-0000-4000-8000-000000000001';
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-000000000001';
select pg_temp.expect_reject(pg_temp.asn(60, 3), 'You do not have permission to assign reschedules');
update public.profiles set is_active = true where id = '00000000-0000-4000-8000-000000000001';

do $$
declare f text;
begin
    foreach f in array array['public.assign_reschedule_slot(uuid,uuid)', 'public.reopen_reschedule_assignment(uuid)', 'public.cancel_reschedule(uuid)'] loop
        if has_function_privilege('anon', f, 'execute') then raise exception 'anon must not execute %', f; end if;
        if has_function_privilege('public', f, 'execute') then raise exception 'PUBLIC must not execute %', f; end if;
        if not has_function_privilege('authenticated', f, 'execute') then raise exception 'authenticated must execute %', f; end if;
        if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception '% must be SECURITY DEFINER', f; end if;
        if not exists (select 1 from pg_proc where oid = f::regprocedure and proconfig @> array['search_path=""']) then raise exception '% must pin search_path', f; end if;
    end loop;
    raise notice 'atomic reschedule lifecycle: all assertions passed';
end $$;
