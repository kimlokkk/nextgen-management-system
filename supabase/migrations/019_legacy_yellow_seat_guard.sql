-- Apply only to staging/local until the whole legacy import has been reviewed.
-- Reserve historically confirmed MTDC Excel yellow seats WITHOUT creating
-- regular bookings, replacement obligations, or fictitious attendance.
-- The existing 81 rows remain the source of truth.

-- One-to-one identity-safe linkage for a future explicit migration of an
-- individual legacy reservation to an actual, active replacement booking.
-- If a linked booking later moves/cancels, the legacy reservation counts again.
alter table public.legacy_replacement_reviews
    add column linked_active_booking_id uuid unique
    references public.student_bookings(id) on delete set null;

create or replace function public.legacy_reserved_yellow_seats(
    p_class_session_id uuid
) returns integer
language sql stable security definer set search_path = ''
as $$
    select count(*)::integer
    from public.legacy_replacement_reviews r
    where r.target_class_id = p_class_session_id
      and r.review_state <> 'excluded'
      and (
        r.linked_active_booking_id is null
        or not exists (
            select 1 from public.student_bookings b
            where b.id = r.linked_active_booking_id
              and b.class_session_id = p_class_session_id
              and b.booking_type = 'replacement'
              and b.attendance_status not in ('cancelled', 'not_scheduled')
        )
      );
$$;

-- Internal function: never expose historical reservation totals via direct RPC.
revoke all on function public.legacy_reserved_yellow_seats(uuid)
from public, anon, authenticated;

-- Prevent accidental linking of two different students or target classes.
-- This trigger guards privileged future migrations, too.
create or replace function public.guard_legacy_booking_link()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
    v_booking record;
begin
    if new.linked_active_booking_id is null then return new; end if;
    select b.student_id, b.class_session_id, b.booking_type, s.full_name,
           b.attendance_status
    into v_booking
    from public.student_bookings b
    join public.students s on s.id = b.student_id
    where b.id = new.linked_active_booking_id;

    if not found or v_booking.class_session_id is distinct from new.target_class_id
       or v_booking.booking_type <> 'replacement'
       or v_booking.attendance_status in ('cancelled', 'not_scheduled')
       or lower(btrim(v_booking.full_name)) <> lower(btrim(new.student_name)) then
        raise exception 'Legacy link needs a matching active replacement, student and target class';
    end if;
    return new;
end;
$$;

create trigger trg_guard_legacy_booking_link
before insert or update of linked_active_booking_id, target_class_id
on public.legacy_replacement_reviews
for each row execute function public.guard_legacy_booking_link();

-- Central seat guard. Modern replacement RPCs already lock target classes,
-- but previously counted only student_bookings. This trigger also covers
-- any future write path and serializes capacity checks using the class lock.
create or replace function public.guard_yellow_seats_with_legacy()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
    v_capacity integer;
    v_active integer;
    v_legacy integer;
begin
    if new.booking_type <> 'replacement'
       or new.attendance_status in ('cancelled', 'not_scheduled') then
        return new;
    end if;

    -- Updating attendance on the SAME already-occupied yellow seat neither
    -- increases occupancy nor needs re-checking, even on historical overages.
    if tg_op = 'UPDATE' and old.class_session_id = new.class_session_id
       and old.booking_type = 'replacement'
       and old.attendance_status not in ('cancelled', 'not_scheduled') then
        return new;
    end if;

    select c.replacement_capacity into v_capacity
    from public.class_sessions c where c.id = new.class_session_id for update;
    if not found then raise exception 'Target class not found'; end if;

    select count(*) into v_active from public.student_bookings b
    where b.class_session_id = new.class_session_id
      and b.booking_type = 'replacement'
      and b.attendance_status not in ('cancelled', 'not_scheduled')
      and (tg_op = 'INSERT' or b.id <> new.id);

    v_legacy := public.legacy_reserved_yellow_seats(new.class_session_id);

    if v_active + v_legacy >= v_capacity then
        raise exception 'No yellow seats remain: % active + % Excel-confirmed legacy / % capacity',
            v_active, v_legacy, v_capacity;
    end if;
    return new;
end;
$$;

create trigger trg_guard_yellow_seats_with_legacy
before insert or update of class_session_id, booking_type, attendance_status
on public.student_bookings
for each row execute function public.guard_yellow_seats_with_legacy();

-- Capacity reductions must respect both active + historical occupied seats.
-- Do not auto-raise five MTDC 6/5 cases: the existing draft-only,
-- reason-and-audit capacity action is the required exception workflow.
create or replace function public.guard_yellow_capacity_reduction()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
    v_active integer;
    v_legacy integer;
begin
    if new.replacement_capacity >= old.replacement_capacity then return new; end if;
    select count(*) into v_active from public.student_bookings b
    where b.class_session_id = new.id and b.booking_type = 'replacement'
      and b.attendance_status not in ('cancelled', 'not_scheduled');
    v_legacy := public.legacy_reserved_yellow_seats(new.id);
    if new.replacement_capacity < (v_active + v_legacy) then
        raise exception 'Capacity below occupied seats: % active + % legacy confirmed',
            v_active, v_legacy;
    end if;
    return new;
end;
$$;

create trigger trg_guard_yellow_capacity_reduction
before update of replacement_capacity on public.class_sessions
for each row execute function public.guard_yellow_capacity_reduction();

-- Draft regeneration deletes/recreates class IDs. Prevent quietly orphaning
-- an Excel-confirmed reservation via the existing ON DELETE SET NULL FK.
-- Exclusion requires an audited admin decision through migration 018.
create or replace function public.guard_legacy_target_session_delete()
returns trigger language plpgsql security definer set search_path = ''
as $guard_legacy_target$
begin
    if exists (
        select 1 from public.legacy_replacement_reviews r
        where r.target_class_id = old.id
          and r.review_state <> 'excluded'
    ) then
        raise exception 'Cannot delete/regenerate class: confirmed legacy replacement reservations still target it';
    end if;
    return old;
end;
$guard_legacy_target$;

create trigger trg_guard_legacy_target_session_delete
before delete on public.class_sessions
for each row execute function public.guard_legacy_target_session_delete();

comment on column public.legacy_replacement_reviews.linked_active_booking_id is
    'Explicit one-to-one link for a verified matching modern booking; reserved seat is excluded only while the modern booking is actively occupying the SAME class.';

comment on function public.legacy_reserved_yellow_seats(uuid) is
    'Internal count of confirmed, not-excluded, not-yet-represented legacy seats; independent from attendance and entitlement.';
