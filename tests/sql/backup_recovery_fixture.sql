-- SYNTHETIC fixture, never a snapshot of real MTDC data.
create extension if not exists pgcrypto;
create table public.students(id uuid primary key,status text not null);
create table public.parents(id uuid primary key);
create table public.enrollments(id uuid primary key,status text not null);
create table public.branches(id uuid primary key,name text not null,code text);
create table public.schedule_batches(id uuid primary key,branch_id uuid references public.branches(id),
 schedule_month date not null,status text not null);
create table public.class_sessions(id uuid primary key,branch_id uuid references public.branches(id),
 schedule_batch_id uuid references public.schedule_batches(id),class_date date not null,
 replacement_capacity int not null);
create table public.student_bookings(id uuid primary key,class_session_id uuid references public.class_sessions(id));
create table public.legacy_september_evidence(id uuid primary key,source_batch text not null);
create table public.legacy_replacement_reviews(id uuid primary key,source_batch text not null,
 target_class_id uuid references public.class_sessions(id),review_state text not null);
insert into public.students values
 ('30000000-0000-4000-8000-000000000001','active'),
 ('30000000-0000-4000-8000-000000000002','active');
insert into public.parents values ('40000000-0000-4000-8000-000000000001');
insert into public.enrollments values ('50000000-0000-4000-8000-000000000001','active');
insert into public.branches values ('10000000-0000-4000-8000-000000000001','MTDC Synthetic Branch','MTDC');
insert into public.schedule_batches values
 ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-11-01','draft');
insert into public.class_sessions values
 ('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '60000000-0000-4000-8000-000000000001','2026-11-07',5),
 ('70000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
 '60000000-0000-4000-8000-000000000001','2026-11-08',5);
insert into public.student_bookings values
 ('80000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001');
insert into public.legacy_september_evidence values
 ('90000000-0000-4000-8000-000000000001','mtdc-2026-09');
insert into public.legacy_replacement_reviews values
 ('a0000000-0000-4000-8000-000000000001','mtdc-2026-10',
  '70000000-0000-4000-8000-000000000001','pending');
