-- LOCAL/STAGING ONLY until release review.
-- Draft-only, audited manual edits to a generated monthly schedule:
--   move a student to another class, remove a student from a class,
--   add a student to a class, and send an approved (not locked) month back to draft.
-- Every RPC is SECURITY DEFINER, admin-only, one transaction, and writes one audit row.
-- Enrollments are NEVER changed: these edits only affect that month's bookings.

alter table public.student_bookings
  add column manually_placed boolean not null default false;
comment on column public.student_bookings.manually_placed is
'True when an admin placed this regular booking by hand in a draft schedule. Approval validation then skips the "matches the enrollment slot" check for it.';

create table public.draft_schedule_edits (
  id uuid primary key default gen_random_uuid(),
  schedule_batch_id uuid references public.schedule_batches(id) on delete set null,
  branch_id uuid not null references public.branches(id),
  schedule_month date not null,
  action text not null check (action in ('move','remove','add','reopen_draft')),
  student_id uuid references public.students(id) on delete set null,
  from_class_id uuid references public.class_sessions(id) on delete set null,
  to_class_id uuid references public.class_sessions(id) on delete set null,
  from_class_date date,
  from_start_time time,
  to_class_date date,
  to_start_time time,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  edited_by uuid references auth.users(id) on delete set null,
  edited_at timestamptz not null default now(),
  check (
    (action='move' and student_id is not null and from_class_date is not null and to_class_date is not null)
    or (action='remove' and student_id is not null and from_class_date is not null and to_class_date is null)
    or (action='add' and student_id is not null and from_class_date is null and to_class_date is not null)
    or (action='reopen_draft' and student_id is null and from_class_date is null and to_class_date is null)
  )
);
create index idx_draft_schedule_edits_batch
  on public.draft_schedule_edits(schedule_batch_id, edited_at desc);

alter table public.draft_schedule_edits enable row level security;
revoke all on public.draft_schedule_edits from public, anon, authenticated;
grant select on public.draft_schedule_edits to authenticated;
create policy "Active admins read draft schedule edits"
on public.draft_schedule_edits for select to authenticated
using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
  and p.is_active and p.role in ('admin','super_admin')
));

