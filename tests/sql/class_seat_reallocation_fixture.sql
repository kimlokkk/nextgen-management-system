-- Isolated fixture for migration 030 (synthetic rows only; never real students). Run BEFORE 030.
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
create table public.students(id uuid primary key,full_name text not null);
create table public.schedule_batches(
 id uuid primary key,branch_id uuid not null references public.branches(id),
 schedule_month date not null,status text not null
);
create table public.class_sessions(
 id uuid primary key,schedule_batch_id uuid not null references public.schedule_batches(id) on delete cascade,
 branch_id uuid not null references public.branches(id),
 programme_id uuid not null references public.programmes(id),
 class_date date not null,start_time time not null,end_time time not null,
 regular_capacity integer not null,replacement_capacity integer not null,
 status text not null default 'scheduled',
 updated_at timestamptz not null default now()
);
create table public.student_bookings(
 id uuid primary key default gen_random_uuid(),class_session_id uuid not null references public.class_sessions(id) on delete cascade,
 student_id uuid not null references public.students(id),
 booking_type text not null,attendance_status text not null,
 unique(class_session_id,student_id)
);
create table public.makeup_obligations(
 id uuid primary key default gen_random_uuid(),
 source_booking_id uuid not null references public.student_bookings(id)
);
-- Minimal copy of the historical-reservation table and function from migrations 018/019.
create table public.legacy_replacement_reviews(
 id uuid primary key default gen_random_uuid(),
 target_class_id uuid references public.class_sessions(id),
 review_state text not null default 'pending',
 linked_active_booking_id uuid
);
create function public.legacy_reserved_yellow_seats(p_class_session_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.legacy_replacement_reviews r
  where r.target_class_id = p_class_session_id and r.review_state <> 'excluded'
    and (r.linked_active_booking_id is null or not exists (
      select 1 from public.student_bookings b
      where b.id = r.linked_active_booking_id and b.class_session_id = p_class_session_id
        and b.booking_type = 'replacement' and b.attendance_status not in ('cancelled','not_scheduled')));
$$;
revoke all on function public.legacy_reserved_yellow_seats(uuid) from public, anon, authenticated;
grant select on public.profiles, public.class_sessions, public.schedule_batches to authenticated;

insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
insert into public.profiles values
 ('00000000-0000-4000-8000-000000000001','admin',true),
 ('00000000-0000-4000-8000-000000000002','parent',true),
 ('00000000-0000-4000-8000-000000000003','admin',false);
insert into public.branches values ('10000000-0000-4000-8000-000000000001');
insert into public.programmes values ('20000000-0000-4000-8000-000000000001');
insert into public.students
 select ('30000000-0000-4000-8000-0000000000'||lpad(i::text,2,'0'))::uuid, 'Fixture student '||i from generate_series(1,16) i;
insert into public.schedule_batches values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-10-01','locked'),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','2026-11-01','draft'),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','2026-12-01','approved');
-- A: locked, 15+5 with 6 regular, 4 replacement + 2 legacy (the "6/5" shape)
-- B: draft, 15+5 with no bookings
-- C: approved, 10+5 full of regular bookings (10)
-- D: locked but cancelled class
insert into public.class_sessions(id,schedule_batch_id,branch_id,programme_id,class_date,start_time,end_time,regular_capacity,replacement_capacity,status) values
 ('50000000-0000-4000-8000-00000000000a','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','2026-10-03','11:00','13:00',15,5,'scheduled'),
 ('50000000-0000-4000-8000-00000000000b','40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','2026-11-07','11:00','13:00',15,5,'scheduled'),
 ('50000000-0000-4000-8000-00000000000c','40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','2026-12-05','11:00','13:00',10,5,'scheduled'),
 ('50000000-0000-4000-8000-00000000000d','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','2026-10-10','11:00','13:00',15,5,'cancelled');
insert into public.student_bookings(class_session_id,student_id,booking_type,attendance_status)
 select '50000000-0000-4000-8000-00000000000a', ('30000000-0000-4000-8000-0000000000'||lpad(i::text,2,'0'))::uuid, 'regular','upcoming' from generate_series(1,6) i;
insert into public.student_bookings(class_session_id,student_id,booking_type,attendance_status)
 select '50000000-0000-4000-8000-00000000000a', ('30000000-0000-4000-8000-0000000000'||lpad(i::text,2,'0'))::uuid, 'replacement','upcoming' from generate_series(7,10) i;
insert into public.student_bookings(class_session_id,student_id,booking_type,attendance_status)
 select '50000000-0000-4000-8000-00000000000c', ('30000000-0000-4000-8000-0000000000'||lpad(i::text,2,'0'))::uuid, 'regular','upcoming' from generate_series(1,10) i;
insert into public.legacy_replacement_reviews(target_class_id,review_state) values
 ('50000000-0000-4000-8000-00000000000a','pending'),('50000000-0000-4000-8000-00000000000a','pending'),
 ('50000000-0000-4000-8000-00000000000a','excluded');
