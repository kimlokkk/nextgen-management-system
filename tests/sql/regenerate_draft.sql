-- Run after regenerate_draft_fixture.sql and migration 032. Synthetic data only.
-- Batches B1..B10 are described in the fixture. Admin 0001, parent 0002, deactivated admin 0003.
create function pg_temp.expect_fail(p_sql text, p_msg text) returns void language plpgsql as $f$
begin
  begin execute p_sql; raise exception 'ACCEPTED: %', p_sql;
  exception when raise_exception then
    if SQLERRM like 'ACCEPTED:%' or SQLERRM not like p_msg then raise exception 'Wrong error for [%]: %', p_sql, SQLERRM; end if;
  end;
end $f$;

set test.actor='00000000-0000-4000-8000-000000000001';

-- 1. Preview is read-only and tells the truth.
create temp table prev as select
  public.preview_draft_regeneration('40000000-0000-4000-8000-000000000001') clean,
  public.preview_draft_regeneration('40000000-0000-4000-8000-000000000002') edited,
  public.preview_draft_regeneration('40000000-0000-4000-8000-000000000003') attended,
  public.preview_draft_regeneration('40000000-0000-4000-8000-000000000009') locked_batch;
do $t$ declare p record; begin
  select * into p from prev;
  if (p.clean->>'can_regenerate')::boolean is not true or (p.clean->>'classes')::int<>1 or (p.clean->>'bookings')::int<>2 then
    raise exception 'Clean preview wrong: %',p.clean; end if;
  if (p.edited->>'manual_edits')::int<>1 or (p.edited->>'seat_changes')::int<>1 then
    raise exception 'Edited preview wrong (a reopen_draft row must not count): %',p.edited; end if;
  if (p.attended->>'can_regenerate')::boolean is not false or p.attended->'blockers'->>0 not like '%attendance%' then
    raise exception 'Attendance not reported as a blocker: %',p.attended; end if;
  if p.locked_batch->'blockers'->>0 not like '%locked%' then raise exception 'Locked not reported'; end if;
  if (public.preview_draft_regeneration('40000000-0000-4000-8000-0000000000ff')->>'found')::boolean then
    raise exception 'Unknown batch reported as found'; end if;
end $t$;

-- 2. Every blocker refuses, with a clear reason, and changes nothing.
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000003','Attendance is recorded already',true)$q$,'%attendance%');
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000004','There is a replacement booking',true)$q$,'%replacement or reschedule booking%');
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000005','A make-up record refers to it',true)$q$,'%make-up record%');
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000006','A historical reservation points at it',true)$q$,'%historical replacement reservation%');
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000007','A class is cancelled already',true)$q$,'%cancelled or completed%');
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000008','Approved months must be reopened first',true)$q$,'%Send this month back to draft%');
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000009','Locked months are final',true)$q$,'%locked schedule can never%');
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000001','short',false)$q$,'%Explain why%');
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-0000000000ff','Unknown schedule is refused',true)$q$,'%Schedule not found%');
do $t$ begin
  if (select count(*) from public.schedule_batches)<>10 or (select count(*) from public.schedule_draft_regenerations)<>0 then
    raise exception 'A refused call changed data or wrote audit'; end if;
end $t$;

-- 3. Losing manual work needs an explicit yes.
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000002','Rebuild after fixing enrollments',false)$q$,'%will lose 1 manual edit(s), 1 seat change(s)%');
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000002','Rebuild after fixing enrollments',null)$q$,'%will lose%');

-- 4. A failed generation keeps the old draft exactly as it was.
create temp table before_fail as select
  (select count(*) from public.class_sessions where schedule_batch_id='40000000-0000-4000-8000-00000000000a') classes,
  (select count(*) from public.student_bookings b join public.class_sessions c on c.id=b.class_session_id where c.schedule_batch_id='40000000-0000-4000-8000-00000000000a') bookings;
set test.fail_generation='1';
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-00000000000a','Generation will fail on purpose',true)$q$,'%Injected generation failure%');
set test.fail_generation='0';
do $t$ declare b record; begin
  select * into b from before_fail;
  if not exists (select 1 from public.schedule_batches where id='40000000-0000-4000-8000-00000000000a' and status='draft')
     or (select count(*) from public.class_sessions where schedule_batch_id='40000000-0000-4000-8000-00000000000a')<>b.classes
     or (select count(*) from public.student_bookings bk join public.class_sessions c on c.id=bk.class_session_id where c.schedule_batch_id='40000000-0000-4000-8000-00000000000a')<>b.bookings
     or (select count(*) from public.schedule_batches)<>10
     or (select count(*) from public.schedule_draft_regenerations)<>0 then
    raise exception 'A failed regeneration changed the old draft, left a stray batch or wrote an audit row'; end if;
