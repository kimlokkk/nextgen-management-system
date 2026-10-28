-- LOCAL/STAGING ONLY until release review.
-- Discard a DRAFT month and generate it again from today's enrollments, as ONE transaction:
-- if the new generation fails for any reason (an undecided calendar closure, a full class, ...),
-- the old draft is kept exactly as it was.
--   preview_draft_regeneration   read-only: what would be rebuilt, what would be lost, and anything that blocks it
--   regenerate_draft_schedule    do it (admin only, reason required, one audit row)
-- A draft can be rebuilt only while nothing real depends on it: no attendance or other booking status, no
-- replacement or reschedule booking, no make-up record, no historical replacement reservation and no cancelled
-- class. Manual changes made to the draft (moves, adds, removes, seat changes, capacity decisions) are lost, so the
-- caller must acknowledge them. Approved months must be sent back to draft first; locked months can never be rebuilt.

create table public.schedule_draft_regenerations (
  id uuid primary key default gen_random_uuid(),
  old_batch_id uuid not null,
  new_batch_id uuid references public.schedule_batches(id) on delete set null,
  branch_id uuid not null references public.branches(id),
  schedule_month date not null,
  old_classes integer not null,
  old_bookings integer not null,
  new_classes integer not null,
  new_bookings integer not null,
  lost_manual_edits integer not null default 0,
  lost_seat_changes integer not null default 0,
  lost_capacity_decisions integer not null default 0,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  regenerated_by uuid references auth.users(id) on delete set null,
  regenerated_at timestamptz not null default now()
);
create index idx_schedule_draft_regenerations_branch
  on public.schedule_draft_regenerations(branch_id, schedule_month, regenerated_at desc);

alter table public.schedule_draft_regenerations enable row level security;
revoke all on public.schedule_draft_regenerations from public, anon, authenticated;
grant select on public.schedule_draft_regenerations to authenticated;
create policy "Active admins read draft regenerations"
on public.schedule_draft_regenerations for select to authenticated
using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
  and p.is_active and p.role in ('admin','super_admin')
));

