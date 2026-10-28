-- LOCAL/STAGING ONLY until release review.
-- Admin-only, audited ways to create and change enrollments, replacing direct table writes.
--   create_enrollment      add a regular slot for a student
--   change_enrollment      change slot / frequency / weeks FROM A DATE. The old row is closed the day before and a
--                          new row opens, so bookings already made keep pointing at the enrollment that created them.
--                          If the enrollment has no bookings and the date is not after its start, it is corrected in place.
--   set_enrollment_status  pause, resume or stop
-- Rules shared by all three: the slot comes from an active session template of the same branch (the programme is
-- taken from the template), weekly uses no weeks, twice monthly uses exactly two of weeks 1-4, and a student may not
-- have two active enrollments that overlap in time on the same day in the same week (two slots on one day that do
-- not overlap, such as 09:00-10:30 and 11:00-12:30, are allowed).
-- Nothing here changes an existing booking, class or schedule: the new rules apply to months generated afterwards.
-- Pause and stop both take the enrollment out of every month that is generated from now on (the generator only
-- reads active enrollments). Stop also records the last class date for reference; it does not keep the student in
-- part of a month that has not been generated yet.

create table public.enrollment_changes (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid references public.enrollments(id) on delete set null,
  new_enrollment_id uuid references public.enrollments(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  branch_id uuid not null references public.branches(id),
  action text not null check (action in ('create','change','pause','resume','stop')),
  effective_from date,
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(btrim(reason)) between 10 and 500),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  check (action='create' or reason is not null)
);
create index idx_enrollment_changes_enrollment on public.enrollment_changes(enrollment_id, changed_at desc);
create index idx_enrollment_changes_student on public.enrollment_changes(student_id, changed_at desc);

alter table public.enrollment_changes enable row level security;
revoke all on public.enrollment_changes from public, anon, authenticated;
grant select on public.enrollment_changes to authenticated;
create policy "Active admins read enrollment changes"
on public.enrollment_changes for select to authenticated
using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
  and p.is_active and p.role in ('admin','super_admin')
));

-- ---------------------------------------------------------------------
-- Internal helpers (not callable by clients).
-- ---------------------------------------------------------------------
create function public.normalize_enrollment_weeks(p_frequency text, p_weeks smallint[])
returns smallint[] language plpgsql immutable set search_path=''
as $fn$
declare v smallint[];
begin
  if p_frequency not in ('weekly','twice_monthly','custom') then
    raise exception 'Choose weekly, twice monthly or custom';
  end if;
  if p_frequency='weekly' then
    if p_weeks is not null and cardinality(p_weeks)>0 then
      raise exception 'A weekly enrollment does not use preferred weeks';
    end if;
    return null;
  end if;
  select array_agg(distinct w order by w) into v from unnest(coalesce(p_weeks,'{}'::smallint[])) w;
  if v is null or exists (select 1 from unnest(v) w where w not between 1 and 4) then
    raise exception 'Choose teaching weeks from 1 to 4';
  end if;
  if p_frequency='twice_monthly' and cardinality(v)<>2 then
    raise exception 'Twice monthly needs exactly two teaching weeks';
  end if;
  return v;
end
$fn$;

create function public.enrollment_schedule_conflict(
  p_student_id uuid, p_template_id uuid, p_frequency text, p_weeks smallint[],
  p_start date, p_end date, p_exclude uuid
) returns text language plpgsql stable security definer set search_path=''
as $fn$
declare
  v_weeks smallint[] := case when p_frequency='weekly' then array[1,2,3,4]::smallint[]
                             else coalesce(p_weeks,'{}'::smallint[]) end;
  v_t record;
  r record;
