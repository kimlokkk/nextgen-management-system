-- LOCAL/STAGING ONLY until release review.
-- Move seats between "regular" and "replacement" inside ONE class while the class total stays the same.
-- Admin-only, one transaction, one audit row per change. Works on draft, approved and locked
-- schedules because it never changes who is booked, only how the fixed number of seats is split.
-- This migration creates a table and a function only; it changes NO existing data.
-- It never touches bookings, attendance, obligations, enrollments or session templates.

create table public.class_seat_allocation_changes (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid references public.class_sessions(id) on delete set null,
  branch_id uuid not null references public.branches(id),
  class_date date not null,
  start_time time not null,
  batch_status text not null,
  old_regular integer not null check (old_regular >= 0),
  old_replacement integer not null check (old_replacement >= 0),
  new_regular integer not null check (new_regular >= 0),
  new_replacement integer not null check (new_replacement >= 0),
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  source_ref text check (source_ref is null or char_length(btrim(source_ref)) between 3 and 200),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  check (old_regular + old_replacement = new_regular + new_replacement),
  check (old_regular <> new_regular),
  check (batch_status = 'draft' or source_ref is not null)
);
create index idx_class_seat_allocation_changes_class
  on public.class_seat_allocation_changes(class_session_id, changed_at desc);

alter table public.class_seat_allocation_changes enable row level security;
revoke all on public.class_seat_allocation_changes from public, anon, authenticated;
grant select on public.class_seat_allocation_changes to authenticated;
create policy "Active admins read class seat allocation changes"
on public.class_seat_allocation_changes for select to authenticated
using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
  and p.is_active and p.role in ('admin','super_admin')
));

create function public.reallocate_class_seats(
  p_class_session_id uuid,
  p_expected_regular integer, p_expected_replacement integer,
  p_new_regular integer, p_new_replacement integer,
  p_reason text, p_source_ref text
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_source text := nullif(btrim(coalesce(p_source_ref,'')),'');
  v_class record;
  v_regular_used integer;
  v_active_repl integer;
  v_legacy_repl integer;
  v_audit uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can change class seat allocation'; end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Explain the change in 10 to 500 characters';
  end if;
  if v_source is not null and char_length(v_source) not between 3 and 200 then
    raise exception 'The source reference must be 3 to 200 characters';
  end if;
  if p_expected_regular is null or p_expected_replacement is null
     or p_new_regular is null or p_new_replacement is null
     or p_new_regular < 0 or p_new_replacement < 0
     or p_new_regular > 50 or p_new_replacement > 50 then
    raise exception 'Seat numbers must be between 0 and 50';
  end if;

  -- Lock order: batch, then class (same as the draft schedule edits).
  select c.id,c.branch_id,c.class_date,c.start_time,c.status as class_status,
         c.regular_capacity,c.replacement_capacity,sb.status as batch_status
    into v_class
    from public.class_sessions c
    join public.schedule_batches sb on sb.id=c.schedule_batch_id
    where c.id=p_class_session_id for update of sb,c;
  if not found then raise exception 'Class session not found'; end if;
  if v_class.class_status<>'scheduled' then
    raise exception 'Only scheduled classes can be changed';
  end if;
  if v_class.regular_capacity<>p_expected_regular
     or v_class.replacement_capacity<>p_expected_replacement then
    raise exception 'Seats changed since page load. Refresh and retry';
  end if;
  if p_new_regular + p_new_replacement <> v_class.regular_capacity + v_class.replacement_capacity then
    raise exception 'The class total must stay %. Move seats between regular and replacement only',
      v_class.regular_capacity + v_class.replacement_capacity;
  end if;
  if p_new_regular = v_class.regular_capacity then
    raise exception 'The new allocation matches the current one';
  end if;
  if v_class.batch_status<>'draft' and v_source is null then
    raise exception 'Give the source reference (for example the sheet and slot) for an approved or locked month';
  end if;

  select count(*)::integer into v_regular_used
    from public.student_bookings b
    where b.class_session_id=v_class.id
      and b.booking_type in ('regular','reschedule')
      and b.attendance_status not in ('rescheduled','cancelled','not_scheduled');
  if p_new_regular < v_regular_used then
    raise exception 'Regular seats cannot go below the % already booked', v_regular_used;
  end if;

  select count(*)::integer into v_active_repl
    from public.student_bookings b
    where b.class_session_id=v_class.id and b.booking_type='replacement'
      and b.attendance_status not in ('cancelled','not_scheduled');
  v_legacy_repl := public.legacy_reserved_yellow_seats(v_class.id);
  if p_new_replacement < v_active_repl + v_legacy_repl then
    raise exception 'Replacement seats cannot go below the % already reserved', v_active_repl + v_legacy_repl;
  end if;

  update public.class_sessions
     set regular_capacity=p_new_regular,
         replacement_capacity=p_new_replacement,
         updated_at=now()
   where id=v_class.id;

  insert into public.class_seat_allocation_changes (
    class_session_id,branch_id,class_date,start_time,batch_status,
    old_regular,old_replacement,new_regular,new_replacement,
    reason,source_ref,changed_by
  ) values (
    v_class.id,v_class.branch_id,v_class.class_date,v_class.start_time,v_class.batch_status,
    v_class.regular_capacity,v_class.replacement_capacity,p_new_regular,p_new_replacement,
    v_reason,v_source,v_actor
  ) returning id into v_audit;
  return v_audit;
end;
$fn$;

revoke all on function public.reallocate_class_seats(uuid,integer,integer,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.reallocate_class_seats(uuid,integer,integer,integer,integer,text,text) to authenticated;
