-- Ephemeral PostgreSQL test fixture: only the columns used by replacement RPCs.
-- This is NOT a production schema or a Supabase migration.
create extension if not exists pgcrypto;
create schema auth;
create table auth.users (id uuid primary key);
create role authenticated nologin;
create role anon nologin;

create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('test.actor', true), '')::uuid $$;

create table public.profiles (
    id uuid primary key,
    role text not null,
    is_active boolean not null
);
create table public.branches (id uuid primary key);
create table public.programmes (id uuid primary key);
create table public.students (id uuid primary key, status text not null);
create table public.session_templates (
    id uuid primary key,
    branch_id uuid references public.branches(id),
    programme_id uuid references public.programmes(id),
    day_of_week smallint not null,
    start_time time not null,
    end_time time not null
);
create table public.enrollments (
    id uuid primary key,
    student_id uuid not null references public.students(id),
    branch_id uuid not null references public.branches(id),
    programme_id uuid not null references public.programmes(id),
    default_session_id uuid references public.session_templates(id),
    status text not null
);
create table public.schedule_batches (
    id uuid primary key,
    branch_id uuid not null references public.branches(id),
    status text not null
);
create table public.class_sessions (
    id uuid primary key,
    schedule_batch_id uuid not null references public.schedule_batches(id),
    session_template_id uuid not null references public.session_templates(id),
    branch_id uuid not null references public.branches(id),
    programme_id uuid not null references public.programmes(id),
    class_date date not null,
    start_time time not null,
    end_time time not null,
    status text not null,
    replacement_capacity integer not null,
    updated_at timestamptz not null default now()
);
create table public.student_bookings (
    id uuid primary key default gen_random_uuid(),
    class_session_id uuid not null references public.class_sessions(id),
    student_id uuid not null references public.students(id),
    enrollment_id uuid references public.enrollments(id),
    booking_type text not null,
    attendance_status text not null,
    updated_at timestamptz not null default now(),
    unique (class_session_id, student_id)
);
create table public.makeup_obligations (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id),
    enrollment_id uuid references public.enrollments(id),
    source_booking_id uuid not null unique references public.student_bookings(id),
    target_booking_id uuid unique references public.student_bookings(id),
    obligation_type text not null,
    status text not null,
    reason text,
    created_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into auth.users values ('00000000-0000-4000-8000-000000000001');

insert into public.profiles values
    ('00000000-0000-4000-8000-000000000001', 'admin', true),
    ('00000000-0000-4000-8000-000000000002', 'parent', true);
insert into public.branches values ('10000000-0000-4000-8000-000000000001');
insert into public.programmes values ('20000000-0000-4000-8000-000000000001');
insert into public.students values
    ('30000000-0000-4000-8000-000000000001', 'active'),
    ('30000000-0000-4000-8000-000000000002', 'active');

insert into public.session_templates values
    ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 6, '10:00', '11:00'),
    ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 0, '12:00', '13:00');

insert into public.enrollments values
    ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'active'),
    ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'stopped');

insert into public.schedule_batches values
    ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'locked'),
    ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'locked');

-- Source classes are in TWO months; candidate slots are in ONE month.
-- Times deliberately differ from weekly Saturday 10am regular slot.
insert into public.class_sessions values
    ('70000000-0000-4000-8000-000000000001',
     '60000000-0000-4000-8000-000000000001',
     '40000000-0000-4000-8000-000000000001',
     '10000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001',
     (date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur') + interval '2 months')::date + 12),
     '10:00', '11:00', 'scheduled', 1),
    ('70000000-0000-4000-8000-000000000002',
     '60000000-0000-4000-8000-000000000001',
     '40000000-0000-4000-8000-000000000001',
     '10000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001',
     (date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur') + interval '2 months')::date + 12),
     '10:00', '11:00', 'scheduled', 1),
    ('70000000-0000-4000-8000-000000000003',
     '60000000-0000-4000-8000-000000000002',
     '40000000-0000-4000-8000-000000000002',
     '10000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001',
     (date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur') + interval '1 month')::date + 10),
     '12:00', '13:00', 'scheduled', 1),
    ('70000000-0000-4000-8000-000000000004',
     '60000000-0000-4000-8000-000000000002',
     '40000000-0000-4000-8000-000000000001',
     '10000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001',
     (date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur') + interval '1 month')::date + 17),
     '10:00', '11:00', 'scheduled', 1),
    ('70000000-0000-4000-8000-000000000005',
     '60000000-0000-4000-8000-000000000002',
     '40000000-0000-4000-8000-000000000002',
     '10000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001',
     (date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur') + interval '1 month')::date + 20),
     '12:00', '13:00', 'scheduled', 1);

insert into public.student_bookings (
    id, class_session_id, student_id, enrollment_id, booking_type, attendance_status
) values
    ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'regular', 'upcoming'),
    ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'regular', 'upcoming');

set test.actor = '00000000-0000-4000-8000-000000000001';