-- ---------------------------------------------------------------------
-- Internal: everything we need to know about a batch before rebuilding it.
-- ---------------------------------------------------------------------
create function public.draft_regeneration_facts(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare
  v_b record;
  v_classes integer; v_bookings integer;
  v_attendance integer; v_non_regular integer; v_obligations integer; v_legacy integer; v_not_scheduled integer;
  v_edits integer; v_seats integer; v_decisions integer;
  v_blockers jsonb := '[]'::jsonb;
begin
  select sb.id,sb.status,sb.branch_id,sb.schedule_month into v_b
    from public.schedule_batches sb where sb.id=p_batch_id;
  if not found then return jsonb_build_object('found',false); end if;

  select count(*)::integer into v_classes from public.class_sessions c where c.schedule_batch_id=v_b.id;
  select count(*)::integer into v_bookings from public.student_bookings b
    join public.class_sessions c on c.id=b.class_session_id where c.schedule_batch_id=v_b.id;
  select count(*)::integer into v_attendance from public.student_bookings b
    join public.class_sessions c on c.id=b.class_session_id
   where c.schedule_batch_id=v_b.id and b.attendance_status<>'upcoming';
  select count(*)::integer into v_non_regular from public.student_bookings b
    join public.class_sessions c on c.id=b.class_session_id
   where c.schedule_batch_id=v_b.id and b.booking_type<>'regular';
  select count(*)::integer into v_obligations from public.makeup_obligations o
   where o.source_booking_id in (select b.id from public.student_bookings b join public.class_sessions c on c.id=b.class_session_id where c.schedule_batch_id=v_b.id)
      or o.target_booking_id in (select b.id from public.student_bookings b join public.class_sessions c on c.id=b.class_session_id where c.schedule_batch_id=v_b.id);
  select count(*)::integer into v_legacy from public.legacy_replacement_reviews r
    join public.class_sessions c on c.id=r.target_class_id
   where c.schedule_batch_id=v_b.id and r.review_state<>'excluded';
  select count(*)::integer into v_not_scheduled from public.class_sessions c
   where c.schedule_batch_id=v_b.id and c.status<>'scheduled';
  select count(*)::integer into v_edits from public.draft_schedule_edits e
   where e.schedule_batch_id=v_b.id and e.action in ('move','remove','add');
  select count(*)::integer into v_seats from public.class_seat_allocation_changes s
    join public.class_sessions c on c.id=s.class_session_id where c.schedule_batch_id=v_b.id;
  select count(*)::integer into v_decisions from public.class_replacement_capacity_reviews d
    join public.class_sessions c on c.id=d.class_session_id where c.schedule_batch_id=v_b.id;

  if v_b.status='locked' then
    v_blockers := v_blockers || to_jsonb('A locked schedule can never be rebuilt'::text);
  elsif v_b.status='approved' then
    v_blockers := v_blockers || to_jsonb('Send this month back to draft first; only a draft can be rebuilt'::text);
  end if;
  if v_attendance>0 then
    v_blockers := v_blockers || to_jsonb(v_attendance||' booking(s) already have attendance or a status other than upcoming');
  end if;
  if v_non_regular>0 then
    v_blockers := v_blockers || to_jsonb(v_non_regular||' replacement or reschedule booking(s) are in this schedule');
  end if;
  if v_obligations>0 then
    v_blockers := v_blockers || to_jsonb(v_obligations||' make-up record(s) refer to bookings in this schedule');
  end if;
  if v_legacy>0 then
    v_blockers := v_blockers || to_jsonb(v_legacy||' historical replacement reservation(s) point at classes in this schedule');
  end if;
  if v_not_scheduled>0 then
    v_blockers := v_blockers || to_jsonb(v_not_scheduled||' class(es) are cancelled or completed');
  end if;

  return jsonb_build_object(
    'found',true,'status',v_b.status,'branch_id',v_b.branch_id,'schedule_month',v_b.schedule_month,
    'classes',v_classes,'bookings',v_bookings,
    'manual_edits',v_edits,'seat_changes',v_seats,'capacity_decisions',v_decisions,
    'blockers',v_blockers,'can_regenerate',(jsonb_array_length(v_blockers)=0));
end
$fn$;

-- ---------------------------------------------------------------------
-- Preview (read-only)
-- ---------------------------------------------------------------------
create function public.preview_draft_regeneration(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can rebuild a draft schedule'; end if;
  return public.draft_regeneration_facts(p_batch_id);
end
$fn$;

-- ---------------------------------------------------------------------
-- Discard and generate again, atomically
-- ---------------------------------------------------------------------
create function public.regenerate_draft_schedule(
  p_batch_id uuid, p_reason text, p_acknowledge_losses boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_b record;
  v_facts jsonb;
  v_lost integer;
  v_new uuid;
  v_new_classes integer; v_new_bookings integer;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can rebuild a draft schedule'; end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Explain why in 10 to 500 characters';
  end if;

  -- Lock order: batch, its classes, then their bookings, so no booking or attendance change can slip in.
  select sb.id,sb.branch_id,sb.schedule_month into v_b
    from public.schedule_batches sb where sb.id=p_batch_id for update;
  if not found then raise exception 'Schedule not found'; end if;
  perform 1 from public.class_sessions c where c.schedule_batch_id=v_b.id order by c.id for update;
  perform 1 from public.student_bookings b
   where b.class_session_id in (select c.id from public.class_sessions c where c.schedule_batch_id=v_b.id)
   order by b.id for update;

  v_facts := public.draft_regeneration_facts(v_b.id);
  if jsonb_array_length(v_facts->'blockers')>0 then
    raise exception 'This draft cannot be rebuilt: %',
      (select string_agg(x,'; ') from jsonb_array_elements_text(v_facts->'blockers') x);
  end if;
  v_lost := (v_facts->>'manual_edits')::integer + (v_facts->>'seat_changes')::integer
          + (v_facts->>'capacity_decisions')::integer;
  if v_lost>0 and coalesce(p_acknowledge_losses,false) is not true then
    raise exception 'Rebuilding will lose % manual edit(s), % seat change(s) and % capacity decision(s). Confirm to continue',
      v_facts->>'manual_edits',v_facts->>'seat_changes',v_facts->>'capacity_decisions';
  end if;

  delete from public.schedule_batches where id=v_b.id;      -- classes and bookings go with it
  -- Any failure inside the generator (pending calendar decision, full class, ...) rolls the delete back too.
  v_new := public.generate_monthly_schedule_atomic(v_b.branch_id,v_b.schedule_month);
  if v_new is null then raise exception 'Generation returned no schedule'; end if;

  select count(*)::integer into v_new_classes from public.class_sessions c where c.schedule_batch_id=v_new;
  select count(*)::integer into v_new_bookings from public.student_bookings b
    join public.class_sessions c on c.id=b.class_session_id where c.schedule_batch_id=v_new;

  insert into public.schedule_draft_regenerations(
    old_batch_id,new_batch_id,branch_id,schedule_month,old_classes,old_bookings,new_classes,new_bookings,
    lost_manual_edits,lost_seat_changes,lost_capacity_decisions,reason,regenerated_by
  ) values (
    v_b.id,v_new,v_b.branch_id,v_b.schedule_month,(v_facts->>'classes')::integer,(v_facts->>'bookings')::integer,
    v_new_classes,v_new_bookings,(v_facts->>'manual_edits')::integer,(v_facts->>'seat_changes')::integer,
    (v_facts->>'capacity_decisions')::integer,v_reason,v_actor);

  return jsonb_build_object('new_batch_id',v_new,'new_classes',v_new_classes,'new_bookings',v_new_bookings,
    'old_classes',(v_facts->>'classes')::integer,'old_bookings',(v_facts->>'bookings')::integer,'lost',v_lost);
end
$fn$;

revoke all on function public.draft_regeneration_facts(uuid) from public,anon,authenticated;
revoke all on function public.preview_draft_regeneration(uuid) from public,anon,authenticated;
revoke all on function public.regenerate_draft_schedule(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.preview_draft_regeneration(uuid) to authenticated;
grant execute on function public.regenerate_draft_schedule(uuid,text,boolean) to authenticated;
