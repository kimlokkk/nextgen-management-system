-- End-to-end automated operations smoke test on SYNTHETIC records only.
-- The CI job running this file creates a disposable postgres service.
-- DO NOT run against the user's actual Supabase Local or production database.
set test.actor = '00000000-0000-4000-8000-000000000001';

do $uat$
declare
  v_first uuid;
  v_second uuid;
  v_first_target uuid;
  v_second_target uuid;
  v_rejected boolean;
begin
  -- Future class: nobody can manufacture attendance.
  v_rejected := false;
  begin
    perform public.record_class_attendance(
      '80000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001','present');
  exception when others then
    if SQLERRM like '%before class ends%' then v_rejected := true;
    else raise; end if;
  end;
  if not v_rejected then
    raise exception 'UAT: future regular attendance was permitted';
  end if;

  -- Planned replacement: retain original upcoming booking, no automatic attendance.
  v_first := public.initiate_replacement_obligation(
    '80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','planned');
  if v_first is null or
    (select attendance_status from public.student_bookings
     where id='80000000-0000-4000-8000-000000000001') <> 'upcoming' then
    raise exception 'UAT: planning changed original attendance';
  end if;

  -- Duplicate entitlement is rejected, without creating another record.
  v_rejected:=false;
  begin
    perform public.initiate_replacement_obligation(
      '80000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001','planned');
  exception when others then
    if SQLERRM like '%already has an active replacement%' then v_rejected:=true;
    else raise; end if;
  end;
  if not v_rejected or
     (select count(*) from public.makeup_obligations
      where source_booking_id='80000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'UAT: duplicate obligation was permitted';
  end if;

  v_first_target:=public.assign_replacement_obligation(
    v_first,'70000000-0000-4000-8000-000000000003');
  if not exists(select 1 from public.makeup_obligations m
    join public.student_bookings b on b.id=m.target_booking_id
    where m.id=v_first and m.status='scheduled'
    and b.id=v_first_target and b.booking_type='replacement'
    and b.attendance_status='upcoming') then
    raise exception 'UAT: replacement assignment is not linked atomically';
  end if;

  v_second:=public.initiate_replacement_obligation(
    '80000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000002','planned');

  -- Both students cannot take the same one-seat yellow class.
  v_rejected:=false;
  begin
    perform public.assign_replacement_obligation(
      v_second,'70000000-0000-4000-8000-000000000003');
  exception when others then
    if SQLERRM like '%No replacement (yellow) seats remain%' then v_rejected:=true;
    else raise; end if;
  end;
  if not v_rejected or
    (select status from public.makeup_obligations where id=v_second) <> 'open' then
    raise exception 'UAT: yellow seat was overbooked or unsuccessful assignment changed state';
  end if;

  -- Moving a reservation must retain booking ID and free old capacity.
  if public.change_replacement_slot(
    v_first,'70000000-0000-4000-8000-000000000005') <> v_first_target then
    raise exception 'UAT: moved target did not keep original booking ID';
  end if;
  if exists(select 1 from public.student_bookings
    where class_session_id='70000000-0000-4000-8000-000000000003') then
    raise exception 'UAT: old yellow seat was not released';
  end if;

  -- Newly vacant seat now available to the second student.
  v_second_target:=public.assign_replacement_obligation(
    v_second,'70000000-0000-4000-8000-000000000003');

  -- Release and cancel first obligation; do not touch second booking.
  perform public.cancel_replacement(v_first,'release',null);
  if (select status from public.makeup_obligations where id=v_first)<>'open'
    or exists(select 1 from public.student_bookings where id=v_first_target) then
    raise exception 'UAT: released reservation was not removed';
  end if;
  perform public.cancel_replacement(v_first,'cancel','Synthetic UAT release');
  if (select status from public.makeup_obligations where id=v_first)<>'cancelled' then
    raise exception 'UAT: first obligation failed cancellation';
  end if;

  -- Simulate a completed target class in disposable CI only.
  update public.class_sessions
  set class_date=(now() at time zone 'Asia/Kuala_Lumpur')::date-2
  where id='70000000-0000-4000-8000-000000000003';
  perform public.record_class_attendance(
    v_second_target,'70000000-0000-4000-8000-000000000003','present');
  if not exists(select 1 from public.makeup_obligations m
    join public.student_bookings b on b.id=m.target_booking_id
    where m.id=v_second and m.status='completed'
    and b.attendance_status='present' and b.id=v_second_target) then
    raise exception 'UAT: attending makeup failed to complete its obligation';
  end if;
  if (select attendance_status from public.student_bookings
    where id='80000000-0000-4000-8000-000000000002') <> 'upcoming' then
    raise exception 'UAT: makeup completion overwrote original booking';
  end if;

  -- Authorization is enforced by the RPC even when called directly.
  perform set_config('test.actor','00000000-0000-4000-8000-000000000002',true);
  v_rejected:=false;
  begin
    perform public.record_class_attendance(
      '80000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001','absent');
  exception when others then
    if SQLERRM like '%Only active admins%' then v_rejected:=true;
    else raise; end if;
  end;
  if not v_rejected then raise exception 'UAT: parent role recorded attendance'; end if;
  perform set_config('test.actor','00000000-0000-4000-8000-000000000001',true);

  -- Both synthetic original bookings still exist; one completed target remains.
  if (select count(*) from public.student_bookings)<>3 then
    raise exception 'UAT: booking count inconsistent after release/complete journey';
  end if;
  raise notice 'UAT STEP 1 PASSED: timed attendance, planned replacement, duplicate denial, capacity, slot move, cancellation, completion and admin permission';
end;
$uat$;

-- Also exercise reschedule target attendance + regular attendance correction on
-- separate synthetic students and ended classes in this disposable DB.
insert into public.students(id,status,full_name) values
  ('30000000-0000-4000-8000-000000000003','active','Synthetic reschedule student'),
  ('30000000-0000-4000-8000-000000000004','active','Synthetic regular student');
insert into public.class_sessions(
  id,schedule_batch_id,session_template_id,branch_id,programme_id,
  class_date,start_time,end_time,status,replacement_capacity
) values
  ('70000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   (now() at time zone 'Asia/Kuala_Lumpur')::date-4,'10:00','11:00','scheduled',3),
  ('70000000-0000-4000-8000-000000000007','60000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   (now() at time zone 'Asia/Kuala_Lumpur')::date-2,'12:00','13:00','scheduled',3),
  ('70000000-0000-4000-8000-000000000008','60000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   (now() at time zone 'Asia/Kuala_Lumpur')::date-3,'10:00','11:00','scheduled',3);
insert into public.student_bookings(id,class_session_id,student_id,booking_type,attendance_status)
values
  ('80000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000006',
   '30000000-0000-4000-8000-000000000003','regular','rescheduled'),
  ('80000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000007',
   '30000000-0000-4000-8000-000000000003','reschedule','upcoming'),
  ('80000000-0000-4000-8000-000000000005','70000000-0000-4000-8000-000000000008',
   '30000000-0000-4000-8000-000000000004','regular','upcoming');
insert into public.makeup_obligations(
  id,student_id,source_booking_id,target_booking_id,obligation_type,status
)values
  ('90000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000004','reschedule','scheduled');

do $uat$
declare
 v_rejected boolean := false;
begin
 begin
  perform public.record_class_attendance(
    '80000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000006','present');
 exception when others then
  if SQLERRM like '%Rescheduled original attendance cannot be overridden%' then v_rejected:=true;
  else raise;end if;
 end;
 if not v_rejected then raise exception 'UAT: rescheduled original was overwritten';end if;

 perform public.record_class_attendance(
   '80000000-0000-4000-8000-000000000004',
   '70000000-0000-4000-8000-000000000007','present');
 if not exists(select 1 from public.makeup_obligations
  where id='90000000-0000-4000-8000-000000000001' and status='completed') then
  raise exception 'UAT: attended reschedule did not complete';
 end if;
 if (select attendance_status from public.student_bookings
  where id='80000000-0000-4000-8000-000000000003')<>'rescheduled' then
  raise exception 'UAT: reschedule original lost its historical status';
 end if;

 perform public.record_class_attendance(
   '80000000-0000-4000-8000-000000000005',
   '70000000-0000-4000-8000-000000000008','absent');
 if exists(select 1 from public.makeup_obligations
  where source_booking_id='80000000-0000-4000-8000-000000000005') then
  raise exception 'UAT: absent regular student automatically received replacement';
 end if;
 perform public.record_class_attendance(
   '80000000-0000-4000-8000-000000000005',
   '70000000-0000-4000-8000-000000000008','present');
 if (select attendance_status from public.student_bookings
  where id='80000000-0000-4000-8000-000000000005')<>'present' then
  raise exception 'UAT: attendance correction failed';
 end if;
 raise notice 'UAT STEP 2 PASSED: reschedule preserves original history and regular attendance correction creates no automatic entitlement';
end;
$uat$;

select 'PASS — Isolated operations UAT smoke (fictional records only)' as result;
