-- Isolated fixture for migration 028 (synthetic rows only; never real students). Run BEFORE 023 and 028.
create schema if not exists auth;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('test.actor', true), '')::uuid $$;
create table public.profiles(id uuid primary key,role text not null,is_active boolean not null default true);
create table public.students(id uuid primary key,full_name text not null,status text not null default 'active');
create table public.parents(id uuid primary key default gen_random_uuid(),full_name text not null,phone text);
create table public.student_guardians(
 id uuid primary key default gen_random_uuid(),
 student_id uuid references public.students(id),
 parent_id uuid references public.parents(id),
 relationship text,
 is_primary boolean not null default false,
 unique(student_id,parent_id)
);
insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.profiles values ('00000000-0000-4000-8000-000000000001','admin',true),('00000000-0000-4000-8000-000000000002','facilitator',true);
insert into public.students values
 ('30000000-0000-4000-8000-000000000001','Fixture student 1','active'),
 ('30000000-0000-4000-8000-000000000002','Fixture student 2','active'),
 ('30000000-0000-4000-8000-000000000003','Fixture student 3','inactive');
