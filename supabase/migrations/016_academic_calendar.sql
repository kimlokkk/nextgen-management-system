-- Academic Calendar V1: branch-wide, date-specific decisions.
-- Planning a closure NEVER mutates existing class bookings.
-- A branch/month with an approved or locked batch is immutable here.
-- Drafts made before edits are caught by schedule validation before approval.

create table academic_calendar_exceptions (
    id uuid primary key default gen_random_uuid(),
    branch_id uuid not null references branches(id),
    closed_on date not null,
    title text not null check (char_length(trim(title)) between 3 and 160),
    event_type text not null check (event_type in ('holiday', 'event', 'closure')),
    decision text not null default 'pending'
        check (decision in ('pending', 'move', 'skip', 'withdrawn')),
    target_on date,
    notes text,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (branch_id, closed_on),
    check (
        (decision = 'move' and target_on is not null)
        or (decision <> 'move' and target_on is null)
    ),
    check (
        target_on is null
        or (
            target_on > closed_on
            and date_trunc('month', target_on::timestamp) = date_trunc('month', closed_on::timestamp)
            and extract(dow from target_on) = extract(dow from closed_on)
        )
    )
);

create index idx_academic_calendar_branch_month
    on academic_calendar_exceptions(branch_id, closed_on);

-- Prevent bypassing the API's approved/locked protection and keep old events
-- as audit records instead of deleting them (withdrawn is the soft delete).
create function guard_academic_calendar_exception()
returns trigger
language plpgsql
as $$
declare
    blocked boolean;
begin
    if TG_OP = 'DELETE' then
        raise exception 'Withdraw calendar events instead of deleting them';
    end if;

    select exists(
        select 1 from schedule_batches b
        where b.branch_id = new.branch_id
          and b.schedule_month = date_trunc('month', new.closed_on::timestamp)::date
          and b.status in ('approved', 'locked')
    ) into blocked;

    if blocked then
        raise exception 'Calendar is frozen: this branch/month has an approved or locked schedule';
    end if;

    if TG_OP = 'UPDATE' then
        select exists(
            select 1 from schedule_batches b
            where b.branch_id = old.branch_id
              and b.schedule_month = date_trunc('month', old.closed_on::timestamp)::date
              and b.status in ('approved', 'locked')
        ) into blocked;

        if blocked then
            raise exception 'Cannot move or edit a calendar event from an approved or locked month';
        end if;

        new.updated_at = now();
    end if;

    return new;
end;
$$;

create trigger trg_guard_academic_calendar_exception
before insert or update or delete on academic_calendar_exceptions
for each row execute function guard_academic_calendar_exception();

alter table academic_calendar_exceptions enable row level security;

create policy "Active administrators can read academic calendar"
on academic_calendar_exceptions for select to authenticated
using (
    exists (
        select 1 from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('admin', 'super_admin')
    )
);

create policy "Active administrators can create academic calendar"
on academic_calendar_exceptions for insert to authenticated
with check (
    exists (
        select 1 from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('admin', 'super_admin')
    )
);

create policy "Active administrators can update academic calendar"
on academic_calendar_exceptions for update to authenticated
using (
    exists (
        select 1 from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('admin', 'super_admin')
    )
)
with check (
    exists (
        select 1 from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('admin', 'super_admin')
    )
);
