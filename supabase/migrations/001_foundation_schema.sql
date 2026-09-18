-- Enable UUID generation
create extension if not exists "pgcrypto";


-- =====================================================
-- BRANCHES
-- =====================================================

create table branches (
    id uuid primary key default gen_random_uuid(),

    name text not null,
    code text unique,

    address text,
    phone text,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- =====================================================
-- PROGRAMMES
-- =====================================================

create table programmes (
    id uuid primary key default gen_random_uuid(),

    name text not null unique,
    code text unique,

    description text,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- =====================================================
-- PARENTS / GUARDIANS
-- =====================================================

create table parents (
    id uuid primary key default gen_random_uuid(),

    full_name text not null,

    phone text,
    whatsapp_phone text,
    email text,

    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- =====================================================
-- STUDENTS
-- =====================================================

create table students (
    id uuid primary key default gen_random_uuid(),

    student_code text unique,

    full_name text not null,

    date_of_birth date,

    status text not null default 'active'
        check (
            status in (
                'active',
                'inactive',
                'stopped',
                'graduated'
            )
        ),

    laptop_type text
        check (
            laptop_type in (
                'own',
                'academy'
            )
        ),

    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- =====================================================
-- STUDENT ↔ PARENT RELATIONSHIP
-- =====================================================

create table student_guardians (
    id uuid primary key default gen_random_uuid(),

    student_id uuid not null
        references students(id)
        on delete cascade,

    parent_id uuid not null
        references parents(id)
        on delete cascade,

    relationship text,

    is_primary boolean not null default false,

    created_at timestamptz not null default now(),

    unique(student_id, parent_id)
);


-- =====================================================
-- SESSION TEMPLATES
-- =====================================================

create table session_templates (
    id uuid primary key default gen_random_uuid(),

    branch_id uuid not null
        references branches(id)
        on delete cascade,

    programme_id uuid not null
        references programmes(id)
        on delete cascade,

    name text,

    day_of_week smallint not null
        check (day_of_week between 0 and 6),

    start_time time not null,
    end_time time not null,

    regular_capacity integer not null default 10
        check (regular_capacity >= 0),

    replacement_capacity integer not null default 5
        check (replacement_capacity >= 0),

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    check (end_time > start_time)
);


-- =====================================================
-- ENROLLMENTS
-- =====================================================

create table enrollments (
    id uuid primary key default gen_random_uuid(),

    student_id uuid not null
        references students(id)
        on delete cascade,

    branch_id uuid not null
        references branches(id),

    programme_id uuid not null
        references programmes(id),

    default_session_id uuid
        references session_templates(id),

    frequency_type text not null default 'weekly'
        check (
            frequency_type in (
                'weekly',
                'twice_monthly',
                'custom'
            )
        ),

    start_date date not null,

    end_date date,

    status text not null default 'active'
        check (
            status in (
                'active',
                'paused',
                'stopped',
                'completed'
            )
        ),

    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    check (
        end_date is null
        or end_date >= start_date
    )
);


-- =====================================================
-- INDEXES
-- =====================================================

create index idx_students_status
    on students(status);

create index idx_enrollments_student
    on enrollments(student_id);

create index idx_enrollments_branch
    on enrollments(branch_id);

create index idx_enrollments_programme
    on enrollments(programme_id);

create index idx_enrollments_session
    on enrollments(default_session_id);

create index idx_session_templates_branch
    on session_templates(branch_id);

create index idx_session_templates_programme
    on session_templates(programme_id);


-- =====================================================
-- INITIAL PROGRAMMES
-- =====================================================

insert into programmes (name, code)
values
    ('Junior Maker', 'JR_MAKER'),
    ('Young Coder', 'YOUNG_CODER'),
    ('Little Maker', 'LITTLE_MAKER');


-- =====================================================
-- INITIAL BRANCH
-- =====================================================

insert into branches (name, code)
values
    ('Cyberjaya', 'CYBERJAYA');