-- ---------------------------------------------------------------------
-- Move one student's upcoming regular booking to another class in the SAME
-- draft month and programme.
-- ---------------------------------------------------------------------
create function public.move_student_in_draft(
  p_booking_id uuid, p_target_class_id uuid, p_reason text
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_first record;
  v_b record;
  v_src record;
  v_dst record;
  v_batch_status text;
  v_enr record;
  v_count integer;
  v_audit uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can edit a draft schedule'; end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Explain the change in 10 to 500 characters';
  end if;

  select b.class_session_id into v_first
    from public.student_bookings b where b.id=p_booking_id;
  if not found then raise exception 'Booking not found'; end if;
  if v_first.class_session_id = p_target_class_id then
    raise exception 'Choose a different class';
  end if;

  -- Lock order: batch, then both classes by id, then the booking.
  select sb.status into v_batch_status
    from public.class_sessions c
    join public.schedule_batches sb on sb.id=c.schedule_batch_id
    where c.id=v_first.class_session_id for update of sb;
  perform 1 from public.class_sessions c
    where c.id in (v_first.class_session_id,p_target_class_id)
    order by c.id for update;

  select b.id,b.student_id,b.enrollment_id,b.booking_type,b.attendance_status,b.class_session_id
    into v_b from public.student_bookings b where b.id=p_booking_id for update;
  if not found or v_b.class_session_id is distinct from v_first.class_session_id then
    raise exception 'Booking changed since page load. Refresh and retry';
  end if;

  select c.* into v_src from public.class_sessions c where c.id=v_b.class_session_id;
  select c.* into v_dst from public.class_sessions c where c.id=p_target_class_id;
  if v_dst.id is null then raise exception 'Target class not found'; end if;
  select sb.status into v_batch_status
    from public.schedule_batches sb where sb.id=v_src.schedule_batch_id;

  if v_batch_status<>'draft' then
    raise exception 'Only a draft schedule can be edited';
  end if;
  if v_dst.schedule_batch_id<>v_src.schedule_batch_id then
    raise exception 'Both classes must belong to the same monthly schedule';
  end if;
  if v_src.status<>'scheduled' or v_dst.status<>'scheduled' then
    raise exception 'Only scheduled classes can be changed';
  end if;
  if v_dst.programme_id<>v_src.programme_id or v_dst.branch_id<>v_src.branch_id then
    raise exception 'The target class must be the same programme and branch';
  end if;
  if v_b.booking_type<>'regular' or v_b.attendance_status<>'upcoming' then
    raise exception 'Only upcoming regular bookings can be moved';
  end if;
  if exists (
    select 1 from public.makeup_obligations o
    where o.source_booking_id=v_b.id or o.target_booking_id=v_b.id
  ) then raise exception 'This booking already has a follow-up. Cancel it first'; end if;
  if not exists (
    select 1 from public.students s where s.id=v_b.student_id and s.status='active'
  ) then raise exception 'Student is not active'; end if;

  select e.status,e.start_date,e.end_date into v_enr
    from public.enrollments e where e.id=v_b.enrollment_id;
  if not found then raise exception 'The booking has no enrollment'; end if;
  if v_enr.status<>'active'
     or v_enr.start_date>v_dst.class_date
     or (v_enr.end_date is not null and v_enr.end_date<v_dst.class_date) then
    raise exception 'The enrollment is not active on the target date';
  end if;

  if exists (
    select 1 from public.student_bookings b2
    where b2.class_session_id=v_dst.id and b2.student_id=v_b.student_id
  ) then raise exception 'Student already has a booking in that class'; end if;
  if exists (
    select 1 from public.student_bookings b2
    join public.class_sessions c2 on c2.id=b2.class_session_id
    where b2.student_id=v_b.student_id and b2.id<>v_b.id
      and c2.class_date=v_dst.class_date
      and c2.start_time<v_dst.end_time and v_dst.start_time<c2.end_time
      and b2.attendance_status not in ('rescheduled','cancelled','not_scheduled')
  ) then raise exception 'Student already has an overlapping class on that date'; end if;

  select count(*)::integer into v_count from public.student_bookings b2
    where b2.class_session_id=v_dst.id
      and b2.booking_type in ('regular','reschedule')
      and b2.attendance_status not in ('rescheduled','cancelled','not_scheduled');
  if v_count>=v_dst.regular_capacity then
    raise exception 'The target class is full (%/%)',v_count,v_dst.regular_capacity;
  end if;

  update public.student_bookings
    set class_session_id=v_dst.id, manually_placed=true, updated_at=now()
    where id=v_b.id;

  insert into public.draft_schedule_edits(
    schedule_batch_id,branch_id,schedule_month,action,student_id,
    from_class_id,to_class_id,from_class_date,from_start_time,
    to_class_date,to_start_time,reason,edited_by
  ) select v_src.schedule_batch_id,v_src.branch_id,sb.schedule_month,'move',v_b.student_id,
      v_src.id,v_dst.id,v_src.class_date,v_src.start_time,
      v_dst.class_date,v_dst.start_time,v_reason,v_actor
    from public.schedule_batches sb where sb.id=v_src.schedule_batch_id
    returning id into v_audit;
  return v_audit;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Remove one student's upcoming regular booking from a draft class.
-- ---------------------------------------------------------------------
create function public.remove_student_from_draft_class(
  p_booking_id uuid, p_reason text
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_first record;
  v_b record;
  v_src record;
  v_batch_status text;
  v_audit uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can edit a draft schedule'; end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Explain the change in 10 to 500 characters';
  end if;

  select b.class_session_id into v_first
    from public.student_bookings b where b.id=p_booking_id;
  if not found then raise exception 'Booking not found'; end if;

  select sb.status into v_batch_status
    from public.class_sessions c
    join public.schedule_batches sb on sb.id=c.schedule_batch_id
    where c.id=v_first.class_session_id for update of sb;
  perform 1 from public.class_sessions c where c.id=v_first.class_session_id for update;

  select b.id,b.student_id,b.booking_type,b.attendance_status,b.class_session_id
    into v_b from public.student_bookings b where b.id=p_booking_id for update;
  if not found or v_b.class_session_id is distinct from v_first.class_session_id then
    raise exception 'Booking changed since page load. Refresh and retry';
  end if;
  select c.* into v_src from public.class_sessions c where c.id=v_b.class_session_id;
  select sb.status into v_batch_status
    from public.schedule_batches sb where sb.id=v_src.schedule_batch_id;

  if v_batch_status<>'draft' then raise exception 'Only a draft schedule can be edited'; end if;
  if v_src.status<>'scheduled' then raise exception 'Only scheduled classes can be changed'; end if;
  if v_b.booking_type<>'regular' or v_b.attendance_status<>'upcoming' then
    raise exception 'Only upcoming regular bookings can be removed';
  end if;
  if exists (
    select 1 from public.makeup_obligations o
    where o.source_booking_id=v_b.id or o.target_booking_id=v_b.id
  ) then raise exception 'This booking already has a follow-up. Cancel it first'; end if;

  delete from public.student_bookings where id=v_b.id;

  insert into public.draft_schedule_edits(
    schedule_batch_id,branch_id,schedule_month,action,student_id,
    from_class_id,from_class_date,from_start_time,reason,edited_by
  ) select v_src.schedule_batch_id,v_src.branch_id,sb.schedule_month,'remove',v_b.student_id,
      v_src.id,v_src.class_date,v_src.start_time,v_reason,v_actor
    from public.schedule_batches sb where sb.id=v_src.schedule_batch_id
    returning id into v_audit;
  return v_audit;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Add a student to a draft class, using their active enrollment for the
-- same branch and programme.
-- ---------------------------------------------------------------------
create function public.add_student_to_draft_class(
  p_student_id uuid, p_class_id uuid, p_reason text
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_dst record;
  v_batch_status text;
  v_enrollment uuid;
  v_count integer;
  v_audit uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can edit a draft schedule'; end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Explain the change in 10 to 500 characters';
  end if;

  select sb.status into v_batch_status
    from public.class_sessions c
    join public.schedule_batches sb on sb.id=c.schedule_batch_id
    where c.id=p_class_id for update of sb;
  if not found then raise exception 'Class not found'; end if;
  select c.* into v_dst from public.class_sessions c where c.id=p_class_id for update;

  if v_batch_status<>'draft' then raise exception 'Only a draft schedule can be edited'; end if;
  if v_dst.status<>'scheduled' then raise exception 'Only scheduled classes can be changed'; end if;
  if not exists (
    select 1 from public.students s where s.id=p_student_id and s.status='active'
  ) then raise exception 'Student not found or not active'; end if;

  select e.id into v_enrollment from public.enrollments e
    where e.student_id=p_student_id and e.status='active'
      and e.branch_id=v_dst.branch_id and e.programme_id=v_dst.programme_id
      and e.start_date<=v_dst.class_date
      and (e.end_date is null or e.end_date>=v_dst.class_date)
    order by (e.default_session_id is not distinct from v_dst.session_template_id) desc,
             e.start_date, e.id
    limit 1;
  if v_enrollment is null then
    raise exception 'Student has no active enrollment for this programme on that date';
  end if;

  if exists (
    select 1 from public.student_bookings b2
    where b2.class_session_id=v_dst.id and b2.student_id=p_student_id
  ) then raise exception 'Student already has a booking in that class'; end if;
  if exists (
    select 1 from public.student_bookings b2
    join public.class_sessions c2 on c2.id=b2.class_session_id
    where b2.student_id=p_student_id
      and c2.class_date=v_dst.class_date
      and c2.start_time<v_dst.end_time and v_dst.start_time<c2.end_time
      and b2.attendance_status not in ('rescheduled','cancelled','not_scheduled')
  ) then raise exception 'Student already has an overlapping class on that date'; end if;

  select count(*)::integer into v_count from public.student_bookings b2
    where b2.class_session_id=v_dst.id
      and b2.booking_type in ('regular','reschedule')
      and b2.attendance_status not in ('rescheduled','cancelled','not_scheduled');
  if v_count>=v_dst.regular_capacity then
    raise exception 'The class is full (%/%)',v_count,v_dst.regular_capacity;
  end if;

  insert into public.student_bookings(
    class_session_id,student_id,enrollment_id,booking_type,attendance_status,manually_placed
  ) values (v_dst.id,p_student_id,v_enrollment,'regular','upcoming',true);

  insert into public.draft_schedule_edits(
    schedule_batch_id,branch_id,schedule_month,action,student_id,
    to_class_id,to_class_date,to_start_time,reason,edited_by
  ) select v_dst.schedule_batch_id,v_dst.branch_id,sb.schedule_month,'add',p_student_id,
      v_dst.id,v_dst.class_date,v_dst.start_time,v_reason,v_actor
    from public.schedule_batches sb where sb.id=v_dst.schedule_batch_id
    returning id into v_audit;
  return v_audit;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Send an APPROVED (not locked) month back to draft so it can be edited.
-- ---------------------------------------------------------------------
create function public.reopen_schedule_draft(
  p_batch_id uuid, p_reason text
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_batch record;
  v_audit uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can reopen a schedule'; end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Explain the change in 10 to 500 characters';
  end if;

  select sb.id,sb.branch_id,sb.schedule_month,sb.status into v_batch
    from public.schedule_batches sb where sb.id=p_batch_id for update;
  if not found then raise exception 'Schedule not found'; end if;
  if v_batch.status='locked' then
    raise exception 'A locked schedule cannot be reopened';
  end if;
  if v_batch.status<>'approved' then
    raise exception 'Only an approved schedule can be sent back to draft';
  end if;

  update public.schedule_batches
    set status='draft', approved_at=null, updated_at=now()
    where id=v_batch.id;

  insert into public.draft_schedule_edits(
    schedule_batch_id,branch_id,schedule_month,action,reason,edited_by
  ) values (v_batch.id,v_batch.branch_id,v_batch.schedule_month,'reopen_draft',v_reason,v_actor)
  returning id into v_audit;
  return v_audit;
end;
$fn$;

revoke all on function public.move_student_in_draft(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.remove_student_from_draft_class(uuid,text) from public,anon,authenticated;
revoke all on function public.add_student_to_draft_class(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.reopen_schedule_draft(uuid,text) from public,anon,authenticated;
grant execute on function public.move_student_in_draft(uuid,uuid,text) to authenticated;
grant execute on function public.remove_student_from_draft_class(uuid,text) to authenticated;
grant execute on function public.add_student_to_draft_class(uuid,uuid,text) to authenticated;
grant execute on function public.reopen_schedule_draft(uuid,text) to authenticated;
