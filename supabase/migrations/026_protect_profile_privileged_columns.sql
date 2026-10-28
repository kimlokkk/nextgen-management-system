-- Stop signed-in clients from editing their own privileged profile columns.
--
-- Problem (003_auth_profiles.sql): the policy "Users can update own profile" only checks
-- auth.uid() = id and puts no limit on columns. With Supabase's default table privileges a
-- signed-in user could PATCH their own profiles row and set role = 'super_admin', which
-- every admin-only policy in this schema trusts.
--
-- Fix, two independent layers:
--   1. Column privileges: clients may only UPDATE profiles.full_name. No client INSERT/DELETE.
--   2. A BEFORE UPDATE trigger that rejects id/role/is_active changes made by the anon or
--      authenticated roles, even if a future migration or dashboard action re-grants UPDATE.
-- Server-side administration (SQL editor, service role, SECURITY DEFINER functions owned by
-- postgres) is unaffected because current_user is then not anon/authenticated.
--
-- No rows are read or changed. The app never writes profiles (verified in app/, lib/,
-- components/), so no existing behaviour depends on the removed privileges.
-- Apply to Supabase LOCAL / disposable databases first; company cloud only with approval.

revoke all on table public.profiles from anon;

revoke insert, update, delete, truncate, references, trigger
on table public.profiles from authenticated;

grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_user in ('anon', 'authenticated') and (
        new.id is distinct from old.id
        or new.role is distinct from old.role
        or new.is_active is distinct from old.is_active
    ) then
        raise exception 'Profile role and activation can only be changed by an administrator process'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

drop trigger if exists guard_profile_privileged_columns on public.profiles;
create trigger guard_profile_privileged_columns
    before update on public.profiles
    for each row
    execute function public.guard_profile_privileged_columns();
