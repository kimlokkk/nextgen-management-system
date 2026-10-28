-- Run after enrollment_changes_fixture.sql and migration 031. Synthetic data only.
-- Ids: admin 0001, parent 0002, deactivated admin 0003. Students 3...01-06. Templates 6...01-06 (see fixture).
create temp table baseline as
 select (select count(*) from public.student_bookings) bookings,
        (select string_agg(id::text||coalesce(enrollment_id::text,''),',' order by id) from public.student_bookings) fingerprint;
grant select on baseline to authenticated;

create function pg_temp.expect_fail(p_sql text, p_msg text) returns void language plpgsql as $f$
begin
  begin execute p_sql; raise exception 'ACCEPTED: %', p_sql;
  exception when raise_exception then
    if SQLERRM like 'ACCEPTED:%' or SQLERRM not like p_msg then raise exception 'Wrong error for [%]: %', p_sql, SQLERRM; end if;
  end;
end $f$;

set test.actor='00000000-0000-4000-8000-000000000001';

-- 1. Create: slot, branch and programme come from the template; audit row written.
select public.create_enrollment('30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','weekly',null,'2026-11-01');
do $t$ begin
  if not exists (select 1 from public.enrollments where student_id='30000000-0000-4000-8000-000000000001'
      and default_session_id='60000000-0000-4000-8000-000000000001' and branch_id='10000000-0000-4000-8000-000000000001'
      and programme_id='20000000-0000-4000-8000-000000000001' and status='active' and preferred_weeks is null) then
    raise exception 'Created enrollment has wrong content'; end if;
  if (select count(*) from public.enrollment_changes where action='create')<>1 then raise exception 'Create not audited'; end if;
end $t$;

-- 2. Frequency and week rules.
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','weekly','{1}','2026-11-01')$q$,'%does not use preferred weeks%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','twice_monthly','{1}','2026-11-01')$q$,'%exactly two%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','twice_monthly','{1,2,3}','2026-11-01')$q$,'%exactly two%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','twice_monthly','{1,5}','2026-11-01')$q$,'%weeks from 1 to 4%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','twice_monthly',null,'2026-11-01')$q$,'%weeks from 1 to 4%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','custom',null,'2026-11-01')$q$,'%weeks from 1 to 4%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','daily',null,'2026-11-01')$q$,'%Choose weekly%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000005','weekly',null,'2026-11-01')$q$,'%slot is not available%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000001','weekly',null,'2026-11-01')$q$,'%student is not active%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','weekly',null,null)$q$,'%Choose the student%');

-- 3. Overlap: same slot, same time in another room and the same time in another branch are refused;
--    a second slot the same day that does not overlap in time is allowed.
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','weekly',null,'2026-11-01')$q$,'%overlapping time%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003','weekly',null,'2026-11-01')$q$,'%overlapping time%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000006','weekly',null,'2026-11-01')$q$,'%overlapping time%');
select public.create_enrollment('30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','weekly',null,'2026-11-01');   -- Sat 11:00 after Sat 09:00-10:30
select public.create_enrollment('30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000004','weekly',null,'2026-11-01');   -- Sunday
-- Twice monthly on different weeks of the same slot is fine; sharing a week is not.
select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','twice_monthly','{1,3}','2026-11-01');
select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','twice_monthly','{4,2}','2026-11-01');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','twice_monthly','{3,4}','2026-11-01')$q$,'%overlapping time%');
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','weekly',null,'2026-11-01')$q$,'%overlapping time%');
-- Duplicate and unsorted weeks are normalised; custom takes one or more weeks.
select public.create_enrollment('30000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000001','twice_monthly','{3,1,1}','2026-11-01');
do $t$ begin
  if (select preferred_weeks::text from public.enrollments where student_id='30000000-0000-4000-8000-000000000006')<>'{1,3}' then
    raise exception 'Weeks were not normalised'; end if;
end $t$;
select public.create_enrollment('30000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000002','custom','{2}','2026-11-01');

-- 4. Change from a date. Corrected in place only when it has no bookings and the date is not after its start.
select pg_temp.expect_fail($q$select public.change_enrollment('50000000-0000-4000-8000-000000000003','2026-11-01','60000000-0000-4000-8000-000000000004','weekly',null,'short')$q$,'%Explain the change%');
select pg_temp.expect_fail($q$select public.change_enrollment('50000000-0000-4000-8000-000000000003','2026-11-01','60000000-0000-4000-8000-000000000001','weekly',null,'Nothing differs from the current setting')$q$,'%Nothing changed%');
select pg_temp.expect_fail($q$select public.change_enrollment('50000000-0000-4000-8000-000000000003','2026-11-01','60000000-0000-4000-8000-000000000006','weekly',null,'Other branch slot must be refused')$q$,'%same branch%');
select pg_temp.expect_fail($q$select public.change_enrollment('50000000-0000-4000-8000-000000000003','2026-11-01','60000000-0000-4000-8000-000000000005','weekly',null,'Inactive slot must be refused')$q$,'%slot is not available%');
select pg_temp.expect_fail($q$select public.change_enrollment('50000000-0000-4000-8000-000000000004','2026-09-01','60000000-0000-4000-8000-000000000004','weekly',null,'Has bookings so in place is refused')$q$,'%already has bookings%');
create temp table r_inplace as
 select public.change_enrollment('50000000-0000-4000-8000-000000000003','2026-10-01','60000000-0000-4000-8000-000000000004','weekly',null,'Student actually attends on Sunday') r;
