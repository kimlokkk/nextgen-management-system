-- Isolated fixture using the October legacy review created in earlier SQL tests.
-- Never run with real students or on cloud production.
set test.actor='00000000-0000-4000-8000-000000000001';
insert into public.legacy_replacement_reviews(
 source_batch,source_ref,branch_id,student_name,original_date,replacement_date,
 programme_code,start_time,end_time,technical_status,review_state
) values (
 'mtdc-2026-10','fixture-reconciliation','10000000-0000-4000-8000-000000000001',
 'Fixture Student',date '2026-09-05',date '2026-10-03','JR_MAKER',
 time '09:00',time '10:30','ORIGINAL_BOOKING_MISSING','pending'
);
do $t$
declare
 v_id uuid;
 v_b integer;
 v_o integer;
 v_s integer;
begin
 select id into v_id from public.legacy_replacement_reviews where source_ref='fixture-reconciliation';
 select count(*) into v_b from public.student_bookings;
 select count(*) into v_o from public.makeup_obligations;
 select count(*) into v_s from public.class_sessions;
 begin
  perform public.record_legacy_reconciliation_decision(v_id,null,'source_checked',
    false,true,'September roster row 5','Needs stronger identity proof');
  raise exception 'Unverified source check accepted';
 exception when raise_exception then
  if SQLERRM not like '%Confirm identity%' then raise; end if;
 end;

 begin
  perform public.record_legacy_reconciliation_decision(
   v_id,null,'source_correlated',false,false,'','Source correlation needs a documented reference');
  raise exception 'Missing correlation evidence reference accepted';
 exception when raise_exception then
  if SQLERRM not like '%Cite the source evidence reference%' then raise; end if;
 end;

 perform public.record_legacy_reconciliation_decision(
  v_id,null,'source_correlated',false,false,
  'September roster row 5','Name and date appear in historical roster only');
 if (select disposition from public.legacy_reconciliation_decisions where review_id=v_id)
   <> 'source_correlated' then raise exception 'Source correlation not saved'; end if;
 begin
  perform public.record_legacy_reconciliation_decision(
   v_id,null,'source_checked',true,true,
   'September roster row 5','Stale review version should be rejected');
  raise exception 'Stale reconciliation accepted';
 exception when raise_exception then
  if SQLERRM not like '%Review decision changed%' then raise; end if;
 end;

 perform public.record_legacy_reconciliation_decision(
  v_id,'source_correlated','source_checked',true,true,
  'Operations attendance ledger row 5','Operations confirmed identity and date separately');
 if (select count(*) from public.legacy_reconciliation_decision_audit where review_id=v_id)<>2 then
  raise exception 'Decision audit must have two history entries';
 end if;
 if (select count(*) from public.student_bookings)<>v_b or
     (select count(*) from public.makeup_obligations)<>v_o or
     (select count(*) from public.class_sessions)<>v_s then
  raise exception 'Evidence review mutated active operations';
 end if;
 if (select review_state from public.legacy_replacement_reviews where id=v_id)<>'pending' then
  raise exception 'Evidence reconciliation changed reservation exclusion status';
 end if;
end;
$t$;
set test.actor='00000000-0000-4000-8000-000000000002';
do $t$
declare v_id uuid;
begin
 select id into v_id from public.legacy_replacement_reviews where source_ref='fixture-reconciliation';
 begin
  perform public.record_legacy_reconciliation_decision(v_id,'source_checked',
   'needs_investigation',false,false,'','Parent should not review this source');
  raise exception 'Unauthorized user changed decision';
 exception when raise_exception then
  if SQLERRM not like '%Only active admins%' then raise; end if;
 end;
end;
$t$;
set role authenticated;
do $t$
begin
 if exists(select 1 from public.legacy_reconciliation_decisions) then
  raise exception 'Non-admin can read historical decisions';
 end if;
end;
$t$;
set test.actor='00000000-0000-4000-8000-000000000001';
do $t$
begin
 if (select count(*) from public.legacy_reconciliation_decisions)<>1 then
  raise exception 'Admin cannot read review results';
 end if;
 begin
  update public.legacy_reconciliation_decisions set disposition='needs_investigation';
  raise exception 'Direct client update to reviews allowed';
 exception when insufficient_privilege then null; end;
end;
$t$;
reset role;
select 'Reconciliation decision state, audit, read-only RLS, no operational changes passed' as result;