end $t$;

-- 5. A clean draft is rebuilt: new batch, old one gone, audit row with the counts.
create temp table r1 as select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000001','Enrollments were corrected, rebuild',false) r;
do $t$ declare v jsonb; nb uuid; begin
  select r1.r into v from r1; nb := (v->>'new_batch_id')::uuid;
  if nb='40000000-0000-4000-8000-000000000001' or exists (select 1 from public.schedule_batches where id='40000000-0000-4000-8000-000000000001') then
    raise exception 'Old draft still exists or new batch has the same id'; end if;
  if not exists (select 1 from public.schedule_batches where id=nb and status='draft' and schedule_month='2026-11-01'
       and branch_id='10000000-0000-4000-8000-000000000001' and generated_by='00000000-0000-4000-8000-000000000001') then
    raise exception 'New batch is wrong'; end if;
  if (v->>'old_classes')::int<>1 or (v->>'old_bookings')::int<>2 or (v->>'new_classes')::int<>2 or (v->>'new_bookings')::int<>3 or (v->>'lost')::int<>0 then
    raise exception 'Result counts wrong: %',v; end if;
  if (select count(*) from public.class_sessions where schedule_batch_id='40000000-0000-4000-8000-000000000001')<>0 then
    raise exception 'Old classes survived'; end if;
  if not exists (select 1 from public.schedule_draft_regenerations where old_batch_id='40000000-0000-4000-8000-000000000001' and new_batch_id=nb
       and old_classes=1 and old_bookings=2 and new_classes=2 and new_bookings=3 and lost_manual_edits=0
       and reason='Enrollments were corrected, rebuild' and regenerated_by='00000000-0000-4000-8000-000000000001') then
    raise exception 'Audit row missing or wrong'; end if;
  if (select count(*) from public.schedule_batches where schedule_month='2026-11-01')<>1 then raise exception 'Duplicate month batch'; end if;
end $t$;

-- 6. With acknowledgement, manual work is lost, counted, and its history is kept.
create temp table r2 as select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000002','Rebuild and drop the manual changes',true) r;
do $t$ declare v jsonb; begin
  select r2.r into v from r2;
  if (v->>'lost')::int<>2 then raise exception 'Lost count wrong: %',v; end if;
  if not exists (select 1 from public.schedule_draft_regenerations where old_batch_id='40000000-0000-4000-8000-000000000002'
       and lost_manual_edits=1 and lost_seat_changes=1 and lost_capacity_decisions=0) then raise exception 'Lost counts not audited'; end if;
  if (select count(*) from public.draft_schedule_edits where schedule_batch_id is null)<>2 then
    raise exception 'Manual edit history should survive with no batch'; end if;
end $t$;

-- 7. Only active admins; clients cannot call helpers, write the audit or run it as anon.
set test.actor='00000000-0000-4000-8000-000000000002';
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000003','A parent must not rebuild',true)$q$,'%Only active admins%');
select pg_temp.expect_fail($q$select public.preview_draft_regeneration('40000000-0000-4000-8000-000000000003')$q$,'%Only active admins%');
set test.actor='00000000-0000-4000-8000-000000000003';
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000003','A deactivated admin must not',true)$q$,'%Only active admins%');
set test.actor='';
select pg_temp.expect_fail($q$select public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000003','Nobody signed in must not',true)$q$,'%Only active admins%');
set test.actor='00000000-0000-4000-8000-000000000001';
set role authenticated;
do $t$ begin
  begin insert into public.schedule_draft_regenerations(old_batch_id,branch_id,schedule_month,old_classes,old_bookings,new_classes,new_bookings,reason)
        values (gen_random_uuid(),'10000000-0000-4000-8000-000000000001','2026-01-01',0,0,0,0,'Direct insert must fail');
        raise exception 'Client wrote the audit table';
  exception when insufficient_privilege then null; end;
  begin perform public.draft_regeneration_facts('40000000-0000-4000-8000-000000000003');
        raise exception 'Client ran the internal helper';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.schedule_draft_regenerations)<>2 then raise exception 'Admin cannot read the audit'; end if;
end $t$;
set test.actor='00000000-0000-4000-8000-000000000002';
do $t$ begin
  if exists (select 1 from public.schedule_draft_regenerations) then raise exception 'Non-admin can read the audit'; end if;
end $t$;
reset role;
set role anon;
do $t$ begin
  begin perform public.regenerate_draft_schedule('40000000-0000-4000-8000-000000000003','Anon must not execute this',true);
        raise exception 'anon executed the RPC';
  exception when insufficient_privilege then null; end;
end $t$;
reset role;

select 'Draft regeneration: blockers, acknowledgement, atomic rollback, audit and permissions passed' as result;
