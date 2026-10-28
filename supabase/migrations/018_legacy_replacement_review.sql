-- Legacy replacement evidence review, independent of active replacement entitlements.
-- No source rows or student names are embedded in this migration.
-- Does not create makeup_obligations or student_bookings.
create table public.legacy_replacement_reviews (
    id uuid primary key default gen_random_uuid(),
    source_batch text not null check (char_length(source_batch) between 3 and 80),
    source_ref text not null check (char_length(source_ref) between 1 and 200),
    branch_id uuid not null references public.branches(id),
    student_name text not null,
    source_tab text,
    source_row integer,
    original_date date,
    replacement_date date not null,
    programme_code text not null,
    space_number smallint,
    start_time time not null,
    end_time time not null,
    source_date_type text not null default 'unverified',
    technical_status text not null check (technical_status in (
        'ORIGINAL_BOOKING_MISSING',
        'SOURCE_LINK_CANDIDATE_ADMIN_REVIEW',
        'ORIGINAL_DATE_NOT_BEFORE_TARGET',
        'MISSING_OCTOBER_ROSTER_IDENTITY',
        'ORIGINAL_DATE_UNPARSED',
        'STUDENT_NOT_IN_LOCAL',
        'TARGET_CLASS_MISSING',
        'TARGET_CLASS_AMBIGUOUS',
        'ORIGINAL_BOOKING_AMBIGUOUS',
        'ORIGINAL_PROGRAMME_REVIEW',
        'ORIGINAL_MARKED_PRESENT_REVIEW'
    )),
    original_booking_id uuid references public.student_bookings(id) on delete set null,
    target_class_id uuid references public.class_sessions(id) on delete set null,
    source_booking_candidates integer not null default 0 check (source_booking_candidates >= 0),
    target_class_candidates integer not null default 0 check (target_class_candidates >= 0),
    over_capacity boolean not null default false,
    review_state text not null default 'pending'
        check (review_state in ('pending','evidence_requested','evidence_received','excluded')),
    review_note text not null default '' check (char_length(review_note) <= 2000),
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (source_batch, source_ref)
);

create index idx_legacy_replacement_reviews_queue
    on public.legacy_replacement_reviews (source_batch, technical_status, replacement_date);

create table public.legacy_replacement_review_audit (
    id uuid primary key default gen_random_uuid(),
    review_id uuid not null references public.legacy_replacement_reviews(id) on delete cascade,
    from_state text not null,
    to_state text not null,
    review_note text not null,
    actor_id uuid references auth.users(id) on delete set null,
    changed_at timestamptz not null default now()
);

alter table public.legacy_replacement_reviews enable row level security;
alter table public.legacy_replacement_review_audit enable row level security;

-- Only active admins can read. No client insert/update/delete grants;
-- the admin-only RPC below manages review decisions with audit history.
revoke all on public.legacy_replacement_reviews from public, anon, authenticated;
revoke all on public.legacy_replacement_review_audit from public, anon, authenticated;
grant select on public.legacy_replacement_reviews to authenticated;
grant select on public.legacy_replacement_review_audit to authenticated;

create policy "Active admins read legacy replacement review queue"
on public.legacy_replacement_reviews for select to authenticated
using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role in ('admin','super_admin')
));

create policy "Active admins read legacy replacement review audit"
on public.legacy_replacement_review_audit for select to authenticated
using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role in ('admin','super_admin')
));

create or replace function public.record_legacy_replacement_review(
    p_review_id uuid, p_state text, p_note text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_review public.legacy_replacement_reviews%rowtype;
    v_note text := btrim(coalesce(p_note, ''));
begin
    if v_actor is null or not exists (
        select 1 from public.profiles p
        where p.id=v_actor and p.is_active and p.role in ('admin','super_admin')
    ) then
        raise exception 'Only active admins can review legacy replacements';
    end if;

    if p_state is null or p_state not in
        ('pending','evidence_requested','evidence_received','excluded') then
        raise exception 'Invalid evidence review status';
    end if;
    if char_length(v_note) > 2000 then
        raise exception 'Review note is too long';
    end if;
    if p_state <> 'pending' and char_length(v_note) < 10 then
        raise exception 'Explain the evidence or reason in at least 10 characters';
    end if;

    select * into v_review
    from public.legacy_replacement_reviews
    where id=p_review_id for update;
    if not found then raise exception 'Legacy replacement review not found'; end if;

    if v_review.review_state = p_state and v_review.review_note = v_note then
        return p_review_id;
    end if;

    update public.legacy_replacement_reviews
    set review_state=p_state, review_note=v_note,
        reviewed_by=v_actor, reviewed_at=now()
    where id=p_review_id;

    insert into public.legacy_replacement_review_audit (
        review_id, from_state, to_state, review_note, actor_id
    ) values (
        p_review_id, v_review.review_state, p_state, v_note, v_actor
    );

    -- This RPC deliberately does NOT update bookings, class capacities,
    -- makeup obligations, attendance, or technical reconciliation status.
    return p_review_id;
end;
$$;
revoke all on function public.record_legacy_replacement_review(uuid,text,text)
from public, anon;
grant execute on function public.record_legacy_replacement_review(uuid,text,text)
to authenticated;
