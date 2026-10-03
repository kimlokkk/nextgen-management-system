-- =====================================================
-- SECURITY PATCH: PROFILES
-- User boleh baca profile sendiri,
-- tetapi TAK boleh ubah role sendiri.
-- =====================================================

drop policy if exists "Users can update own profile"
on profiles;


-- =====================================================
-- PARENTS RLS
-- =====================================================

alter table parents enable row level security;


create policy "Admin can view parents"
on parents
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


create policy "Admin can create parents"
on parents
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


create policy "Admin can update parents"
on parents
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