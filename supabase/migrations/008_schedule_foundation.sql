-- =====================================================
-- SCHEDULE BATCHES
-- Satu batch = satu monthly schedule untuk satu branch
-- =====================================================

create table schedule_batches (
    id uuid primary key default gen_random_uuid(),

    branch_id uuid not null
        references branches(id),

    schedule_month date not null,

    status text not null default 'draft'
        check (
            status in (
                'draft',
                'approved',
                'locked'
            )
        ),

    generated_by uuid
        references auth.users(id),

    generated_at timestamptz not null default now(),
    approved_at timestamptz,
    locked_at timestamptz,

    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique(branch_id, schedule_month),

    check (
        schedule_month = date_trunc('month', schedule_month)::date
    )
);


-- =====================================================
-- CLASS SESSIONS
-- Actual class generated daripada session_templates
-- =====================================================

create table class_sessions (
    id uuid primary key default gen_random_uuid(),

    schedule_batch_id uuid not null
        references schedule_batches(id)
        on delete cascade,

    session_template_id uuid not null
        references session_templates(id),

    branch_id uuid not null
        references branches(id),

    programme_id uuid not null
        references programmes(id),

    class_date date not null,

    week_number smallint not null
        check (week_number between 1 and 5),

    start_time time not null,
    end_time time not null,

    regular_capacity integer not null
        check (regular_capacity >= 0),

    replacement_capacity integer not null
        check (replacement_capacity >= 0),

    status text not null default 'scheduled'
        check (
            status in (
                'scheduled',
                'cancelled',
                'public_holiday'
            )
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (
        schedule_batch_id,
        session_template_id,
        class_date
    )
);


-- =====================================================
-- STUDENT BOOKINGS
-- Siapa berada dalam actual class tersebut
-- =====================================================

create table student_bookings (
    id uuid primary key default gen_random_uuid(),

    class_session_id uuid not null
        references class_sessions(id)
        on delete cascade,

    student_id uuid not null
        references students(id),

    enrollment_id uuid
        references enrollments(id),

    booking_type text not null default 'regular'
        check (
            booking_type in (
                'regular',
                'replacement',
                'reschedule'
            )
        ),

    attendance_status text not null default 'upcoming'
        check (
            attendance_status in (
                'upcoming',
                'present',
                'absent',
                'rescheduled',
                'not_scheduled',
                'cancelled'
            )
        ),

    module_progress text,

    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique(class_session_id, student_id)
);


-- =====================================================
-- INDEXES
-- =====================================================

create index idx_schedule_batches_branch
    on schedule_batches(branch_id);

create index idx_schedule_batches_month
    on schedule_batches(schedule_month);

create index idx_class_sessions_batch
    on class_sessions(schedule_batch_id);

create index idx_class_sessions_date
    on class_sessions(class_date);

create index idx_class_sessions_template
    on class_sessions(session_template_id);

create index idx_student_bookings_session
    on student_bookings(class_session_id);

create index idx_student_bookings_student
    on student_bookings(student_id);

create index idx_student_bookings_enrollment
    on student_bookings(enrollment_id);


alter table enrollments
add column preferred_weeks smallint[];

alter table enrollments
add constraint enrollments_preferred_weeks_valid
check (
    preferred_weeks is null
    or preferred_weeks <@ array[1,2,3,4,5]::smallint[]
);

alter table schedule_batches enable row level security;
alter table class_sessions enable row level security;
alter table student_bookings enable row level security;


create policy "Admins can manage schedule batches"
on schedule_batches
for all
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
)
with check (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
);


create policy "Admins can manage class sessions"
on class_sessions
for all
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
)
with check (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
);


create policy "Admins can manage student bookings"
on student_bookings
for all
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
)
with check (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
);