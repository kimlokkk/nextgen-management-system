-- Per-class yellow-seat capacity adjustment: explicit, admin-only, and audited.
-- DO NOT apply to production until separately reviewed.
-- Adjustments never create replacement entitlements or bookings.

create table public.class_replacement_capacity_audit (
    id uuid primary key default gen_random_uuid(),
    class_session_id uuid references public.class_sessions(id) on delete set null,
    branch_id uuid not null references public.branches(id),
    class_date date not null,
    start_time time not null,
    old_capacity integer not null check (old_capacity >= 0),
    new_capacity integer not null check (new_capacity >= 0),
    reason text not null check (char_length(btrim(reason)) between 10 and 500),
    changed_by uuid references auth.users(id) on delete set null,
    changed_at timestamptz not null default now(),
    check (old_capacity <> new_capacity)
);

create index idx_class_replacement_capacity_audit_session
    on public.class_replacement_capacity_audit(class_session_id, changed_at desc);

alter table public.class_replacement_capacity_audit enable row level security;

create policy "Active administrators can read class replacement capacity audit"
on public.class_replacement_capacity_audit
for select to authenticated
using (
    exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.is_active = true
          and p.role in ('admin', 'super_admin')
    )
);

create or replace function public.adjust_class_replacement_capacity(
    p_class_session_id uuid,
    p_expected_capacity integer,
    p_new_capacity integer,
    p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_class record;
    v_occupied integer;
    v_reason text := btrim(coalesce(p_reason, ''));
begin
    if v_actor is null or not exists (
        select 1 from public.profiles p
        where p.id = v_actor and p.is_active = true
          and p.role in ('admin', 'super_admin')
    ) then
        raise exception 'Only active administrators can adjust class capacity';
    end if;

    if p_new_capacity is null or p_new_capacity < 0 or p_new_capacity > 50
       or p_expected_capacity is null then
        raise exception 'Replacement capacity must be between 0 and 50';
    end if;

    if char_length(v_reason) < 10 or char_length(v_reason) > 500 then
        raise exception 'Provide an explicit reason (10 to 500 characters)';
    end if;

    -- Lock batch and class to make draft-only edits and stale-value checks atomic.
    select c.id, c.branch_id, c.class_date, c.start_time, c.replacement_capacity,
           c.status as class_status, sb.status as batch_status
    into v_class
    from public.class_sessions c
    join public.schedule_batches sb on sb.id = c.schedule_batch_id
    where c.id = p_class_session_id
    for update of sb, c;

    if not found then
        raise exception 'Class session not found';
    end if;

    if v_class.batch_status <> 'draft' or v_class.class_status <> 'scheduled' then
        raise exception 'Only scheduled classes in a draft batch can be adjusted';
    end if;

    if v_class.replacement_capacity <> p_expected_capacity then
        raise exception 'Capacity changed since this page was opened. Refresh and review again';
    end if;

    if v_class.replacement_capacity = p_new_capacity then
        raise exception 'New capacity matches current capacity';
    end if;

    select count(*) into v_occupied
    from public.student_bookings b
    where b.class_session_id = p_class_session_id
      and b.booking_type = 'replacement'
      and b.attendance_status not in ('cancelled', 'not_scheduled');

    if p_new_capacity < v_occupied then
        raise exception 'Capacity cannot be lower than existing replacement bookings';
    end if;

    update public.class_sessions
    set replacement_capacity = p_new_capacity,
        updated_at = now()
    where id = p_class_session_id;

    insert into public.class_replacement_capacity_audit (
        class_session_id, branch_id, class_date, start_time,
        old_capacity, new_capacity, reason, changed_by
    ) values (
        v_class.id, v_class.branch_id, v_class.class_date, v_class.start_time,
        v_class.replacement_capacity, p_new_capacity, v_reason, v_actor
    );

    return p_new_capacity;
end;
$$;

revoke all on function public.adjust_class_replacement_capacity(uuid, integer, integer, text)
from public, anon;
grant execute on function public.adjust_class_replacement_capacity(uuid, integer, integer, text)
to authenticated;
