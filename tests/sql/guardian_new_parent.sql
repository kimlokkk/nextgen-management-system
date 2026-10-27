-- Migration 028: create-parent-and-link is atomic, admin-only and validated. Synthetic data only.
set test.actor='00000000-0000-4000-8000-000000000001';
do $t$
declare v uuid; parents_before int;
begin
 v:=public.resolve_missing_student_guardian_new_parent('30000000-0000-4000-8000-000000000001','  Fixture New Parent ','012-345 6789','mother','Signed enrollment sheet row 7');
 if v is null then raise exception 'No link id returned'; end if;
 if (select count(*) from public.parents where full_name='Fixture New Parent' and phone='012-345 6789')<>1 then raise exception 'Parent not created (trimmed)'; end if;
 if (select count(*) from public.student_guardians where student_id='30000000-0000-4000-8000-000000000001' and is_primary and relationship='mother')<>1 then raise exception 'Primary link missing'; end if;
 if (select count(*) from public.student_guardian_link_audit where student_id='30000000-0000-4000-8000-000000000001')<>1 then raise exception 'Audit row missing'; end if;
 -- a failed link must not leave an orphan parent
 select count(*) into parents_before from public.parents;
 begin
  perform public.resolve_missing_student_guardian_new_parent('30000000-0000-4000-8000-000000000001','Fixture Second Parent',null,'father','Signed enrollment sheet row 8');
  raise exception 'Second guardian accepted';
 exception when raise_exception then if SQLERRM not like '%Guardian already linked%' then raise; end if; end;
 if (select count(*) from public.parents)<>parents_before then raise exception 'Orphan parent left behind after failed link'; end if;
 begin
  perform public.resolve_missing_student_guardian_new_parent('30000000-0000-4000-8000-000000000003','Fixture Inactive Parent',null,'father','Signed enrollment sheet row 9');
  raise exception 'Inactive student accepted';
 exception when raise_exception then if SQLERRM not like '%not active%' then raise; end if; end;
 begin
  perform public.resolve_missing_student_guardian_new_parent('30000000-0000-4000-8000-000000000002','Fixture Short Evidence',null,'father','short');
  raise exception 'Short evidence accepted';
 exception when raise_exception then if SQLERRM not like '%source evidence%' then raise; end if; end;
 begin
  perform public.resolve_missing_student_guardian_new_parent('30000000-0000-4000-8000-000000000002','ab',null,'father','Signed enrollment sheet row 10');
  raise exception 'Too-short name accepted';
 exception when raise_exception then if SQLERRM not like '%full name%' then raise; end if; end;
 begin
  perform public.resolve_missing_student_guardian_new_parent('30000000-0000-4000-8000-000000000002','Fixture Bad Phone','abc; drop','father','Signed enrollment sheet row 11');
  raise exception 'Bad phone accepted';
 exception when raise_exception then if SQLERRM not like '%phone%' then raise; end if; end;
 if (select count(*) from public.parents)<>parents_before then raise exception 'Rejected calls left parents behind'; end if;
end;$t$;
set test.actor='00000000-0000-4000-8000-000000000002';
do $t$
begin
 begin
  perform public.resolve_missing_student_guardian_new_parent('30000000-0000-4000-8000-000000000002','Fixture Staff Parent',null,'father','Signed enrollment sheet row 12');
  raise exception 'Non-admin created and linked a parent';
 exception when raise_exception then if SQLERRM not like '%Only active admins%' then raise; end if; end;
 if exists(select 1 from public.parents where full_name='Fixture Staff Parent') then raise exception 'Non-admin left a parent row'; end if;
end;$t$;
