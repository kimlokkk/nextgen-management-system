-- Run after class_seat_reallocation_fixture.sql and migration 030. Synthetic data only.
-- Class A: locked month, 15+5, 6 regular booked, 4 active + 2 legacy replacement reserved (6 of 5).
create temp table baseline as
 select (select count(*) from public.student_bookings) bookings,
        (select count(*) from public.makeup_obligations) obligations,
        (select string_agg(id::text||attendance_status||booking_type, ',' order by id) from public.student_bookings) fingerprint;
grant select on baseline to authenticated;

set test.actor='00000000-0000-4000-8000-000000000001';

-- 1. The 6/5 case: move one seat regular -> replacement on a LOCKED month, total stays 20.
select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',15,5,14,6,
  'Sheet shows six replacement seats for this slot','MTDC Oct sheet, Sat 11:00');
do $t$ begin
  if (select regular_capacity||'+'||replacement_capacity from public.class_sessions where id='50000000-0000-4000-8000-00000000000a')<>'14+6' then
    raise exception 'Locked class was not reallocated to 14+6'; end if;
  if (select count(*) from public.class_seat_allocation_changes)<>1 then raise exception 'Audit row missing'; end if;
  if not exists (select 1 from public.class_seat_allocation_changes
      where old_regular=15 and old_replacement=5 and new_regular=14 and new_replacement=6
        and batch_status='locked' and source_ref='MTDC Oct sheet, Sat 11:00' and changed_by='00000000-0000-4000-8000-000000000001') then
    raise exception 'Audit row has wrong content'; end if;
  if (select regular_capacity||'+'||replacement_capacity from public.class_sessions where id='50000000-0000-4000-8000-00000000000b')<>'15+5' then
    raise exception 'A sibling class was modified'; end if;
end $t$;

-- 2. Rejections (each must leave data and audit untouched).
create function pg_temp.expect_fail(p_sql text, p_msg text) returns void language plpgsql as $f$
begin
  begin execute p_sql; raise exception 'ACCEPTED: %', p_sql;
  exception when raise_exception then
    if SQLERRM like 'ACCEPTED:%' or SQLERRM not like p_msg then raise exception 'Wrong error for [%]: %', p_sql, SQLERRM; end if;
  end;
end $f$;

select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',15,5,13,7,'Stale numbers should be refused','sheet ref')$q$, '%Seats changed since page load%');
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',14,6,14,7,'Raising the total must be refused','sheet ref')$q$, '%class total must stay 20%');
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',14,6,13,6,'Lowering the total must be refused','sheet ref')$q$, '%class total must stay 20%');
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',14,6,14,6,'Nothing changes so refuse it','sheet ref')$q$, '%matches the current%');
-- Class A has 6 regular booked: 5 regular would drop below them.
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',14,6,5,15,'Below booked regular seats','sheet ref')$q$, '%Regular seats cannot go below the 6%');
-- 4 active + 2 legacy (excluded one does not count) = 6 replacement reserved: 5 would drop below.
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',14,6,15,5,'Below reserved replacement seats','sheet ref')$q$, '%Replacement seats cannot go below the 6%');
-- Locked month needs a source reference.
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',14,6,13,7,'Missing source on locked month',null)$q$, '%source reference%');
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',14,6,13,7,'short','sheet ref')$q$, '%Explain the change%');
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',14,6,13,7,'Source too short should fail','ab')$q$, '%source reference must be%');
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000a',14,6,-1,21,'Negative seats refused','sheet ref')$q$, '%between 0 and 50%');
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-0000000000ff',1,1,2,0,'Unknown class is refused','sheet ref')$q$, '%Class session not found%');
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000d',15,5,14,6,'Cancelled class is refused','sheet ref')$q$, '%Only scheduled classes%');
-- Class C is approved, 10 regular booked of 10: cannot take a regular seat away.
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000c',10,5,9,6,'Regular seats are all in use','sheet ref')$q$, '%Regular seats cannot go below the 10%');

-- 3. Draft month: allowed without a source reference; the other direction (replacement -> regular) works too.
select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000b',15,5,16,4,'Admin prefers more regular seats here',null);
do $t$ begin
  if (select regular_capacity||'+'||replacement_capacity from public.class_sessions where id='50000000-0000-4000-8000-00000000000b')<>'16+4' then
    raise exception 'Draft reallocation failed'; end if;
  if (select count(*) from public.class_seat_allocation_changes)<>2 then raise exception 'Rejected calls left audit rows'; end if;
  if (select regular_capacity||'+'||replacement_capacity from public.class_sessions where id='50000000-0000-4000-8000-00000000000a')<>'14+6' then
    raise exception 'Rejected calls changed class A'; end if;
end $t$;

-- 4. Non-admin, deactivated admin and anonymous callers are refused; clients cannot write the audit table.
set test.actor='00000000-0000-4000-8000-000000000002';
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000b',16,4,15,5,'A parent must not do this','sheet ref')$q$, '%Only active admins%');
set test.actor='00000000-0000-4000-8000-000000000003';
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000b',16,4,15,5,'A deactivated admin must not','sheet ref')$q$, '%Only active admins%');
set test.actor='';
select pg_temp.expect_fail($q$select public.reallocate_class_seats('50000000-0000-4000-8000-00000000000b',16,4,15,5,'Nobody signed in must not','sheet ref')$q$, '%Only active admins%');

set test.actor='00000000-0000-4000-8000-000000000001';
set role authenticated;
do $t$ begin
  if (select count(*) from public.class_seat_allocation_changes)<>2 then raise exception 'Admin cannot read the audit'; end if;
  begin insert into public.class_seat_allocation_changes(branch_id,class_date,start_time,batch_status,old_regular,old_replacement,new_regular,new_replacement,reason)
        values ('10000000-0000-4000-8000-000000000001','2026-10-03','11:00','draft',1,1,2,0,'Direct insert must fail');
        raise exception 'Client wrote the audit table';
  exception when insufficient_privilege then null; end;
  begin update public.class_sessions set replacement_capacity=9 where id='50000000-0000-4000-8000-00000000000a';
        raise exception 'Client updated capacity directly';
  exception when insufficient_privilege then null; end;
end $t$;
set test.actor='00000000-0000-4000-8000-000000000002';
do $t$ begin
  if exists (select 1 from public.class_seat_allocation_changes) then raise exception 'Non-admin can read the audit'; end if;
end $t$;
reset role;

-- anon has no execute right at all
set role anon;
do $t$ begin
  begin perform public.reallocate_class_seats('50000000-0000-4000-8000-00000000000b',16,4,15,5,'Anon must not execute this','sheet ref');
        raise exception 'anon executed the RPC';
  exception when insufficient_privilege then null; end;
end $t$;
reset role;

-- 5. Bookings, attendance and obligations are exactly as before.
do $t$ declare b record; begin
  select * into b from baseline;
  if (select count(*) from public.student_bookings)<>b.bookings
     or (select count(*) from public.makeup_obligations)<>b.obligations
     or (select string_agg(id::text||attendance_status||booking_type, ',' order by id) from public.student_bookings) is distinct from b.fingerprint then
    raise exception 'Bookings, attendance or obligations changed'; end if;
end $t$;

select 'Class seat reallocation: total fixed, floors, locked-month source, admin-only, audit, no side effects passed' as result;
