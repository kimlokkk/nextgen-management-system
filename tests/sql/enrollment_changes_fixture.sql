-- Isolated fixture for migration 031 (synthetic rows only; never real students). Run BEFORE 031.
create schema if not exists auth;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('test.actor', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.profiles(id uuid primary key,role text not null,is_active boolean not null default true);
create table public.branches(id uuid primary key);
create table public.programmes(id uuid primary key);
create table public.students(id uuid primary key,full_name text not null,status text not null default 'active');
create table public.session_templates(
 id uuid primary key,branch_id uuid not null references public.branches(id),
 programme_id uuid not null references public.programmes(id),
 day_of_week integer not null,start_time time not null,end_time time not null,
 is_active boolean not null default true
);
create table public.enrollments(
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.students(id) on delete cascade,
 branch_id uuid not null references public.branches(id),
 programme_id uuid not null references public.programmes(id),
 default_session_id uuid references public.session_templates(id),
 frequency_type text not null default 'weekly' check (frequency_type in ('weekly','twice_monthly','custom')),
 start_date date not null,end_date date,
 status text not null default 'active' check (status in ('active','paused','stopped','completed')),
 notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 preferred_weeks smallint[] check (preferred_weeks is null or preferred_weeks <@ array[1,2,3,4,5]::smallint[]),
 check (end_date is null or end_date>=start_date)
);
create table public.class_sessions(id uuid primary key,class_date date not null);
create table public.student_bookings(
 id uuid primary key default gen_random_uuid(),
 class_session_id uuid not null references public.class_sessions(id),
 enrollment_id uuid references public.enrollments(id)
);
-- Same default as a Supabase project: signed-in users can read and write public tables until 031 narrows enrollments.
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
insert into public.profiles values
 ('00000000-0000-4000-8000-000000000001','admin',true),
 ('00000000-0000-4000-8000-000000000002','parent',true),
 ('00000000-0000-4000-8000-000000000003','admin',false);
insert into public.branches values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.programmes values ('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
-- Branch 1: T1 Sat 09:00-10:30 prog1, T2 Sat 11:00-12:30 prog1, T3 Sat 09:00-10:30 prog2 (same time, other room),
--           T4 Sun 09:00-10:30 prog1, T5 inactive. Branch 2: T6 Sat 09:00-10:30 prog1.
insert into public.session_templates values
 ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',6,'09:00','10:30',true),
 ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',6,'11:00','12:30',true),
 ('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',6,'09:00','10:30',true),
 ('60000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',0,'09:00','10:30',true),
 ('60000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',0,'11:00','12:30',false),
 ('60000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',6,'09:00','10:30',true);
insert into public.students values
 ('30000000-0000-4000-8000-000000000001','Fixture student 1','active'),
 ('30000000-0000-4000-8000-000000000002','Fixture student 2','active'),
 ('30000000-0000-4000-8000-000000000003','Fixture student 3','active'),
 ('30000000-0000-4000-8000-000000000004','Fixture student 4','active'),
 ('30000000-0000-4000-8000-000000000005','Fixture student 5','inactive'),
 ('30000000-0000-4000-8000-000000000006','Fixture student 6','active');
-- S3: weekly T1 starting 2026-11-01, no bookings yet  (in-place correction case)
-- S4: weekly T1 starting 2026-09-01 with bookings in Sep/Oct/Nov (split case)
insert into public.enrollments(id,student_id,branch_id,programme_id,default_session_id,frequency_type,start_date,status) values
 ('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','weekly','2026-11-01','active'),
 ('50000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','weekly','2026-09-01','active');
insert into public.class_sessions values
 ('70000000-0000-4000-8000-000000000001','2026-09-05'),('70000000-0000-4000-8000-000000000002','2026-10-03'),
 ('70000000-0000-4000-8000-000000000003','2026-11-07'),('70000000-0000-4000-8000-000000000004','2026-11-14');
insert into public.student_bookings(class_session_id,enrollment_id) values
 ('70000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004'),
 ('70000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000004'),
 ('70000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004'),
 ('70000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000004');
