-- All tests use fabricated records in a disposable CI postgres service.
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000001';
do $test$
declare
 v_batch uuid;
 v_rejected boolean;
begin
 -- A new month for branch A creates all expected classes and memberships.
 v_batch:=public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000001','2026-12-01');
 if (select count(*) from public.class_sessions where schedule_batch_id=v_batch)<>8 then
  raise exception 'Expected eight December teaching sessions'; end if;
 if (select count(*) from public.student_bookings b
  join public.class_sessions c on c.id=b.class_session_id where c.schedule_batch_id=v_batch)<>12 then
  raise exception 'Expected twelve real enrollment-based regular bookings';end if;
 if exists(select 1 from public.student_bookings b
  join public.class_sessions c on c.id=b.class_session_id where c.schedule_batch_id=v_batch
  and (b.booking_type<>'regular' or b.attendance_status<>'upcoming' or b.enrollment_id is null)) then
  raise exception 'Atomic generation wrote incorrect booking type/status';end if;
 if (select count(*) from public.student_bookings b
  join public.class_sessions c on c.id=b.class_session_id
  where c.schedule_batch_id=v_batch
   and c.session_template_id='40000000-0000-4000-8000-000000000001'
   and c.week_number=1)<>2 then
   raise exception 'W1 student allocation does not match preferred weeks';end if;
 -- Existing November draft and October history must remain untouched.
 if (select status from public.schedule_batches where id='60000000-0000-4000-8000-000000000001')<>'draft'
 or (select status from public.schedule_batches where id='60000000-0000-4000-8000-000000000002')<>'locked' then
  raise exception 'Protected historic batches mutated';end if;
 v_rejected:=false;
 begin
  perform public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000001','2026-12-01');
 exception when others then
  if SQLERRM like '%regeneration is disabled%' then v_rejected:=true;
  else raise;end if;
 end;
 if not v_rejected then raise exception 'Duplicate month allowed regeneration';end if;
 v_rejected:=false;
 begin
  perform public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000001','2026-11-01');
 exception when others then
  if SQLERRM like '%regeneration is disabled%' then v_rejected:=true;
  else raise;end if;
 end;
 if not v_rejected then raise exception 'Protected November was regenerated';end if;
 if (select count(*) from public.schedule_batches where branch_id=
  '10000000-0000-4000-8000-000000000001')<>3 then
  raise exception 'Unexpected schedule batch deletion or insertion';end if;
 raise notice 'PASS: atomic eight-class twelve-booking draft, no destructive regeneration';
end;$test$;

-- Academic calendar matching existing TS rules: January 2027 Saturday
-- Jan 2 W1, Jan 9 W2 -> Jan 30, Jan 16 W3 skip, Jan 23 W4.
reset role;
insert into public.academic_calendar_exceptions(branch_id,closed_on,decision,target_on)values
 ('10000000-0000-4000-8000-000000000002','2027-01-09','move','2027-01-30'),
 ('10000000-0000-4000-8000-000000000002','2027-01-16','skip',null);
set role authenticated;
do $test$
declare v_batch uuid;
begin
 v_batch:=public.generate_monthly_schedule_atomic(
  '10000000-0000-4000-8000-000000000002','2027-01-01');
 if (select count(*) from public.class_sessions where schedule_batch_id=v_batch)<>3
    or (select count(*) from public.student_bookings b
       join public.class_sessions c on c.id=b.class_session_id
       where c.schedule_batch_id=v_batch)<>3 then
    raise exception 'Move/skip classes did not match academic calendar';end if;
 if not exists(select 1 from public.class_sessions
  where schedule_batch_id=v_batch and class_date='2027-01-30' and week_number=2) then
  raise exception 'Calendar move lost original W2 position';end if;
 if exists(select 1 from public.class_sessions
   where schedule_batch_id=v_batch and class_date='2027-01-16') then
   raise exception 'Skipped calendar day generated a class';end if;
 raise notice 'PASS: calendar moved and skipped weeks preserve original W number';
end;$test$;

reset role;
insert into public.academic_calendar_exceptions(branch_id,closed_on,decision,target_on)
values ('10000000-0000-4000-8000-000000000002','2027-02-06','pending',null);
set role authenticated;
do $test$
declare v_rejected boolean:=false;
begin
 begin
  perform public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000002','2027-02-01');
 exception when others then
  if SQLERRM like '%decision pending%' then v_rejected:=true;else raise;end if;
 end;
 if not v_rejected or exists(select 1 from public.schedule_batches
  where branch_id='10000000-0000-4000-8000-000000000002' and schedule_month='2027-02-01') then
  raise exception 'Pending calendar day failed to roll back draft';end if;
 raise notice 'PASS: pending calendar rolls back entire draft';
end;$test$;

