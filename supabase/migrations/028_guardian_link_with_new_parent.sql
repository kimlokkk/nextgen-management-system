-- Admin links a student to a parent who is not in the system yet, in ONE transaction:
-- the parent is created and linked through the same audited path as migration 023.
-- If linking fails for any reason (student already has a guardian, not active, bad evidence ...)
-- the new parent row is rolled back too, so no orphan parent is left behind.
create function public.resolve_missing_student_guardian_new_parent(
 p_student_id uuid,p_parent_name text,p_parent_phone text,p_relationship text,p_evidence_reference text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid:=auth.uid();
 v_name text:=btrim(coalesce(p_parent_name,''));
 v_phone text:=nullif(btrim(coalesce(p_parent_phone,'')),'');
 v_parent uuid;
 v_link uuid;
begin
 if v_actor is null or not exists(
  select 1 from public.profiles p where p.id=v_actor and p.is_active
  and p.role in ('admin','super_admin')
 ) then raise exception 'Only active admins can link guardians'; end if;
 if char_length(v_name) not between 3 and 160 then
  raise exception 'Parent full name must be 3 to 160 characters'; end if;
 if v_phone is not null and (char_length(v_phone)>30 or v_phone !~ '^[0-9+() -]+$') then
  raise exception 'Parent phone may contain only digits, spaces, + ( ) and -'; end if;
 insert into public.parents(full_name,phone) values(v_name,v_phone) returning id into v_parent;
 v_link:=public.resolve_missing_student_guardian(p_student_id,v_parent,p_relationship,p_evidence_reference);
 return v_link;
end;
$$;
revoke all on function public.resolve_missing_student_guardian_new_parent(uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.resolve_missing_student_guardian_new_parent(uuid,text,text,text,text)
 to authenticated;
