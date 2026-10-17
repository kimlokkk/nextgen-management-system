-- Attendance Management V1 integration coverage.
-- Runs on disposable PostgreSQL after the earlier replacement lifecycle tests.
set test.actor = '00000000-0000-4000-8000-000000000001';

insert into public.students (id,status) values
('30000000-0000-4000-8000-000000000003','active'),
('30000000-0000-4000-8000-000000000004','active'),
('30000000-0000-4000-8000-000000000005','active'),
('30000000-0000-4000-8000-000000000006','active');

insert into public.class_sessions (
id,schedule_batch_id,session_template_id,branch_id,programme_id,
class_date,start_time,end_time,status,replacement_capacity
) values
('70000000-0000-4000-8000-000000000007','60000000-0000-4000-8000-000000000002',
'40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
'20000000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kuala_Lumpur')::date-9,'09:00','10:00','scheduled',5),
('70000000-0000-4000-8000-000000000008','60000000-0000-4000-8000-000000000002',
'40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
'20000000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kuala_Lumpur')::date+8,'09:00','10:00','scheduled',5),
('70000000-0000-4000-8000-000000000009','60000000-0000-4000-8000-000000000002',
'40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
'20000000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kuala_Lumpur')::date-5,'12:00','13:00','scheduled',5),
('70000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000002',
'40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
'20000000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kuala_Lumpur')::date-3,'12:00','13:00','scheduled',5),
('70000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000002',
'40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
'20000000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kuala_Lumpur')::date+12,'09:00','10:00','scheduled',5),
('70000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000002',
'40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
'20000000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kuala_Lumpur')::date-2,'12:00','13:00','scheduled',5);

insert into public.student_bookings (
id,class_session_id,student_id,booking_type,attendance_status
) values
-- Regular in past, no obligation.
('80000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000003','regular','upcoming'),
-- Future class.
('80000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000003','regular','upcoming'),
-- Rescheduled original; should remain rescheduled.
('80000000-0000-4000-8000-000000000005','70000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000004','regular','rescheduled'),
-- Reschedule makeup target.
('80000000-0000-4000-8000-000000000006','70000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000004','reschedule','upcoming'),
-- Replacement original is in FUTURE (early makeup).
('80000000-0000-4000-8000-000000000007','70000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000005','regular','upcoming'),
-- Replacement target already ended.
('80000000-0000-4000-8000-000000000008','70000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000005','replacement','upcoming'),
-- Another reschedule (absent, pending follow-up), source rescheduled.
('80000000-0000-4000-8000-000000000009','70000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000006','regular','rescheduled'),
('80000000-0000-4000-8000-000000000010','70000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000006','reschedule','upcoming');

insert into public.makeup_obligations (
id,student_id,source_booking_id,target_booking_id,obligation_type,status
) values
('90000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000004',
'80000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000006','reschedule','scheduled'),
('90000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000005',
'80000000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000008','replacement','scheduled'),
('90000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000006',
'80000000-0000-4000-8000-000000000009','80000000-0000-4000-8000-000000000010','reschedule','scheduled');

do $$
declare
rejected boolean;
begin
    -- Reject premature attendance.
    rejected:=false;
    begin
        perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000004',
        '70000000-0000-4000-8000-000000000008','present');
    exception when others then
        if SQLERRM like '%before class ends%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Future attendance incorrectly allowed'; end if;

    -- Normal regular attendance and corrections.
    perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000003',
        '70000000-0000-4000-8000-000000000007','absent');
    if (select attendance_status from public.student_bookings
       where id='80000000-0000-4000-8000-000000000003') <> 'absent' then
        raise exception 'Regular absent not recorded';
    end if;
    if exists (select 1 from public.makeup_obligations
        where source_booking_id='80000000-0000-4000-8000-000000000003') then
        raise exception 'Regular absence automatically created obligation';
    end if;
    perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000003',
        '70000000-0000-4000-8000-000000000007','present');
    if (select attendance_status from public.student_bookings
       where id='80000000-0000-4000-8000-000000000003') <> 'present' then
        raise exception 'Regular attendance correction failed';
    end if;

    -- The rescheduled ORIGINAL must never be overwritten.
    rejected:=false;
    begin
        perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000005',
        '70000000-0000-4000-8000-000000000007','present');
    exception when others then
        if SQLERRM like '%Rescheduled original attendance%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Rescheduled source could be marked present'; end if;

    -- Attended reschedule completes obligation, original stays rescheduled.
    perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000006',
        '70000000-0000-4000-8000-000000000009','present');
    if not exists (select 1 from public.makeup_obligations m
       join public.student_bookings b on b.id=m.target_booking_id
       where m.id='90000000-0000-4000-8000-000000000003'
         and m.status='completed' and b.attendance_status='present') then
        raise exception 'Reschedule attendance did not complete obligation';
    end if;
    rejected:=false;
    begin
        perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000006',
        '70000000-0000-4000-8000-000000000009','absent');
    exception when others then
        if SQLERRM like '%no longer scheduled%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Completed makeup could be rewritten'; end if;

    -- Replacement completed before ORIGINAL class date.
    perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000008',
        '70000000-0000-4000-8000-000000000010','present');
    if (select status from public.makeup_obligations
        where id='90000000-0000-4000-8000-000000000004') <> 'completed'
       or (select attendance_status from public.student_bookings
        where id='80000000-0000-4000-8000-000000000007') <> 'upcoming' then
        raise exception 'Early replacement completion changed original booking';
    end if;

    -- Makeup ABSENT is stored, but no extra entitlement automatically granted.
    perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000010',
        '70000000-0000-4000-8000-000000000012','absent');
    if (select status from public.makeup_obligations
        where id='90000000-0000-4000-8000-000000000005') <> 'scheduled'
       or (select attendance_status from public.student_bookings
        where id='80000000-0000-4000-8000-000000000010') <> 'absent' then
        raise exception 'Missed makeup policy incorrect';
    end if;
    -- An admin can correct a missed makeup to present without duplicating.
    perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000010',
        '70000000-0000-4000-8000-000000000012','present');
    if (select status from public.makeup_obligations
        where id='90000000-0000-4000-8000-000000000005') <> 'completed' then
        raise exception 'Corrected makeup did not complete';
    end if;

    -- Booking ID and class ID pairing cannot be faked.
    rejected:=false;
    begin
        perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000003',
        '70000000-0000-4000-8000-000000000010','absent');
    exception when others then
        if SQLERRM like '%does not belong to this class%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Cross-class attendance forged'; end if;

    -- Role check is enforced in DB (SECURITY DEFINER cannot bypass it).
    perform set_config('test.actor','00000000-0000-4000-8000-000000000002',true);
    rejected:=false;
    begin
        perform public.record_class_attendance(
        '80000000-0000-4000-8000-000000000003',
        '70000000-0000-4000-8000-000000000007','absent');
    exception when others then
        if SQLERRM like '%Only active admins%' then rejected:=true;
        else raise; end if;
    end;
    if not rejected then raise exception 'Non-admin able to mark attendance'; end if;
    raise notice 'Attendance Management V1 integration tests PASSED';
end;
$$;