reset role;
update public.enrollments set status='active'
 where id='50000000-0000-4000-8000-000000000006';
set role authenticated;
do $test$
declare v_rejected boolean:=false;
begin
 begin
  perform public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000002','2027-03-01');
 exception when others then
  if SQLERRM like '%capacity exceeded%' then v_rejected:=true;else raise;end if;
 end;
 if not v_rejected or exists(select 1 from public.schedule_batches where
  branch_id='10000000-0000-4000-8000-000000000002' and schedule_month='2027-03-01') then
  raise exception 'Overcapacity did not atomically abort generation';end if;
 raise notice 'PASS: regular capacity overflow rolls back full batch';
end;$test$;

reset role;
update public.enrollments set status='paused' where id='50000000-0000-4000-8000-000000000006';
insert into public.enrollments values
 ('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000005',
 '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000003','weekly',null,'2027-04-01',null,'active');
update public.session_templates set regular_capacity=5
 where id='40000000-0000-4000-8000-000000000003';
set role authenticated;
do $test$
declare v_rejected boolean:=false;
begin
 begin
  perform public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000002','2027-04-01');
 exception when others then
  if SQLERRM like '%assigned twice%' then v_rejected:=true;else raise;end if;
 end;
 if not v_rejected or exists(select 1 from public.schedule_batches
  where branch_id='10000000-0000-4000-8000-000000000002' and schedule_month='2027-04-01') then
  raise exception 'Duplicate enrollment failed to roll back';end if;
 raise notice 'PASS: duplicate student assignment prevents entire draft';
end;$test$;

-- Unauthorized caller and invalid date; neither leaves any partial batch.
set test.actor='00000000-0000-4000-8000-000000000002';
do $test$
declare rejected boolean:=false;
begin
 begin
  perform public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000002','2027-05-01');
 exception when others then
  if SQLERRM like '%Only active admins%' then rejected:=true;else raise;end if;
 end;
 if not rejected then raise exception 'Parent can generate a schedule';end if;
end;$test$;
set test.actor='00000000-0000-4000-8000-000000000003';
do $test$
declare rejected boolean:=false;
begin
 begin
  perform public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000002','2027-05-01');
 exception when others then
  if SQLERRM like '%Only active admins%' then rejected:=true;else raise;end if;
 end;
 if not rejected then raise exception 'Inactive admin can generate';end if;
end;$test$;
set test.actor='00000000-0000-4000-8000-000000000001';
do $test$
declare rejected boolean:=false;
begin
 begin
  perform public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000002','2027-05-12');
 exception when others then
  if SQLERRM like '%first calendar day%' then rejected:=true;else raise;end if;
 end;
 if not rejected then raise exception 'Non-month-start date accepted';end if;
end;$test$;

-- Failure injected AFTER two successful booking writes in the same RPC.
-- An exception MUST undo even earlier batch + session + booking INSERTs.
reset role;
delete from public.enrollments where id='50000000-0000-4000-8000-000000000007';
create function public.inject_atomic_booking_failure() returns trigger
language plpgsql as $$
begin
 if exists (
  select 1 from public.class_sessions c
  join public.schedule_batches b on b.id=c.schedule_batch_id
  where c.id=new.class_session_id and b.schedule_month='2027-06-01'
 ) and (
  select count(*) from public.student_bookings b
  join public.class_sessions c on c.id=b.class_session_id
  join public.schedule_batches sb on sb.id=c.schedule_batch_id
  where sb.schedule_month='2027-06-01'
 )>=2 then
  raise exception 'UAT injected write failure after second regular booking';
 end if;
 return new;
end;$$;
create trigger trg_inject_atomic_booking_failure
after insert on public.student_bookings
for each row execute function public.inject_atomic_booking_failure();
set role authenticated;
do $test$
declare v_rejected boolean:=false;
begin
 begin
  perform public.generate_monthly_schedule_atomic(
   '10000000-0000-4000-8000-000000000002','2027-06-01');
 exception when others then
  if SQLERRM like '%UAT injected write failure%' then v_rejected:=true;else raise;end if;
 end;
 if not v_rejected then raise exception 'Injected failure was ignored';end if;
 if exists(select 1 from public.schedule_batches where
  branch_id='10000000-0000-4000-8000-000000000002' and schedule_month='2027-06-01')
 or exists(select 1 from public.class_sessions c join public.schedule_batches b
  on b.id=c.schedule_batch_id where b.schedule_month='2027-06-01') then
  raise exception 'Atomic rollback left a half-written schedule';end if;
 if (select count(*) from public.student_bookings)<>12+3 then
  raise exception 'Atomic failure left an extra booking';end if;
 raise notice 'PASS: injected mid-transaction exception rolls back every write';
end;$test$;
reset role;
select 'ATOMIC GENERATION INTEGRATION: all synthetic cases passed' as result;
