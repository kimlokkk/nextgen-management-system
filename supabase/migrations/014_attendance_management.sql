-- Attendance Management V1: one atomic attendance operation for all booking types.
-- Designed for locked sessions after their scheduled end in Malaysia time.
-- Does not create new replacement/reschedule entitlements when someone is absent.
create or replace function public.record_class_attendance(
    p_booking_id uuid,
    p_class_session_id uuid,
    p_attendance text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
    v_booking public.student_bookings%rowtype;
    v_class record;
    v_obligation public.makeup_obligations%rowtype;
    v_obligation_id uuid;
    v_is_target boolean := false;
begin
    if v_actor_id is null or not exists (
        select 1 from public.profiles p
        where p.id = v_actor_id
          and p.is_active = true
          and p.role in ('admin', 'super_admin')
    ) then
        raise exception 'Only active admins can record attendance';
    end if;

    if p_attendance is null or p_attendance not in ('present','absent') then
        raise exception 'Attendance must be present or absent';
    end if;

    -- For target bookings, use the same lock order as the replacement engine:
    -- obligation first, then student, then booking.
    select id into v_obligation_id
    from public.makeup_obligations
    where target_booking_id = p_booking_id;

    if v_obligation_id is not null then
        select * into v_obligation
        from public.makeup_obligations
        where id = v_obligation_id for update;
        if not found or v_obligation.status <> 'scheduled'
            or v_obligation.target_booking_id is distinct from p_booking_id then
            raise exception 'Assigned makeup obligation is no longer scheduled';
        end if;
        v_is_target := true;
        perform 1 from public.students s
        where s.id = v_obligation.student_id for update;
    end if;

    select * into v_booking from public.student_bookings
    where id = p_booking_id and class_session_id = p_class_session_id
    for update;

    if not found then
        raise exception 'Booking does not belong to this class';
    end if;

    select c.class_date, c.end_time, c.status as class_status,
        sb.status as batch_status
    into v_class
    from public.class_sessions c
    join public.schedule_batches sb on sb.id = c.schedule_batch_id
    where c.id = p_class_session_id;

    if not found or v_class.class_status <> 'scheduled'
        or v_class.batch_status <> 'locked' then
        raise exception 'Attendance requires a scheduled class in a locked batch';
    end if;

    if (v_class.class_date + v_class.end_time)
        > (now() at time zone 'Asia/Kuala_Lumpur') then
        raise exception 'Attendance cannot be recorded before class ends';
    end if;

    if v_booking.booking_type = 'regular' then
        if v_is_target then
            raise exception 'A regular booking cannot be a makeup target';
        end if;
        -- A rescheduled original is NOT an attended regular booking.
        if v_booking.attendance_status = 'rescheduled'
            or exists (
                select 1 from public.makeup_obligations m
                where m.source_booking_id = v_booking.id
                  and m.obligation_type = 'reschedule'
                  and m.status in ('open','scheduled','completed')
            ) then
            raise exception 'Rescheduled original attendance cannot be overridden';
        end if;

        if p_attendance = 'present' and exists (
            select 1 from public.makeup_obligations m
            where m.source_booking_id = v_booking.id
              and m.obligation_type = 'replacement'
              and m.status in ('open','scheduled','completed')
        ) then
            raise exception 'Cancel or resolve the replacement entitlement before marking original present';
        end if;

        if v_booking.attendance_status not in ('upcoming','present','absent') then
            raise exception 'Original booking cannot be marked for attendance';
        end if;

        -- Attendance corrections are allowed when no conflicting entitlement
        -- exists; do not silently reopen/cancel obligations.
        if v_booking.attendance_status is distinct from p_attendance then
            update public.student_bookings
            set attendance_status = p_attendance, updated_at = now()
            where id = v_booking.id;
        end if;

    elsif v_booking.booking_type in ('reschedule','replacement') then
        if not v_is_target
           or v_obligation.student_id <> v_booking.student_id
           or v_obligation.obligation_type <> v_booking.booking_type then
            raise exception 'Makeup booking has no matching scheduled obligation';
        end if;
        if v_booking.attendance_status not in ('upcoming','absent') then
            raise exception 'Makeup attendance is locked or invalid';
        end if;

        if p_attendance = 'present' then
            -- Recording present also completes the corresponding obligation
            -- in this same transaction (works before the original class date).
            update public.student_bookings
            set attendance_status = 'present', updated_at = now()
            where id = v_booking.id;
            update public.makeup_obligations
            set status = 'completed', updated_at = now()
            where id = v_obligation.id;
        else
            -- Retain the booking and scheduled obligation for manual review:
            -- don't automatically grant a second replacement.
            update public.student_bookings
            set attendance_status = 'absent', updated_at = now()
            where id = v_booking.id;
        end if;
    else
        raise exception 'Unknown booking type';
    end if;

    return v_booking.id;
end;
$$;

revoke all on function public.record_class_attendance(uuid,uuid,text)
from public, anon;
grant execute on function public.record_class_attendance(uuid,uuid,text)
to authenticated;
