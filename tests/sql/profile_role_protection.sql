-- Profile privilege-escalation fix (migration 026) on an ISOLATED synthetic PostgreSQL.
-- Uses the REAL migrations 003 and 026 with Supabase-like roles. No real data.
-- Run from the repository root (uses \i). Never run against Supabase Local or the cloud.
create schema auth;
create role anon nologin;
create role authenticated nologin;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('test.actor', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

\i supabase/migrations/003_auth_profiles.sql

-- Supabase's default privileges give anon/authenticated ALL on new public tables.
grant all on public.profiles to anon, authenticated;

create function public.test_expect_state(p_sql text, p_state text) returns void
language plpgsql as $$
declare v_state text;
begin
    begin execute p_sql; exception when others then v_state := sqlstate; end;
    if v_state is distinct from p_state then
        raise exception 'Expected SQLSTATE % but got % for: %', p_state, coalesce(v_state, '(success)'), p_sql;
    end if;
end $$;
create function public.test_rowcount(p_sql text) returns integer
language plpgsql as $$
declare n integer;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on function public.test_expect_state(text, text), public.test_rowcount(text) to anon, authenticated;

insert into auth.users values
    ('c1000000-0000-4000-8000-000000000001', '{"full_name":"Synthetic Staff One"}'),
    ('c1000000-0000-4000-8000-000000000002', '{"full_name":"Synthetic Staff Two"}'),
    ('c1000000-0000-4000-8000-000000000003', '{"full_name":"Synthetic Admin"}');
update public.profiles set role = 'admin' where id = 'c1000000-0000-4000-8000-000000000003';

do $$ begin
    if (select role from public.profiles where id = 'c1000000-0000-4000-8000-000000000001') <> 'facilitator' then
        raise exception 'New users must default to the least-privileged role';
    end if;
end $$;

-- ===== PHASE A: prove the vulnerability exists BEFORE the fix (test premise) =====
set test.actor = 'c1000000-0000-4000-8000-000000000001';
set role authenticated;
select public.test_rowcount($q$update public.profiles set role = 'super_admin', is_active = true where id = auth.uid()$q$);
reset role;
do $$ begin
    if (select role from public.profiles where id = 'c1000000-0000-4000-8000-000000000001') <> 'super_admin' then
        raise exception 'Test premise failed: self-escalation should be possible before migration 026';
    end if;
end $$;
update public.profiles set role = 'facilitator' where id = 'c1000000-0000-4000-8000-000000000001';

-- ===== PHASE B: apply the fix =====
\i supabase/migrations/026_protect_profile_privileged_columns.sql

-- ===== PHASE C: client sessions can no longer escalate =====
set test.actor = 'c1000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
begin
    if public.test_rowcount($q$update public.profiles set full_name = 'Renamed Self' where id = auth.uid()$q$) <> 1 then
        raise exception 'User must still be able to edit own full_name'; end if;
    if public.test_rowcount($q$update public.profiles set full_name = 'Hijack' where id = 'c1000000-0000-4000-8000-000000000002'$q$) <> 0 then
        raise exception 'User must not edit another user profile (RLS)'; end if;
    perform public.test_expect_state($q$update public.profiles set role = 'super_admin' where id = auth.uid()$q$, '42501');
    perform public.test_expect_state($q$update public.profiles set role = 'admin' where id = auth.uid()$q$, '42501');
    perform public.test_expect_state($q$update public.profiles set is_active = true where id = auth.uid()$q$, '42501');
    perform public.test_expect_state($q$update public.profiles set id = gen_random_uuid() where id = auth.uid()$q$, '42501');
    perform public.test_expect_state($q$insert into public.profiles (id, role) values (gen_random_uuid(), 'super_admin')$q$, '42501');
    perform public.test_expect_state($q$delete from public.profiles where id = auth.uid()$q$, '42501');
    if (select count(*) from public.profiles) <> 1 then
        raise exception 'User must still read exactly their own profile'; end if;
end $$;
reset role;

set role anon;
select public.test_expect_state($q$select count(*) from public.profiles$q$, '42501');
select public.test_expect_state($q$update public.profiles set full_name = 'x'$q$, '42501');
reset role;

do $$ begin
    if (select role from public.profiles where id = 'c1000000-0000-4000-8000-000000000001') <> 'facilitator' then
        raise exception 'Role changed despite rejected attempts'; end if;
    if (select full_name from public.profiles where id = 'c1000000-0000-4000-8000-000000000002') <> 'Synthetic Staff Two' then
        raise exception 'Another user profile was modified'; end if;
end $$;

-- ===== PHASE D: server-side administration still works =====
update public.profiles set role = 'finance' where id = 'c1000000-0000-4000-8000-000000000002';   -- postgres / service role
create function public.test_promote(p uuid) returns void language sql security definer as
$$ update public.profiles set role = 'admin' where id = p $$;
grant execute on function public.test_promote(uuid) to authenticated;
set role authenticated;
select public.test_promote('c1000000-0000-4000-8000-000000000002');   -- future admin RPC owned by postgres
reset role;
do $$ begin
    if (select role from public.profiles where id = 'c1000000-0000-4000-8000-000000000002') <> 'admin' then
        raise exception 'SECURITY DEFINER administration must still be able to change roles'; end if;
end $$;

-- ===== PHASE E: trigger is an independent second layer (simulate an accidental re-grant) =====
grant update (role, is_active) on public.profiles to authenticated;
set test.actor = 'c1000000-0000-4000-8000-000000000001';
set role authenticated;
select public.test_expect_state($q$update public.profiles set role = 'super_admin' where id = auth.uid()$q$, '42501');
select public.test_expect_state($q$update public.profiles set is_active = false where id = auth.uid()$q$, '42501');
reset role;
revoke update (role, is_active) on public.profiles from authenticated;
do $$ begin
    if (select role from public.profiles where id = 'c1000000-0000-4000-8000-000000000001') <> 'facilitator' then
        raise exception 'Trigger layer failed: role changed after re-grant'; end if;
    raise notice 'profile role protection: all assertions passed';
end $$;
