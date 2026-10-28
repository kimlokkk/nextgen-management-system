-- Isolated fixture for migration 032 (synthetic rows only; never real students). Run BEFORE 032.
-- generate_monthly_schedule_atomic is a deterministic STAND-IN here (two classes, three bookings, can be told to fail):
-- the real generator is covered by the atomic-generation job and by an end-to-end check against the real schema.
create schema if not exists auth;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('test.actor', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.profiles(id uuid primary key,role text not null,is_active boolean not null default true);
create table public.branches(id uuid primary key);
create table public.students(id uuid primary key,full_name text not null);
create table public.schedule_batches(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),
 schedule_month date not null,status text not null default 'draft',generated_by uuid,
 unique(branch_id,schedule_month)
);
create table public.class_sessions(
 id uuid primary key default gen_random_uuid(),
 schedule_batch_id uuid not null references public.schedule_batches(id) on delete cascade,
 branch_id uuid not null references public.branches(id),class_date date not null,start_time time not null,
 status text not null default 'scheduled'
);
create table public.student_bookings(
 id uuid primary key default gen_random_uuid(),
 class_session_id uuid not null references public.class_sessions(id) on delete cascade,
 student_id uuid not null references public.students(id),
 booking_type text not null default 'regular',attendance_status text not null default 'upcoming'
);
create table public.makeup_obligations(
 id uuid primary key default gen_random_uuid(),
 source_booking_id uuid not null references public.student_bookings(id),
 target_booking_id uuid references public.student_bookings(id) on delete set null
);
create table public.legacy_replacement_reviews(
 id uuid primary key default gen_random_uuid(),
 target_class_id uuid references public.class_sessions(id) on delete set null,
 review_state text not null default 'pending'
);
create table public.draft_schedule_edits(
 id uuid primary key default gen_random_uuid(),
 schedule_batch_id uuid references public.schedule_batches(id) on delete set null,
 action text not null
);
create table public.class_seat_allocation_changes(
 id uuid primary key default gen_random_uuid(),
 class_session_id uuid references public.class_sessions(id) on delete set null
);
create table public.class_replacement_capacity_reviews(
 id uuid primary key default gen_random_uuid(),
 class_session_id uuid references public.class_sessions(id) on delete set null
);

create function public.generate_monthly_schedule_atomic(p_branch_id uuid, p_schedule_month date) returns uuid
language plpgsql as $$
declare v_id uuid; v_c uuid;
begin
  if current_setting('test.fail_generation', true)='1' then raise exception 'Injected generation failure'; end if;
  if exists (select 1 from public.schedule_batches where branch_id=p_branch_id and schedule_month=p_schedule_month) then
    raise exception 'Schedule already exists for this branch/month; regeneration is disabled';
  end if;
  insert into public.schedule_batches(branch_id,schedule_month,status,generated_by)
    values (p_branch_id,p_schedule_month,'draft',auth.uid()) returning id into v_id;
  insert into public.class_sessions(schedule_batch_id,branch_id,class_date,start_time)
    values (v_id,p_branch_id,p_schedule_month,'09:00') returning id into v_c;
  insert into public.student_bookings(class_session_id,student_id)
    select v_c,s.id from public.students s order by s.id limit 2;
  insert into public.class_sessions(schedule_batch_id,branch_id,class_date,start_time)
    values (v_id,p_branch_id,p_schedule_month+7,'11:00') returning id into v_c;
  insert into public.student_bookings(class_session_id,student_id)
    select v_c,s.id from public.students s order by s.id limit 1;
  return v_id;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
insert into public.profiles values
 ('00000000-0000-4000-8000-000000000001','admin',true),
 ('00000000-0000-4000-8000-000000000002','parent',true),
 ('00000000-0000-4000-8000-000000000003','admin',false);
insert into public.branches values ('10000000-0000-4000-8000-000000000001');
insert into public.students values
 ('30000000-0000-4000-8000-000000000001','Fixture student 1'),
 ('30000000-0000-4000-8000-000000000002','Fixture student 2'),
 ('30000000-0000-4000-8000-000000000003','Fixture student 3');

-- Batches (all branch 1). Each has one class with two bookings unless noted.
--   B1 2026-11 draft, clean                      B2 2026-12 draft with a manual edit and a seat change
--   B3 2027-01 draft with attendance recorded    B4 2027-02 draft with a replacement booking
--   B5 2027-03 draft with a make-up record       B6 2027-04 draft with a historical reservation
--   B7 2027-05 draft with a cancelled class      B8 2027-06 approved     B9 2027-07 locked
--   B10 2027-08 draft (used to prove a failed generation changes nothing)
insert into public.schedule_batches(id,branch_id,schedule_month,status) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-11-01','draft'),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','2026-12-01','draft'),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','2027-01-01','draft'),
 ('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','2027-02-01','draft'),
 ('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','2027-03-01','draft'),
 ('40000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','2027-04-01','draft'),
 ('40000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','2027-05-01','draft'),
 ('40000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','2027-06-01','approved'),
 ('40000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001','2027-07-01','locked'),
 ('40000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000001','2027-08-01','draft');
insert into public.class_sessions(id,schedule_batch_id,branch_id,class_date,start_time,status)
 select ('50000000-0000-4000-8000-00000000000'||to_hex(i))::uuid,('40000000-0000-4000-8000-00000000000'||to_hex(i))::uuid,
        '10000000-0000-4000-8000-000000000001',('2026-11-07'::date+i*30),'09:00',
        case when i=7 then 'cancelled' else 'scheduled' end
 from generate_series(1,10) i;
insert into public.student_bookings(id,class_session_id,student_id,booking_type,attendance_status)
 select ('60000000-0000-4000-8000-0000000000'||lpad(to_hex(i*2+n),2,'0'))::uuid,
        ('50000000-0000-4000-8000-00000000000'||to_hex(i))::uuid,
        ('30000000-0000-4000-8000-00000000000'||n)::uuid,
        case when i=4 and n=2 then 'replacement' else 'regular' end,
        case when i=3 and n=1 then 'present' else 'upcoming' end
 from generate_series(1,10) i, generate_series(1,2) n;
insert into public.draft_schedule_edits(schedule_batch_id,action) values
 ('40000000-0000-4000-8000-000000000002','move'),('40000000-0000-4000-8000-000000000002','reopen_draft');
insert into public.class_seat_allocation_changes(class_session_id) values ('50000000-0000-4000-8000-000000000002');
insert into public.makeup_obligations(source_booking_id) values ('60000000-0000-4000-8000-00000000000b'::uuid);
insert into public.legacy_replacement_reviews(target_class_id,review_state) values
 ('50000000-0000-4000-8000-000000000006','pending'),('50000000-0000-4000-8000-000000000001','excluded');
