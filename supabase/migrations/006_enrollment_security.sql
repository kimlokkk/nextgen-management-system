alter table enrollments enable row level security;

create policy "Admin can view enrollments"
on enrollments
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

create policy "Admin can create enrollments"
on enrollments
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

create policy "Admin can update enrollments"
on enrollments
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