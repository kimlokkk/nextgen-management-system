
-- Local staging only: historical source evidence, never active attendance/entitlement.
-- PII is deliberately excluded from this migration; use private local CSV import.
create table public.legacy_september_evidence (
    id uuid primary key default gen_random_uuid(),
    source_batch text not null check (source_batch = 'mtdc-2026-09'),
    source_ref text not null,
    source_tab text not null,
    source_row integer not null check (source_row > 0),
    evidence_kind text not null check (evidence_kind in ('regular_roster','legacy_replacement')),
    student_name text not null,
    class_date date not null check (class_date >= '2026-09-01' and class_date < '2026-10-01'),
    start_time time not null,
    end_time time not null,
    week_number smallint not null check (week_number between 1 and 4),
    space_label text,
    course text,
    module_raw text,
    attendance_raw text,
    original_date date,
    original_raw text,
    date_quality text not null check (date_quality in ('regular_week_header','printed_week_header')),
    header_raw text,
    created_at timestamptz not null default now(),
    unique (source_batch,source_ref),
    check (end_time > start_time)
);
create index idx_legacy_sept_evidence_date on public.legacy_september_evidence
    (source_batch,class_date,evidence_kind);
alter table public.legacy_september_evidence enable row level security;
revoke all on public.legacy_september_evidence from public,anon,authenticated;
grant select on public.legacy_september_evidence to authenticated;
create policy "Only active admins view September source evidence"
on public.legacy_september_evidence for select to authenticated
using (exists (
 select 1 from public.profiles p
 where p.id=auth.uid() and p.is_active and p.role in ('admin','super_admin')
));
comment on table public.legacy_september_evidence is
 'Source-only September records. Never evidence of attended class, replacement eligibility or a current booking. Local-only private import.';
