-- =====================================================
-- HOUSEKEEPING RLS
-- =====================================================

alter table branches enable row level security;
alter table programmes enable row level security;
alter table session_templates enable row level security;


-- BRANCHES

create policy "Authenticated users can view branches"
on branches
for select
to authenticated
using (true);

create policy "Admins can manage branches"
on branches
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


-- PROGRAMMES

create policy "Authenticated users can view programmes"
on programmes
for select
to authenticated
using (true);

create policy "Admins can manage programmes"
on programmes
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


-- SESSION TEMPLATES

create policy "Authenticated users can view sessions"
on session_templates
for select
to authenticated
using (true);

create policy "Admins can manage sessions"
on session_templates
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