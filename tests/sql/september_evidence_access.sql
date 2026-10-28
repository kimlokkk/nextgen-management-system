
-- Ephemeral fixture; never insert real students in CI.
set test.actor='00000000-0000-4000-8000-000000000001';
insert into public.legacy_september_evidence
 (source_batch,source_ref,source_tab,source_row,evidence_kind,student_name,
  class_date,start_time,end_time,week_number,date_quality)
values ('mtdc-2026-09','fixture','fixture',1,'regular_roster',
 'TEST STUDENT',date '2026-09-05',time '09:00',time '10:30',1,'regular_week_header');
set role authenticated;
do $test$
begin
 if (select count(*) from public.legacy_september_evidence)<>1 then
  raise exception 'Admin could not read September evidence';
 end if;
 begin
  insert into public.legacy_september_evidence
   (source_batch,source_ref,source_tab,source_row,evidence_kind,student_name,
    class_date,start_time,end_time,week_number,date_quality)
  values ('mtdc-2026-09','nope','fixture',2,'regular_roster',
          'TEST',date '2026-09-05',time '09:00',time '10:30',1,'regular_week_header');
  raise exception 'Admin inserted into read-only source evidence';
 exception when insufficient_privilege then null;end;
end;$test$;
set test.actor='00000000-0000-4000-8000-000000000002';
do $test$
begin
 if exists(select 1 from public.legacy_september_evidence) then
  raise exception 'Non-admin read private September evidence';
 end if;
end;$test$;
reset role;
select 'September evidence privacy tests passed';
