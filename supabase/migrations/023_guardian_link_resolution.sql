-- Local/staging first. Explicit guardian relationship correction only.
create table public.student_guardian_link_audit (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.students(id) on delete restrict,
 parent_id uuid not null references public.parents(id) on delete restrict,
 relationship text not null check (relationship in ('father','mother','guardian')),
 evidence_reference text not null check (char_length(btrim(evidence_reference)) between 10 and 500),
 linked_by uuid references auth.users(id) on delete set null,
 linked_at timestamptz not null default now()
);
alter table public.student_guardian_link_audit enable row level security;
revoke all on public.student_guardian_link_audit from public,anon,authenticated;
grant select on public.student_guardian_link_audit to authenticated;
create policy "Admins view audited guardian corrections"
on public.student_guardian_link_audit for select to authenticated
using (exists(select 1 from public.profiles p where p.id=auth.uid()
 and p.is_active and p.role in ('admin','super_admin')));

create function public.resolve_missing_student_guardian(
 p_student_id uuid,p_parent_id uuid,p_relationship text,p_evidence_reference text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid:=auth.uid();
 v_status text;
 v_source text:=btrim(coalesce(p_evidence_reference,''));
 v_id uuid;
begin
 if v_actor is null or not exists(
  select 1 from public.profiles p where p.id=v_actor and p.is_active
  and p.role in ('admin','super_admin')
 ) then raise exception 'Only active admins can link guardians'; end if;
 if p_student_id is null or p_parent_id is null or
    p_relationship is null or p_relationship not in ('father','mother','guardian') then
  raise exception 'Select a verified parent and relationship';
 end if;
 if char_length(v_source) not between 10 and 500 then
  raise exception 'Provide source evidence (10 to 500 characters)';
 end if;

 -- Serialize all reconciliation on this student's row; prevents race
 -- between two concurrent missing-guardian correction attempts.
 select status into v_status from public.students
 where id=p_student_id for update;
 if not found or v_status<>'active' then
  raise exception 'Student unavailable or not active'; end if;
 if not exists(select 1 from public.parents where id=p_parent_id) then
  raise exception 'Selected parent unavailable';end if;
 if exists(select 1 from public.student_guardians where student_id=p_student_id) then
  raise exception 'Guardian already linked; refresh the page';end if;

 insert into public.student_guardians(student_id,parent_id,relationship,is_primary)
 values(p_student_id,p_parent_id,p_relationship,true)
 returning id into v_id;
 insert into public.student_guardian_link_audit
   (student_id,parent_id,relationship,evidence_reference,linked_by)
 values(p_student_id,p_parent_id,p_relationship,v_source,v_actor);
 return v_id;
end;
$$;
revoke all on function public.resolve_missing_student_guardian(uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.resolve_missing_student_guardian(uuid,uuid,text,text)
 to authenticated;