create temp table r_split as
 select public.change_enrollment('50000000-0000-4000-8000-000000000004','2026-11-01','60000000-0000-4000-8000-000000000002','twice_monthly','{2,4}','Moves to the later Saturday class twice a month') r;
do $t$ declare a jsonb; b jsonb; new_id uuid; begin
  select r into a from r_inplace; select r into b from r_split;
  if a->>'mode'<>'in_place' or (a->>'enrollment_id')::uuid<>'50000000-0000-4000-8000-000000000003' then raise exception 'In-place result wrong: %',a; end if;
  if not exists (select 1 from public.enrollments where id='50000000-0000-4000-8000-000000000003'
      and default_session_id='60000000-0000-4000-8000-000000000004' and start_date='2026-11-01') then
    raise exception 'In-place change not applied'; end if;
  new_id := (b->>'enrollment_id')::uuid;
  if b->>'mode'<>'split' or new_id='50000000-0000-4000-8000-000000000004' then raise exception 'Split result wrong: %',b; end if;
  if (b->>'bookings_on_or_after_date')::int<>2 then raise exception 'Expected 2 later bookings, got %',b; end if;
  if not exists (select 1 from public.enrollments where id='50000000-0000-4000-8000-000000000004'
      and end_date='2026-10-31' and status='active' and default_session_id='60000000-0000-4000-8000-000000000001' and frequency_type='weekly') then
    raise exception 'Old enrollment was not closed correctly'; end if;
  if not exists (select 1 from public.enrollments where id=new_id and start_date='2026-11-01' and end_date is null and status='active'
      and default_session_id='60000000-0000-4000-8000-000000000002' and frequency_type='twice_monthly' and preferred_weeks='{2,4}'
      and student_id='30000000-0000-4000-8000-000000000004') then
    raise exception 'New enrollment has wrong content'; end if;
  if (select count(*) from public.student_bookings where enrollment_id='50000000-0000-4000-8000-000000000004')<>4 then
    raise exception 'Old bookings were moved'; end if;
  if (select count(*) from public.enrollment_changes where action='change')<>2 then raise exception 'Changes not audited'; end if;
end $t$;
-- The closed row cannot be pushed past its own end; a conflicting change is refused.
select pg_temp.expect_fail($q$select public.change_enrollment('50000000-0000-4000-8000-000000000004','2026-12-01','60000000-0000-4000-8000-000000000004','weekly',null,'The old row already ended in October')$q$,'%ends before that date%');
select pg_temp.expect_fail(format($q$select public.change_enrollment(%L,'2026-11-01','60000000-0000-4000-8000-000000000001','weekly',null,'Would overlap the Saturday 09:00 class')$q$,
  (select id from public.enrollments where student_id='30000000-0000-4000-8000-000000000001' and default_session_id='60000000-0000-4000-8000-000000000002')),'%overlapping time%');

-- 5. Pause, resume, stop.
select public.set_enrollment_status('50000000-0000-4000-8000-000000000003','paused',null,'Family is away for the month');
do $t$ begin
  if (select status from public.enrollments where id='50000000-0000-4000-8000-000000000003')<>'paused' then raise exception 'Not paused'; end if;
  if (select count(*) from public.enrollment_changes where action='pause')<>1 then raise exception 'Pause not audited'; end if;
end $t$;
select pg_temp.expect_fail($q$select public.set_enrollment_status('50000000-0000-4000-8000-000000000003','paused',null,'Already paused should be refused')$q$,'%already paused%');
select pg_temp.expect_fail($q$select public.change_enrollment('50000000-0000-4000-8000-000000000003','2026-11-01','60000000-0000-4000-8000-000000000001','weekly',null,'A paused enrollment cannot be changed')$q$,'%Only an active enrollment%');
select public.set_enrollment_status('50000000-0000-4000-8000-000000000003','active',null,'Family is back, class continues');
-- Resume refuses when a new class now overlaps: pause one of S2's, add a replacement for the same weeks, then resume.
select public.set_enrollment_status((select id from public.enrollments where student_id='30000000-0000-4000-8000-000000000002' and preferred_weeks='{2,4}'),'paused',null,'Pause to test the resume overlap rule');
select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','twice_monthly','{2,4}','2026-11-01');
select pg_temp.expect_fail(format($q$select public.set_enrollment_status(%L,'active',null,'Resume must see the new overlapping class')$q$,
  (select id from public.enrollments where student_id='30000000-0000-4000-8000-000000000002' and preferred_weeks='{2,4}' and status='paused')),'%overlapping time%');
