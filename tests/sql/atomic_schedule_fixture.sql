-- ONLY for isolated ephemeral GitHub Actions PostgreSQL.
-- Synthetic rows and minimal RLS matching production authorization requirements.
create extension if not exists pgcrypto;
create schema auth;
create role authenticated nologin;
create role anon nologin;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor',true),'')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table public.profiles(id uuid primary key,role text not null,is_active boolean not null);
create table public.branches(id uuid primary key,is_active boolean not null default true);
create table public.programmes(id uuid primary key);
create table public.students(id uuid primary key,status text not null);
create table public.session_templates(
 id uuid primary key,branch_id uuid not null references public.branches(id),
 programme_id uuid not null references public.programmes(id),
 day_of_week smallint not null,start_time time not null,end_time time not null,
 regular_capacity integer not null,replacement_capacity integer not null,
 is_active boolean not null default true
);
create table public.enrollments(
 id uuid primary key,student_id uuid references public.students(id),
 branch_id uuid references public.branches(id),
 programme_id uuid references public.programmes(id),
 default_session_id uuid references public.session_templates(id),
 frequency_type text not null default 'weekly',
 preferred_weeks smallint[],
 start_date date not null,end_date date,status text not null
);
create table public.academic_calendar_exceptions(
 id uuid primary key default gen_random_uuid(),
 branch_id uuid references public.branches(id),
 closed_on date not null,decision text not null,target_on date,
 unique(branch_id,closed_on)
);
create table public.schedule_batches(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),
 schedule_month date not null,status text not null,generated_by uuid,
 unique(branch_id,schedule_month)
);
create table public.class_sessions(
 id uuid primary key default gen_random_uuid(),
 schedule_batch_id uuid not null references public.schedule_batches(id) on delete cascade,
 session_template_id uuid not null references public.session_templates(id),
 branch_id uuid not null references public.branches(id),
 programme_id uuid not null references public.programmes(id),
 class_date date not null,week_number smallint not null,start_time time not null,
 end_time time not null,regular_capacity integer not null,
 replacement_capacity integer not null,status text not null default 'scheduled',
 unique(schedule_batch_id,session_template_id,class_date)
);
create table public.student_bookings(
 id uuid primary key default gen_random_uuid(),
 class_session_id uuid not null references public.class_sessions(id) on delete cascade,
 student_id uuid not null references public.students(id),
 enrollment_id uuid references public.enrollments(id),
 booking_type text not null,attendance_status text not null,
 unique(class_session_id,student_id)
);

grant select on public.profiles to authenticated;
grant select,update on public.branches to authenticated;
grant select on public.students,public.programmes,public.session_templates,
  public.enrollments,public.academic_calendar_exceptions to authenticated;
grant select,insert on public.schedule_batches,public.class_sessions,public.student_bookings
  to authenticated;
-- Function must not use RLS bypass for writes.
alter table public.schedule_batches enable row level security;
alter table public.class_sessions enable row level security;
alter table public.student_bookings enable row level security;
create policy "admin schedule batches" on public.schedule_batches for all to authenticated
using (exists(select 1 from public.profiles p
 where p.id=auth.uid() and p.is_active and p.role in ('admin','super_admin')))
with check (exists(select 1 from public.profiles p
 where p.id=auth.uid() and p.is_active and p.role in ('admin','super_admin')));
create policy "admin class sessions" on public.class_sessions for all to authenticated
using (exists(select 1 from public.profiles p
 where p.id=auth.uid() and p.is_active and p.role in ('admin','super_admin')))
with check (exists(select 1 from public.profiles p
 where p.id=auth.uid() and p.is_active and p.role in ('admin','super_admin')));
create policy "admin bookings" on public.student_bookings for all to authenticated
using (exists(select 1 from public.profiles p
 where p.id=auth.uid() and p.is_active and p.role in ('admin','super_admin')))
with check (exists(select 1 from public.profiles p
 where p.id=auth.uid() and p.is_active and p.role in ('admin','super_admin')));

insert into public.profiles values
 ('00000000-0000-4000-8000-000000000001','admin',true),
 ('00000000-0000-4000-8000-000000000002','parent',true),
 ('00000000-0000-4000-8000-000000000003','admin',false);
insert into public.branches values
 ('10000000-0000-4000-8000-000000000001',true),
 ('10000000-0000-4000-8000-000000000002',true);
insert into public.programmes values ('20000000-0000-4000-8000-000000000001');
insert into public.students values
 ('30000000-0000-4000-8000-000000000001','active'),
 ('30000000-0000-4000-8000-000000000002','active'),
 ('30000000-0000-4000-8000-000000000003','active'),
 ('30000000-0000-4000-8000-000000000004','active'),
 ('30000000-0000-4000-8000-000000000005','active'),
 ('30000000-0000-4000-8000-000000000006','active');
insert into public.session_templates values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001',6,'09:00','10:30',2,5,true),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001',0,'11:00','12:30',1,5,true),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',
 '20000000-0000-4000-8000-000000000001',6,'09:00','10:30',1,5,true);
insert into public.enrollments values
 ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000001','weekly',null,'2026-10-01',null,'active'),
 ('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000001','twice_monthly',array[1,3]::smallint[],
 '2026-10-01',null,'active'),
 ('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000001','weekly',null,
 '2026-12-15',null,'active'),
 ('50000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004',
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000002','weekly',null,'2026-10-01',null,'active'),
 ('50000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005',
 '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000003','weekly',null,'2026-11-01',null,'active'),
 ('50000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',
 '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000003','weekly',null,'2027-03-01',null,'paused');
-- Synthetic historical November + October batches, must NEVER change.
insert into public.schedule_batches(id,branch_id,schedule_month,status) values
 ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-11-01','draft'),
 ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','2026-10-01','locked');
