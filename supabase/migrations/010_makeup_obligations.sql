create table makeup_obligations (
    id uuid primary key default gen_random_uuid(),

    student_id uuid not null
        references students(id),

    enrollment_id uuid
        references enrollments(id),

    source_booking_id uuid not null
        references student_bookings(id),

    obligation_type text not null
        check (
            obligation_type in (
                'reschedule',
                'replacement'
            )
        ),

    status text not null default 'open'
        check (
            status in (
                'open',
                'scheduled',
                'completed',
                'cancelled'
            )
        ),

    target_booking_id uuid
        references student_bookings(id)
        on delete set null,

    reason text,

    created_by uuid
        references auth.users(id),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique(source_booking_id)
);


create unique index idx_makeup_target_booking
on makeup_obligations(target_booking_id)
where target_booking_id is not null;


create index idx_makeup_student
on makeup_obligations(student_id);

create index idx_makeup_status
on makeup_obligations(status);

create index idx_makeup_type
on makeup_obligations(obligation_type);


alter table makeup_obligations
enable row level security;


create policy "Admins can manage makeup obligations"
on makeup_obligations
for all
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in (
              'super_admin',
              'admin'
          )
    )
)
with check (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in (
              'super_admin',
              'admin'
          )
    )
);