-- Stop: needs a last class date that is not before the start; a stopped enrollment is final.
create temp table s6 as select id from public.enrollments where student_id='30000000-0000-4000-8000-000000000006' and frequency_type='custom';
select pg_temp.expect_fail(format($q$select public.set_enrollment_status(%L,'stopped','2026-10-01','Last date is before the start')$q$,(select id from s6)),'%last class date%');
select pg_temp.expect_fail(format($q$select public.set_enrollment_status(%L,'stopped',null,'No last date was given at all')$q$,(select id from s6)),'%last class date%');
select public.set_enrollment_status((select id from s6),'stopped','2026-12-31','Student has left the programme');
do $t$ begin
  if not exists (select 1 from public.enrollments where id=(select id from s6) and status='stopped' and end_date='2026-12-31') then
    raise exception 'Stop not applied'; end if;
end $t$;
select pg_temp.expect_fail(format($q$select public.set_enrollment_status(%L,'active',null,'A stopped enrollment stays stopped')$q$,(select id from s6)),'%stopped enrollment cannot be changed%');
select pg_temp.expect_fail(format($q$select public.change_enrollment(%L,'2027-01-01','60000000-0000-4000-8000-000000000001','weekly',null,'A stopped enrollment stays stopped')$q$,(select id from s6)),'%Only an active enrollment%');
-- A stopped enrollment no longer counts as active, so the same slot can be added again.
select public.create_enrollment('30000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000002','custom','{2}','2027-01-01');

-- 6. Only active admins.
set test.actor='00000000-0000-4000-8000-000000000002';
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000004','weekly',null,'2026-11-01')$q$,'%Only active admins%');
select pg_temp.expect_fail($q$select public.change_enrollment('50000000-0000-4000-8000-000000000003','2026-11-01','60000000-0000-4000-8000-000000000001','weekly',null,'A parent must not change this')$q$,'%Only active admins%');
select pg_temp.expect_fail($q$select public.set_enrollment_status('50000000-0000-4000-8000-000000000003','paused',null,'A parent must not pause this')$q$,'%Only active admins%');
set test.actor='00000000-0000-4000-8000-000000000003';
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000004','weekly',null,'2026-11-01')$q$,'%Only active admins%');
set test.actor='';
select pg_temp.expect_fail($q$select public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000004','weekly',null,'2026-11-01')$q$,'%Only active admins%');

-- 7. Permissions as a signed-in user: no direct writes, row locking still works, audit is read-only.
set test.actor='00000000-0000-4000-8000-000000000001';
set role authenticated;
do $t$ begin
  begin insert into public.enrollments(student_id,branch_id,programme_id,default_session_id,start_date)
        values ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000004','2026-11-01');
        raise exception 'Client inserted an enrollment directly';
  exception when insufficient_privilege then null; end;
  begin update public.enrollments set status='stopped' where id='50000000-0000-4000-8000-000000000003';
        raise exception 'Client updated an enrollment directly';
  exception when insufficient_privilege then null; end;
  begin update public.enrollments set default_session_id='60000000-0000-4000-8000-000000000001' where id='50000000-0000-4000-8000-000000000003';
        raise exception 'Client moved an enrollment directly';
  exception when insufficient_privilege then null; end;
  begin delete from public.enrollments where id='50000000-0000-4000-8000-000000000003';
        raise exception 'Client deleted an enrollment directly';
  exception when insufficient_privilege then null; end;
  -- The schedule generator takes FOR SHARE locks on enrollments; that must keep working.
  perform 1 from public.enrollments e where e.status='active' for share;
  begin insert into public.enrollment_changes(branch_id,action) values ('10000000-0000-4000-8000-000000000001','create');
        raise exception 'Client wrote the audit table';
  exception when insufficient_privilege then null; end;
  begin perform public.enrollment_schedule_conflict('30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','weekly',null,'2026-11-01',null,null);
        raise exception 'Client ran an internal helper';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.enrollment_changes)<9 then raise exception 'Admin cannot read the audit'; end if;
end $t$;
set test.actor='00000000-0000-4000-8000-000000000002';
do $t$ begin
  if exists (select 1 from public.enrollment_changes) then raise exception 'Non-admin can read the audit'; end if;
end $t$;
reset role;
set role anon;
do $t$ begin
  begin perform public.create_enrollment('30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000004','weekly',null,'2026-11-01');
        raise exception 'anon executed create_enrollment';
  exception when insufficient_privilege then null; end;
end $t$;
reset role;

-- 8. No booking was created, moved or removed by any of this.
do $t$ declare b record; begin
  select * into b from baseline;
  if (select count(*) from public.student_bookings)<>b.bookings
     or (select string_agg(id::text||coalesce(enrollment_id::text,''),',' order by id) from public.student_bookings) is distinct from b.fingerprint then
    raise exception 'Bookings changed'; end if;
end $t$;

select 'Enrollment create/change/pause/stop: rules, overlap, history, permissions, audit and no booking changes passed' as result;
