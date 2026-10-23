-- Fixture only. Real student/parent records are NEVER included in GitHub CI.
create table public.parents(id uuid primary key,full_name text not null);
create table public.student_guardians(
 id uuid primary key default gen_random_uuid(),
 student_id uuid references public.students(id),
 parent_id uuid references public.parents(id),
 relationship text,
 is_primary boolean not null default false,
 unique(student_id,parent_id)
);
insert into public.parents(id,full_name) values
 ('90000000-0000-4000-8000-000000000001','Fixture guardian 1'),
 ('90000000-0000-4000-8000-000000000002','Fixture guardian 2');
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.profiles to authenticated;
set test.actor='00000000-0000-4000-8000-000000000001';
do $t$
declare
 link_id uuid;
 old_bookings integer;
begin
 select count(*) into old_bookings from public.student_bookings;
 begin
  perform public.resolve_missing_student_guardian(
   '30000000-0000-4000-8000-000000000001',
   '90000000-0000-4000-8000-000000000001','father','short');
  raise exception 'Short source was accepted';
 exception when raise_exception then
  if SQLERRM not like '%Provide source evidence%' then raise;end if;
 end;
 link_id:=public.resolve_missing_student_guardian(
  '30000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  'father','Signed enrollment sheet row 5');
 if link_id is null or (select count(*) from public.student_guardians
  where student_id='30000000-0000-4000-8000-000000000001' and is_primary)<>1
 then raise exception 'Primary guardian missing';end if;
 if (select count(*) from public.student_guardian_link_audit)<>1
 then raise exception 'Guardian audit missing';end if;
 begin
  perform public.resolve_missing_student_guardian(
   '30000000-0000-4000-8000-000000000001',
   '90000000-0000-4000-8000-000000000002',
   'mother','Another verified parent sheet');
  raise exception 'Duplicate guardian erroneously accepted';
 exception when raise_exception then
  if SQLERRM not like '%Guardian already linked%' then raise;end if;
 end;
 if (select count(*) from public.student_bookings)<>old_bookings
 then raise exception 'Booking history unexpectedly changed';end if;
end;$t$;
set test.actor='00000000-0000-4000-8000-000000000002';
do $t$
begin
 begin
  perform public.resolve_missing_student_guardian(
   '30000000-0000-4000-8000-000000000002',
   '90000000-0000-4000-8000-000000000001',
   'guardian','Operations verified identity');
  raise exception 'Non-admin linked a guardian';
 exception when raise_exception then
  if SQLERRM not like '%Only active admins%' then raise;end if;
 end;
end;$t$;
set role authenticated;
do $t$
begin
 if exists(select 1 from public.student_guardian_link_audit) then
  raise exception 'Non-admin saw audit';end if;
end;$t$;
set test.actor='00000000-0000-4000-8000-000000000001';
do $t$
begin
 if (select count(*) from public.student_guardian_link_audit)<>1 then
  raise exception 'Admin cannot read audit';end if;
 begin
  insert into public.student_guardian_link_audit(
    student_id,parent_id,relationship,evidence_reference
  ) values(
    '30000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'father','Client cannot insert audit');
  raise exception 'Direct audit insert allowed';
 exception when insufficient_privilege then null;end;
end;$t$;
reset role;
select 'Guardian resolution permissions, audit and data isolation passed';
