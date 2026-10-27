-- Migration 029: audited, draft-only schedule edits. Synthetic data only.
create function pg_temp.fails(p_sql text, p_like text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    if SQLERRM not like p_like then
      raise exception 'wrong error for [%]: got [%] wanted [%]', p_sql, SQLERRM, p_like;
    end if;
    return;
  end;
  raise exception 'expected failure but it succeeded: [%] (wanted %)', p_sql, p_like;
end;$f$;

set test.actor='00000000-0000-4000-8000-000000000001';
do $t$
begin
 -- reason is required
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','short')$q$, '%Explain the change%');
 -- guard rails (all must reject and leave data untouched)
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','Moving to the same class')$q$, '%different class%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000005','Different programme class')$q$, '%same programme%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000007','Other month and branch')$q$, '%same monthly schedule%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000004','Target class is cancelled')$q$, '%scheduled classes%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000001','Source month is locked')$q$, '%draft schedule%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000009','Source month is approved')$q$, '%draft schedule%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000003','Already booked on the target')$q$, '%already has a booking%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000002','Attendance already recorded')$q$, '%upcoming regular%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000008','80000000-0000-4000-8000-000000000002','This is a replacement booking')$q$, '%upcoming regular%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000012','80000000-0000-4000-8000-000000000002','Student is inactive today')$q$, '%not active%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000013','80000000-0000-4000-8000-000000000002','Enrollment ended before target')$q$, '%not active on the target date%');
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000009','Booking has a follow-up')$q$, '%already has a follow-up%');
 -- overlap: student 2 is also booked 11:00-12:30 on 7 Nov in another class
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','Would overlap another class')$q$, '%overlapping class%');
 if (select class_session_id from public.student_bookings where id='90000000-0000-4000-8000-000000000001')<>'80000000-0000-4000-8000-000000000001' then raise exception 'Rejected calls changed a booking'; end if;
 if exists(select 1 from public.draft_schedule_edits) then raise exception 'Rejected calls wrote audit rows'; end if;
end;$t$;

-- a valid move
do $t$
declare a uuid;
begin
 a:=public.move_student_in_draft('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','Parent asked for the later slot');
 if (select class_session_id from public.student_bookings where id='90000000-0000-4000-8000-000000000001')<>'80000000-0000-4000-8000-000000000002' then raise exception 'Booking not moved'; end if;
 if not (select manually_placed from public.student_bookings where id='90000000-0000-4000-8000-000000000001') then raise exception 'Moved booking not flagged manual'; end if;
 if (select enrollment_id from public.student_bookings where id='90000000-0000-4000-8000-000000000001')<>'50000000-0000-4000-8000-000000000001' then raise exception 'Enrollment link changed'; end if;
 if (select count(*) from public.draft_schedule_edits where id=a and action='move' and student_id='30000000-0000-4000-8000-000000000001'
     and from_class_id='80000000-0000-4000-8000-000000000001' and to_class_id='80000000-0000-4000-8000-000000000002' and from_class_date='2026-11-07' and from_start_time='09:00'
     and to_start_time='11:00' and edited_by='00000000-0000-4000-8000-000000000001' and schedule_month='2026-11-01')<>1 then raise exception 'Move audit row wrong'; end if;
 -- enrollments never change
 if (select count(*) from public.enrollments where id='50000000-0000-4000-8000-000000000001' and default_session_id='40000000-0000-4000-8000-000000000001')<>1 then raise exception 'Enrollment was modified'; end if;
 -- capacity: C2 now holds student 1 and 3 (2/2): another move in is refused
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000014','80000000-0000-4000-8000-000000000002','Class should be full now')$q$, '%full%');
end;$t$;

-- remove
do $t$
declare a uuid;
begin
 perform pg_temp.fails($q$select public.remove_student_from_draft_class('90000000-0000-4000-8000-000000000004','Locked month cannot change')$q$, '%draft schedule%');
 perform pg_temp.fails($q$select public.remove_student_from_draft_class('90000000-0000-4000-8000-000000000006','Already marked present')$q$, '%upcoming regular%');
 perform pg_temp.fails($q$select public.remove_student_from_draft_class('90000000-0000-4000-8000-000000000003','Has a follow-up obligation')$q$, '%follow-up%');
 perform pg_temp.fails($q$select public.remove_student_from_draft_class('90000000-0000-4000-8000-000000000002','x')$q$, '%Explain the change%');
 a:=public.remove_student_from_draft_class('90000000-0000-4000-8000-000000000002','Student is away this month');
 if exists(select 1 from public.student_bookings where id='90000000-0000-4000-8000-000000000002') then raise exception 'Booking not removed'; end if;
 if (select count(*) from public.draft_schedule_edits where id=a and action='remove' and student_id='30000000-0000-4000-8000-000000000002'
     and from_class_id='80000000-0000-4000-8000-000000000001' and to_class_id is null)<>1 then raise exception 'Remove audit row wrong'; end if;
end;$t$;

-- add
do $t$
declare a uuid;
begin
 perform pg_temp.fails($q$select public.add_student_to_draft_class('30000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000001','No enrollment for student')$q$, '%no active enrollment%');
 perform pg_temp.fails($q$select public.add_student_to_draft_class('30000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000001','Inactive student today')$q$, '%not active%');
 perform pg_temp.fails($q$select public.add_student_to_draft_class('30000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000004','Cancelled class target')$q$, '%scheduled classes%');
 perform pg_temp.fails($q$select public.add_student_to_draft_class('30000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000006','Approved month target')$q$, '%draft schedule%');
 perform pg_temp.fails($q$select public.add_student_to_draft_class('30000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','Overlaps the other class')$q$, '%overlapping class%');
 a:=public.add_student_to_draft_class('30000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','Back after the break');
 if (select count(*) from public.student_bookings where class_session_id='80000000-0000-4000-8000-000000000001' and student_id='30000000-0000-4000-8000-000000000002'
     and enrollment_id='50000000-0000-4000-8000-000000000002' and booking_type='regular' and attendance_status='upcoming' and manually_placed)<>1 then raise exception 'Added booking wrong'; end if;
 if (select count(*) from public.draft_schedule_edits where id=a and action='add' and student_id='30000000-0000-4000-8000-000000000002' and to_class_id='80000000-0000-4000-8000-000000000001' and from_class_id is null)<>1 then raise exception 'Add audit row wrong'; end if;
 perform pg_temp.fails($q$select public.add_student_to_draft_class('30000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','Already in that class')$q$, '%already has a booking%');
 -- fill C1 (cap 2) then refuse the third
 perform public.add_student_to_draft_class('30000000-0000-4000-8000-000000000001'::uuid,'80000000-0000-4000-8000-000000000001','Fill the class to capacity');
 perform pg_temp.fails($q$select public.add_student_to_draft_class('30000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000001','Class is already full')$q$, '%full%');
end;$t$;

-- reopen
do $t$
declare a uuid;
begin
 perform pg_temp.fails($q$select public.reopen_schedule_draft('70000000-0000-4000-8000-000000000004','Locked months stay locked')$q$, '%locked%');
 perform pg_temp.fails($q$select public.reopen_schedule_draft('70000000-0000-4000-8000-000000000001','Already a draft schedule')$q$, '%Only an approved%');
 perform pg_temp.fails($q$select public.reopen_schedule_draft('70000000-0000-4000-8000-000000000002','x')$q$, '%Explain the change%');
 a:=public.reopen_schedule_draft('70000000-0000-4000-8000-000000000002','Found a wrong class after approval');
 if (select count(*) from public.schedule_batches where id='70000000-0000-4000-8000-000000000002' and status='draft' and approved_at is null)<>1 then raise exception 'Batch not reopened'; end if;
 if (select count(*) from public.draft_schedule_edits where id=a and action='reopen_draft' and student_id is null)<>1 then raise exception 'Reopen audit row wrong'; end if;
 if (select status from public.schedule_batches where id='70000000-0000-4000-8000-000000000004')<>'locked' then raise exception 'Locked batch changed'; end if;
 -- the reopened month can now be edited
 perform public.remove_student_from_draft_class('90000000-0000-4000-8000-000000000005','Student left this month');
end;$t$;

-- non-admin and anonymous callers are refused
set test.actor='00000000-0000-4000-8000-000000000002';
do $t$
begin
 perform pg_temp.fails($q$select public.move_student_in_draft('90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000009','Staff must not edit the draft')$q$, '%Only active admins%');
 perform pg_temp.fails($q$select public.remove_student_from_draft_class('90000000-0000-4000-8000-000000000003','Staff must not edit the draft')$q$, '%Only active admins%');
 perform pg_temp.fails($q$select public.add_student_to_draft_class('30000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000009','Staff must not edit the draft')$q$, '%Only active admins%');
 perform pg_temp.fails($q$select public.reopen_schedule_draft('70000000-0000-4000-8000-000000000001','Staff must not reopen schedules')$q$, '%Only active admins%');
end;$t$;
set test.actor='00000000-0000-4000-8000-000000000001';
set role anon;
do $t$
begin
 begin
  perform public.move_student_in_draft('90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000009','Anon must not edit anything');
  raise exception 'anon executed a draft edit';
 exception when insufficient_privilege then null; end;
end;$t$;
reset role;
-- clients can read but never write the audit table directly
set role authenticated;
do $t$
begin
 begin
  insert into public.draft_schedule_edits(branch_id,schedule_month,action,reason)
   values ('10000000-0000-4000-8000-000000000001','2026-11-01','reopen_draft','Direct insert must fail');
  raise exception 'authenticated inserted audit rows directly';
 exception when insufficient_privilege then null; end;
 if (select count(*) from public.draft_schedule_edits)<>6 then raise exception 'Admin cannot read the audit rows (or wrong count)'; end if;
end;$t$;
reset role;
select 'draft_schedule_edits OK' as result;
