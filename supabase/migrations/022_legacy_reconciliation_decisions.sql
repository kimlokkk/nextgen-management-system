-- Local staging first. Independent human source-evidence decisions.
-- This does NOT approve replacement eligibility, attendance, bookings or seats.
create table public.legacy_reconciliation_decisions (
    review_id uuid primary key references public.legacy_replacement_reviews(id) on delete restrict,
    disposition text not null check (disposition in ('needs_investigation','source_correlated','source_checked')),
    identity_confirmed boolean not null default false,
    original_date_confirmed boolean not null default false,
    evidence_reference text not null default '' check (char_length(btrim(evidence_reference)) <= 500),
    decision_note text not null check (char_length(btrim(decision_note)) between 10 and 2000),
    decided_by uuid references auth.users(id) on delete set null,
    decided_at timestamptz not null default now(),
    check (disposition <> 'source_checked' or
      (identity_confirmed and original_date_confirmed
       and char_length(btrim(evidence_reference)) between 8 and 500))
);
create table public.legacy_reconciliation_decision_audit (
    id uuid primary key default gen_random_uuid(),
    review_id uuid not null references public.legacy_replacement_reviews(id) on delete restrict,
    old_disposition text,
    new_disposition text not null,
    identity_confirmed boolean not null,
    original_date_confirmed boolean not null,
    evidence_reference text not null,
    decision_note text not null,
    actor_id uuid references auth.users(id) on delete set null,
    changed_at timestamptz not null default now()
);
create index idx_legacy_reconciliation_audit_review
on public.legacy_reconciliation_decision_audit(review_id,changed_at desc);

alter table public.legacy_reconciliation_decisions enable row level security;
alter table public.legacy_reconciliation_decision_audit enable row level security;
revoke all on public.legacy_reconciliation_decisions from public,anon,authenticated;
revoke all on public.legacy_reconciliation_decision_audit from public,anon,authenticated;
grant select on public.legacy_reconciliation_decisions to authenticated;
grant select on public.legacy_reconciliation_decision_audit to authenticated;

create policy "Active admins read historical reconciliation decisions"
on public.legacy_reconciliation_decisions for select to authenticated
using (exists (select 1 from public.profiles p
  where p.id=auth.uid() and p.is_active and p.role in ('admin','super_admin')));
create policy "Active admins read historical reconciliation audit"
on public.legacy_reconciliation_decision_audit for select to authenticated
using (exists (select 1 from public.profiles p
  where p.id=auth.uid() and p.is_active and p.role in ('admin','super_admin')));

create function public.record_legacy_reconciliation_decision(
    p_review_id uuid,
    p_expected_disposition text,
    p_disposition text,
    p_identity_confirmed boolean,
    p_original_date_confirmed boolean,
    p_evidence_reference text,
    p_note text
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
    v_actor uuid:=auth.uid();
    v_source public.legacy_replacement_reviews%rowtype;
    v_existing public.legacy_reconciliation_decisions%rowtype;
    v_old text;
    v_evidence text:=btrim(coalesce(p_evidence_reference,''));
    v_note text:=btrim(coalesce(p_note,''));
begin
    if v_actor is null or not exists (
        select 1 from public.profiles p where p.id=v_actor
        and p.is_active and p.role in ('admin','super_admin')
    ) then raise exception 'Only active admins can reconcile historical evidence'; end if;
    if p_disposition is null or p_disposition not in
        ('needs_investigation','source_correlated','source_checked') then
        raise exception 'Invalid reconciliation decision';
    end if;
    if char_length(v_note) not between 10 and 2000 then
        raise exception 'Explain the decision (10 to 2000 characters)';
    end if;
    if char_length(v_evidence)>500 then
        raise exception 'Evidence reference too long';
    end if;

    -- Lock source first to serialize concurrent decisions, including first insert.
    select * into v_source from public.legacy_replacement_reviews
    where id=p_review_id for update;
    if not found then raise exception 'Historical source record not found'; end if;
    if v_source.source_batch <> 'mtdc-2026-10' then
        raise exception 'Only the staged October MTDC batch can be reconciled';
    end if;
    select * into v_existing from public.legacy_reconciliation_decisions
    where review_id=p_review_id;
    if found then v_old:=v_existing.disposition; else v_old:=null; end if;
    if v_old is distinct from p_expected_disposition then
        raise exception 'Review decision changed since page load. Refresh and retry';
    end if;

    if p_disposition='source_checked' then
        if v_source.review_state='excluded' then
            raise exception 'Excluded source requires a separate operational review';
        end if;
        if v_source.original_date is null
           or v_source.original_date >= v_source.replacement_date then
            raise exception 'Source chronology needs investigation before source check';
        end if;
        if p_identity_confirmed is distinct from true
           or p_original_date_confirmed is distinct from true
           or char_length(v_evidence)<8 then
            raise exception 'Confirm identity and source date and cite evidence before source check';
        end if;
    end if;

    insert into public.legacy_reconciliation_decisions (
      review_id,disposition,identity_confirmed,original_date_confirmed,
      evidence_reference,decision_note,decided_by,decided_at
    ) values (
      p_review_id,p_disposition,coalesce(p_identity_confirmed,false),
      coalesce(p_original_date_confirmed,false),v_evidence,v_note,v_actor,now()
    ) on conflict (review_id) do update
      set disposition=excluded.disposition,
      identity_confirmed=excluded.identity_confirmed,
      original_date_confirmed=excluded.original_date_confirmed,
      evidence_reference=excluded.evidence_reference,
      decision_note=excluded.decision_note,
      decided_by=excluded.decided_by, decided_at=excluded.decided_at;

    insert into public.legacy_reconciliation_decision_audit (
      review_id,old_disposition,new_disposition,identity_confirmed,
      original_date_confirmed,evidence_reference,decision_note,actor_id
    ) values (
      p_review_id,v_old,p_disposition,coalesce(p_identity_confirmed,false),
      coalesce(p_original_date_confirmed,false),v_evidence,v_note,v_actor
    );

    -- Intentionally NO updates to legacy review_state, source rows,
    -- student_bookings, class_sessions, makeup_obligations or attendance.
    return p_review_id;
end;
$fn$;
revoke all on function public.record_legacy_reconciliation_decision(
  uuid,text,text,boolean,boolean,text,text
) from public,anon,authenticated;
grant execute on function public.record_legacy_reconciliation_decision(
  uuid,text,text,boolean,boolean,text,text
) to authenticated;
comment on table public.legacy_reconciliation_decisions is
  'Human-reviewed SOURCE evidence only; does not establish eligibility for an earned replacement.';
