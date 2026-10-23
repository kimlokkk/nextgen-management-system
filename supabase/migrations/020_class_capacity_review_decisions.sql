-- LOCAL/STAGING ONLY. The MTDC source records stay private and untouched.
-- Audited retain/expand decisions for ONE scheduled class in a draft batch.
create table public.class_replacement_capacity_reviews (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid references public.class_sessions(id) on delete set null,
  branch_id uuid not null references public.branches(id),
  class_date date not null,
  start_time time not null,
  decision text not null check (decision in ('retain','expand')),
  old_capacity integer not null check (old_capacity between 0 and 50),
  new_capacity integer not null check (new_capacity between 0 and 50),
  active_count integer not null check (active_count >= 0),
  legacy_count integer not null check (legacy_count >= 0),
  room_verified boolean not null default false,
  facilitator_verified boolean not null default false,
  verified_by text,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  check (
    (decision='retain' and new_capacity=old_capacity)
    or (decision='expand' and new_capacity>old_capacity
        and room_verified and facilitator_verified
        and char_length(btrim(coalesce(verified_by,''))) between 3 and 120)
  )
);
create index idx_class_replacement_capacity_reviews_session
on public.class_replacement_capacity_reviews(class_session_id,decided_at desc);

alter table public.class_replacement_capacity_reviews enable row level security;
revoke all on public.class_replacement_capacity_reviews from public, anon, authenticated;
grant select on public.class_replacement_capacity_reviews to authenticated;
create policy "Active admins read class yellow capacity reviews"
on public.class_replacement_capacity_reviews for select to authenticated
using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
  and p.is_active and p.role in ('admin','super_admin')
));

-- The previous capacity RPC did not require physical-space verification.
-- Revoke client access; only the verified wrapper may call it internally.
revoke execute on function public.adjust_class_replacement_capacity(uuid,integer,integer,text)
from authenticated;

create function public.decide_class_replacement_capacity(
  p_class_session_id uuid, p_expected_capacity integer, p_expected_occupied integer,
  p_decision text, p_new_capacity integer, p_room_verified boolean,
  p_facilitator_verified boolean, p_verified_by text, p_reason text
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_session record;
  v_active integer;
  v_legacy integer;
  v_new integer;
  v_reason text := btrim(coalesce(p_reason,''));
  v_verifier text := btrim(coalesce(p_verified_by,''));
  v_review uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
  ) then raise exception 'Only active admins can decide yellow capacity'; end if;
  if p_decision is null or p_decision not in ('retain','expand') then
    raise exception 'Choose retain or expand';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Explain the decision in 10 to 500 characters';
  end if;

  -- Same class-row lock used by yellow-seat booking guard.
  select c.id,c.branch_id,c.class_date,c.start_time,c.replacement_capacity,
         c.status as class_status,sb.status as batch_status
    into v_session
    from public.class_sessions c
    join public.schedule_batches sb on sb.id=c.schedule_batch_id
    where c.id=p_class_session_id for update of sb,c;
  if not found then raise exception 'Class session not found'; end if;
  if v_session.batch_status<>'draft' or v_session.class_status<>'scheduled' then
    raise exception 'Only scheduled classes in a draft batch can be reviewed';
  end if;
  if p_expected_capacity is distinct from v_session.replacement_capacity then
    raise exception 'Capacity changed since page load. Refresh and retry';
  end if;
  select count(*)::integer into v_active from public.student_bookings b
    where b.class_session_id=p_class_session_id and b.booking_type='replacement'
    and b.attendance_status not in ('cancelled','not_scheduled');
  v_legacy := public.legacy_reserved_yellow_seats(p_class_session_id);
  if p_expected_occupied is distinct from (v_active+v_legacy) then
    raise exception 'Yellow occupancy changed since page load. Refresh and retry';
  end if;

  if p_decision='retain' then
    if p_new_capacity is not null and p_new_capacity<>v_session.replacement_capacity then
      raise exception 'Retaining capacity cannot change seat limit';
    end if;
    v_new := v_session.replacement_capacity;
  else
    if p_room_verified is distinct from true
       or p_facilitator_verified is distinct from true
       or char_length(v_verifier) not between 3 and 120 then
      raise exception 'Verify room, facilitator and confirmer before expansion';
    end if;
    if p_new_capacity is null or p_new_capacity>50
       or p_new_capacity<=v_session.replacement_capacity
       or p_new_capacity<(v_active+v_legacy) then
      raise exception 'Expanded capacity must exceed current limit and cover occupied seats (max 50)';
    end if;
    -- Reuse migration 017 audit; all writes are one transaction.
    perform public.adjust_class_replacement_capacity(
      p_class_session_id,v_session.replacement_capacity,p_new_capacity,v_reason
    );
    v_new:=p_new_capacity;
  end if;

  insert into public.class_replacement_capacity_reviews (
    class_session_id,branch_id,class_date,start_time,decision,
    old_capacity,new_capacity,active_count,legacy_count,
    room_verified,facilitator_verified,verified_by,reason,decided_by
  ) values (
    v_session.id,v_session.branch_id,v_session.class_date,v_session.start_time,p_decision,
    v_session.replacement_capacity,v_new,v_active,v_legacy,
    coalesce(p_room_verified,false),coalesce(p_facilitator_verified,false),
    nullif(v_verifier,''),v_reason,v_actor
  ) returning id into v_review;
  return v_review;
end;
$fn$;
revoke all on function public.decide_class_replacement_capacity(
  uuid,integer,integer,text,integer,boolean,boolean,text,text
) from public,anon;
grant execute on function public.decide_class_replacement_capacity(
  uuid,integer,integer,text,integer,boolean,boolean,text,text
) to authenticated;
