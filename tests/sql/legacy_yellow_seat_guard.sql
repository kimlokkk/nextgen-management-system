-- Ephemeral fixture only. Never run this test against MTDC local/production.
set test.actor = '00000000-0000-4000-8000-000000000001';
update public.students
set full_name = 'Fixture student'
where id = '30000000-0000-4000-8000-000000000002';

insert into public.legacy_replacement_reviews (
    source_batch, source_ref, branch_id, student_name,
    original_date, replacement_date, programme_code, space_number,
    start_time, end_time, technical_status, target_class_id
) values (
    'fixture', 'guard-test-1',
    '10000000-0000-4000-8000-000000000001',
    'Fixture student', '2026-09-12', '2026-10-03', 'JR_MAKER', 1,
    '12:00', '13:00', 'ORIGINAL_BOOKING_MISSING',
    '70000000-0000-4000-8000-000000000003'
);

do $$
begin
    if public.legacy_reserved_yellow_seats('70000000-0000-4000-8000-000000000003') <> 1 then
        raise exception 'Legacy booked seat not reserved';
    end if;

    begin
        insert into public.student_bookings (
            class_session_id, student_id, booking_type, attendance_status
        ) values (
            '70000000-0000-4000-8000-000000000003',
            '30000000-0000-4000-8000-000000000002',
            'replacement','upcoming'
        );
        raise exception 'Modern booking stole reserved Excel yellow seat';
    exception when raise_exception then
        if SQLERRM not like 'No yellow seats remain:%' then raise; end if;
    end;
end;
$$;

-- The fixture admin explicitly authorizes extra seats (SQL fixture only).
update public.class_sessions
set replacement_capacity = 2
where id = '70000000-0000-4000-8000-000000000003';

insert into public.student_bookings (
    id, class_session_id, student_id, booking_type, attendance_status
) values (
    '80000000-0000-4000-8000-000000000099',
    '70000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000002',
    'replacement', 'upcoming'
);

do $$
begin
    begin
        update public.class_sessions set replacement_capacity=1
        where id='70000000-0000-4000-8000-000000000003';
        raise exception 'Capacity lowered below actual active and legacy reservations';
    exception when raise_exception then
        if SQLERRM not like 'Capacity below occupied seats:%' then raise; end if;
    end;

    -- Same student, matching class and replacement type: explicitly linked,
    -- so the Excel reservation and real booking count ONCE.
    update public.legacy_replacement_reviews
    set linked_active_booking_id='80000000-0000-4000-8000-000000000099'
    where source_batch='fixture' and source_ref='guard-test-1';

    if public.legacy_reserved_yellow_seats('70000000-0000-4000-8000-000000000003') <> 0 then
        raise exception 'Linked Excel booking was double-counted';
    end if;

    -- Cancelling its modern booking reactivates the legacy reservation.
    update public.student_bookings set attendance_status='cancelled'
    where id='80000000-0000-4000-8000-000000000099';

    if public.legacy_reserved_yellow_seats('70000000-0000-4000-8000-000000000003') <> 1 then
        raise exception 'Cancelling linked modern booking lost Excel reservation';
    end if;

    begin
        delete from public.class_sessions
        where id='70000000-0000-4000-8000-000000000003';
        raise exception 'Regeneration deleted a class with confirmed legacy reservations';
    exception when raise_exception then
        if SQLERRM not like '%confirmed legacy replacement reservations%' then raise; end if;
    end;

    begin
        update public.legacy_replacement_reviews
        set linked_active_booking_id='80000000-0000-4000-8000-000000000002'
        where source_batch='fixture' and source_ref='guard-test-1';
        raise exception 'Legacy reservation could link to wrong booking';
    exception when raise_exception then
        if SQLERRM not like '%matching active replacement%' then raise; end if;
    end;
end;
$$;

-- A source booking itself is NOT converted into an entitlement/attendance.
do $$
begin
    if exists (
        select 1 from public.makeup_obligations m
        where m.target_booking_id='80000000-0000-4000-8000-000000000099'
    ) then
        raise exception 'Legacy seat reservation created an obligation';
    end if;
end;
$$;

select 'Legacy yellow seats guard / link dedupe / cancellation tests passed' as result;