begin
  select t.day_of_week,t.start_time,t.end_time into v_t from public.session_templates t where t.id=p_template_id;
  for r in
    select e.frequency_type,e.preferred_weeks,t.day_of_week,t.start_time,t.end_time
    from public.enrollments e join public.session_templates t on t.id=e.default_session_id
    where e.student_id=p_student_id and e.status='active' and e.id is distinct from p_exclude
      and e.start_date <= coalesce(p_end,'infinity'::date)
      and coalesce(e.end_date,'infinity'::date) >= p_start
  loop
    if r.day_of_week=v_t.day_of_week
       and r.start_time < v_t.end_time and v_t.start_time < r.end_time
       and (case when r.frequency_type='weekly' then array[1,2,3,4]::smallint[]
                 else coalesce(r.preferred_weeks,'{}'::smallint[]) end) && v_weeks then
      return 'This student already has another active class at an overlapping time on the same day in the same week';
    end if;
  end loop;
  return null;
end
$fn$;

-- ---------------------------------------------------------------------
-- Create
-- ---------------------------------------------------------------------
create function public.create_enrollment(
  p_student_id uuid, p_default_session_id uuid, p_frequency_type text,
  p_preferred_weeks smallint[], p_start_date date
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_t record;
  v_weeks smallint[];
  v_conflict text;
  v_id uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can add enrollments'; end if;
  if p_student_id is null or p_default_session_id is null or p_start_date is null then
    raise exception 'Choose the student, the class slot and the start date';
  end if;

  perform 1 from public.students s where s.id=p_student_id for update;
  if not exists (select 1 from public.students s where s.id=p_student_id and s.status='active') then
    raise exception 'The student is not active';
  end if;
  select t.id,t.branch_id,t.programme_id into v_t
    from public.session_templates t where t.id=p_default_session_id and t.is_active;
  if not found then raise exception 'The class slot is not available'; end if;

  v_weeks := public.normalize_enrollment_weeks(p_frequency_type,p_preferred_weeks);
  v_conflict := public.enrollment_schedule_conflict(p_student_id,v_t.id,p_frequency_type,v_weeks,p_start_date,null,null);
  if v_conflict is not null then raise exception '%',v_conflict; end if;

  insert into public.enrollments(student_id,branch_id,programme_id,default_session_id,frequency_type,
                                 preferred_weeks,start_date,status)
  values (p_student_id,v_t.branch_id,v_t.programme_id,v_t.id,p_frequency_type,v_weeks,p_start_date,'active')
  returning id into v_id;

  insert into public.enrollment_changes(enrollment_id,new_enrollment_id,student_id,branch_id,action,effective_from,
                                        new_values,changed_by)
  values (v_id,v_id,p_student_id,v_t.branch_id,'create',p_start_date,
          jsonb_build_object('session_id',v_t.id,'frequency',p_frequency_type,'weeks',v_weeks,'start_date',p_start_date),
          v_actor);
  return v_id;
end
$fn$;

-- ---------------------------------------------------------------------
-- Change slot / frequency / weeks from a date
-- ---------------------------------------------------------------------
create function public.change_enrollment(
  p_enrollment_id uuid, p_effective_from date, p_default_session_id uuid,
  p_frequency_type text, p_preferred_weeks smallint[], p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_e record;
  v_t record;
  v_weeks smallint[];
  v_bookings integer;
  v_after integer;
  v_conflict text;
  v_new uuid;
  v_mode text;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can change enrollments'; end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Explain the change in 10 to 500 characters';
  end if;
  if p_enrollment_id is null or p_effective_from is null or p_default_session_id is null then
    raise exception 'Choose the class slot and the date the change starts';
  end if;

  select e.* into v_e from public.enrollments e where e.id=p_enrollment_id for update;
  if not found then raise exception 'Enrollment not found'; end if;
  perform 1 from public.students s where s.id=v_e.student_id for update;
  -- Re-read after taking the student lock so two admins cannot split the same row twice.
  select e.* into v_e from public.enrollments e where e.id=p_enrollment_id;

  if v_e.status<>'active' then
    raise exception 'Only an active enrollment can be changed. Resume it first, or add a new enrollment';
  end if;
  if not exists (select 1 from public.students s where s.id=v_e.student_id and s.status='active') then
    raise exception 'The student is not active';
  end if;
  select t.id,t.branch_id,t.programme_id into v_t
    from public.session_templates t where t.id=p_default_session_id and t.is_active;
  if not found then raise exception 'The class slot is not available'; end if;
  if v_t.branch_id<>v_e.branch_id then
    raise exception 'The class slot must be in the same branch as the enrollment';
  end if;

  v_weeks := public.normalize_enrollment_weeks(p_frequency_type,p_preferred_weeks);
  if v_t.id is not distinct from v_e.default_session_id
     and p_frequency_type=v_e.frequency_type
     and v_weeks is not distinct from v_e.preferred_weeks then
    raise exception 'Nothing changed';
  end if;
  if v_e.end_date is not null and v_e.end_date<p_effective_from then
    raise exception 'This enrollment ends before that date';
  end if;

  select count(*)::integer into v_bookings from public.student_bookings b where b.enrollment_id=v_e.id;

  if p_effective_from<=v_e.start_date then
    if v_bookings>0 then
      raise exception 'This enrollment already has bookings. Choose a date after its start date (%)',v_e.start_date;
    end if;
    v_conflict := public.enrollment_schedule_conflict(v_e.student_id,v_t.id,p_frequency_type,v_weeks,
                                                      v_e.start_date,v_e.end_date,v_e.id);
    if v_conflict is not null then raise exception '%',v_conflict; end if;
    update public.enrollments
       set default_session_id=v_t.id,programme_id=v_t.programme_id,frequency_type=p_frequency_type,
           preferred_weeks=v_weeks,updated_at=now()
     where id=v_e.id;
    v_new := v_e.id; v_mode := 'in_place';
  else
    v_conflict := public.enrollment_schedule_conflict(v_e.student_id,v_t.id,p_frequency_type,v_weeks,
                                                      p_effective_from,v_e.end_date,v_e.id);
    if v_conflict is not null then raise exception '%',v_conflict; end if;
    update public.enrollments set end_date=p_effective_from-1,updated_at=now() where id=v_e.id;
    insert into public.enrollments(student_id,branch_id,programme_id,default_session_id,frequency_type,
                                   preferred_weeks,start_date,end_date,status)
    values (v_e.student_id,v_e.branch_id,v_t.programme_id,v_t.id,p_frequency_type,v_weeks,
            p_effective_from,v_e.end_date,'active')
    returning id into v_new;
    v_mode := 'split';
  end if;

  select count(*)::integer into v_after
    from public.student_bookings b join public.class_sessions c on c.id=b.class_session_id
   where b.enrollment_id=v_e.id and c.class_date>=p_effective_from;

  insert into public.enrollment_changes(enrollment_id,new_enrollment_id,student_id,branch_id,action,effective_from,
                                        old_values,new_values,reason,changed_by)
  values (v_e.id,v_new,v_e.student_id,v_e.branch_id,'change',p_effective_from,
          jsonb_build_object('session_id',v_e.default_session_id,'frequency',v_e.frequency_type,
                             'weeks',v_e.preferred_weeks,'start_date',v_e.start_date,'end_date',v_e.end_date),
          jsonb_build_object('session_id',v_t.id,'frequency',p_frequency_type,'weeks',v_weeks,'mode',v_mode),
          v_reason,v_actor);

  return jsonb_build_object('enrollment_id',v_new,'mode',v_mode,'bookings_on_or_after_date',v_after);
end
$fn$;

-- ---------------------------------------------------------------------
-- Pause, resume, stop
-- ---------------------------------------------------------------------
create function public.set_enrollment_status(
  p_enrollment_id uuid, p_new_status text, p_end_date date, p_reason text
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_e record;
  v_conflict text;
  v_end date;
  v_action text;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can change enrollments'; end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Explain the change in 10 to 500 characters';
  end if;
  if p_new_status is null or p_new_status not in ('paused','active','stopped') then
    raise exception 'Choose pause, resume or stop';
  end if;

  select e.* into v_e from public.enrollments e where e.id=p_enrollment_id for update;
  if not found then raise exception 'Enrollment not found'; end if;
  perform 1 from public.students s where s.id=v_e.student_id for update;
  select e.* into v_e from public.enrollments e where e.id=p_enrollment_id;

  if v_e.status in ('stopped','completed') then
    raise exception 'A stopped enrollment cannot be changed. Add a new enrollment instead';
  end if;
  if v_e.status=p_new_status then raise exception 'The enrollment is already %',v_e.status; end if;
  v_end := v_e.end_date;

  if p_new_status='stopped' then
    if p_end_date is null or p_end_date<v_e.start_date then
      raise exception 'Give the last class date (not before the start date %)',v_e.start_date;
    end if;
    v_end := p_end_date; v_action := 'stop';
  elsif p_new_status='paused' then
    v_action := 'pause';
  else
    v_action := 'resume';
    if v_e.end_date is not null and v_e.end_date<(now() at time zone 'Asia/Kuala_Lumpur')::date then
      raise exception 'This enrollment ended on %. Add a new enrollment instead',v_e.end_date;
    end if;
    if not exists (select 1 from public.students s where s.id=v_e.student_id and s.status='active') then
      raise exception 'The student is not active';
    end if;
    if not exists (select 1 from public.session_templates t where t.id=v_e.default_session_id and t.is_active) then
      raise exception 'The class slot is no longer available. Add a new enrollment instead';
    end if;
    v_conflict := public.enrollment_schedule_conflict(v_e.student_id,v_e.default_session_id,v_e.frequency_type,
                                                      v_e.preferred_weeks,v_e.start_date,v_e.end_date,v_e.id);
    if v_conflict is not null then raise exception '%',v_conflict; end if;
  end if;

  update public.enrollments set status=p_new_status,end_date=v_end,updated_at=now() where id=v_e.id;

  insert into public.enrollment_changes(enrollment_id,new_enrollment_id,student_id,branch_id,action,effective_from,
                                        old_values,new_values,reason,changed_by)
  values (v_e.id,v_e.id,v_e.student_id,v_e.branch_id,v_action,v_end,
          jsonb_build_object('status',v_e.status,'end_date',v_e.end_date),
          jsonb_build_object('status',p_new_status,'end_date',v_end),v_reason,v_actor);
  return v_e.id;
end
$fn$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on function public.normalize_enrollment_weeks(text,smallint[]) from public,anon,authenticated;
revoke all on function public.enrollment_schedule_conflict(uuid,uuid,text,smallint[],date,date,uuid) from public,anon,authenticated;
revoke all on function public.create_enrollment(uuid,uuid,text,smallint[],date) from public,anon,authenticated;
revoke all on function public.change_enrollment(uuid,date,uuid,text,smallint[],text) from public,anon,authenticated;
revoke all on function public.set_enrollment_status(uuid,text,date,text) from public,anon,authenticated;
grant execute on function public.create_enrollment(uuid,uuid,text,smallint[],date) to authenticated;
grant execute on function public.change_enrollment(uuid,date,uuid,text,smallint[],text) to authenticated;
grant execute on function public.set_enrollment_status(uuid,text,date,text) to authenticated;

-- Clients may no longer write enrollments directly: every change goes through the audited functions above.
-- UPDATE is kept ONLY on updated_at because SELECT ... FOR SHARE (used by the monthly schedule generator
-- while it holds the enrollments steady) needs the UPDATE privilege on at least one column.
revoke insert, update, delete on public.enrollments from public, anon, authenticated;
grant update (updated_at) on public.enrollments to authenticated;
