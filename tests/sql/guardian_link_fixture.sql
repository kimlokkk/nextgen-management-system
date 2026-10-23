-- Isolated guardian fixture used BEFORE migration 023 (no real students).
create table public.parents(id uuid primary key,full_name text not null);
create table public.student_guardians(
 id uuid primary key default gen_random_uuid(),
 student_id uuid references public.students(id),
 parent_id uuid references public.parents(id),
 relationship text,
 is_primary boolean not null default false,
 unique(student_id,parent_id)
);
insert into public.parents(id,full_name) values
 ('90000000-0000-4000-8000-000000000001','Fixture guardian 1'),
 ('90000000-0000-4000-8000-000000000002','Fixture guardian 2');
