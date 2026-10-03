-- =====================================================
-- STUDENTS RLS
-- =====================================================

alter table students enable row level security;
alter table student_guardians enable row level security;


create policy "Admin can view students"
on students
for select
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
);


create policy "Admin can create students"
on students
for insert
to authenticated
with check (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
);


create policy "Admin can update students"
on students
for update
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
);


create policy "Admin can view student guardians"
on student_guardians
for select
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
);


create policy "Admin can create student guardians"
on student_guardians
for insert
to authenticated
with check (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.is_active = true
          and profiles.role in ('super_admin', 'admin')
    )
);