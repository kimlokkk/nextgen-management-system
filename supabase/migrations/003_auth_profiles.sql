-- =====================================================
-- USER PROFILES
-- =====================================================

create table profiles (
    id uuid primary key
        references auth.users(id)
        on delete cascade,

    full_name text,

    role text not null default 'facilitator'
        check (
            role in (
                'super_admin',
                'admin',
                'facilitator',
                'finance'
            )
        ),

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- =====================================================
-- AUTO CREATE PROFILE AFTER AUTH USER IS CREATED
-- =====================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
    insert into public.profiles (
        id,
        full_name
    )
    values (
        new.id,
        new.raw_user_meta_data ->> 'full_name'
    );

    return new;
end;
$$;


create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute procedure public.handle_new_user();


-- =====================================================
-- RLS
-- =====================================================

alter table profiles enable row level security;


create policy "Users can view own profile"
on profiles
for select
to authenticated
using (
    auth.uid() = id
);


create policy "Users can update own profile"
on profiles
for update
to authenticated
using (
    auth.uid() = id
)
with check (
    auth.uid() = id
);