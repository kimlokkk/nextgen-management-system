import { createClient } from "@/lib/supabase/server"
import {
    countsTowardsRegularCapacity,
    countsTowardsReplacementCapacity,
} from "@/lib/reschedule-policy"

export type ScheduleValidationResult = {
    valid: boolean
    errors: string[]
    stats: {
        sessions: number
        bookings: number
    }
}

export async function getScheduleBatchValidation(
    batchId: string
): Promise<ScheduleValidationResult> {
    const supabase = await createClient()

    const { data: sessions, error: sessionError } =
        await supabase
            .from("class_sessions")
            .select(`
        id,
        session_template_id,
        class_date,
        start_time,
        end_time,
        regular_capacity,
        replacement_capacity,
        status
      `)
            .eq("schedule_batch_id", batchId)

    if (sessionError) {
        return {
            valid: false,
            errors: [sessionError.message],
            stats: {
                sessions: 0,
                bookings: 0,
            },
        }
    }

    if (!sessions?.length) {
        return {
            valid: false,
            errors: [
                "No class sessions found in this schedule.",
            ],
            stats: {
                sessions: 0,
                bookings: 0,
            },
        }
    }

    const sessionIds = sessions.map(
        (session) => session.id
    )

    const { data: bookings, error: bookingError } =
        await supabase
            .from("student_bookings")
            .select(`
            id,
            class_session_id,
            student_id,
            enrollment_id,
            booking_type,
            attendance_status
        `)
            .in("class_session_id", sessionIds)

    if (bookingError) {
        return {
            valid: false,
            errors: [bookingError.message],
            stats: {
                sessions: sessions.length,
                bookings: 0,
            },
        }
    }

    const allBookings = bookings ?? []

    const studentIds = [
        ...new Set(
            allBookings.map(
                (booking) => booking.student_id
            )
        ),
    ]

    const enrollmentIds = [
        ...new Set(
            allBookings
                .map(
                    (booking) =>
                        booking.enrollment_id
                )
                .filter(Boolean)
        ),
    ] as string[]

    const { data: students } =
        studentIds.length > 0
            ? await supabase
                .from("students")
                .select(`
            id,
            full_name,
            status
          `)
                .in("id", studentIds)
            : { data: [] }

    const { data: enrollments } =
        enrollmentIds.length > 0
            ? await supabase
                .from("enrollments")
                .select(`
            id,
            status,
            default_session_id,
            start_date,
            end_date
          `)
                .in("id", enrollmentIds)
            : { data: [] }

    const studentMap = new Map(
        students?.map((student) => [
            student.id,
            student,
        ]) ?? []
    )

    const enrollmentMap = new Map(
        enrollments?.map((enrollment) => [
            enrollment.id,
            enrollment,
        ]) ?? []
    )

    const sessionMap = new Map(
        sessions.map((session) => [
            session.id,
            session,
        ])
    )

    const errors: string[] = []

    // =====================================================
    // CAPACITY + BOOKING VALIDATION
    // =====================================================

    for (const session of sessions) {
        const sessionBookings =
            allBookings.filter(
                (booking) =>
                    booking.class_session_id ===
                    session.id
            )

        const regularCount =
            sessionBookings.filter(
                (booking) =>
                    countsTowardsRegularCapacity(
                        booking
                    )
            ).length

        const replacementCount =
            sessionBookings.filter(
                (booking) =>
                    countsTowardsReplacementCapacity(
                        booking
                    )
            ).length

        if (
            regularCount >
            session.regular_capacity
        ) {
            errors.push(
                `${session.class_date} ${session.start_time.slice(
                    0,
                    5
                )}: regular capacity exceeded (${regularCount}/${session.regular_capacity}).`
            )
        }

        if (
            replacementCount >
            session.replacement_capacity
        ) {
            errors.push(
                `${session.class_date} ${session.start_time.slice(
                    0,
                    5
                )}: replacement capacity exceeded (${replacementCount}/${session.replacement_capacity}).`
            )
        }

        for (const booking of sessionBookings) {
            const student = studentMap.get(
                booking.student_id
            )

            const enrollment =
                booking.enrollment_id
                    ? enrollmentMap.get(
                        booking.enrollment_id
                    )
                    : null

            if (!student) {
                errors.push(
                    "A booking references a missing student."
                )

                continue
            }

            if (student.status !== "active") {
                errors.push(
                    `${student.full_name} is currently ${student.status}.`
                )
            }

            if (
                booking.booking_type ===
                "regular" &&
                !enrollment
            ) {
                errors.push(
                    `${student.full_name} has a regular booking without a valid enrollment.`
                )

                continue
            }

            if (
                booking.booking_type ===
                "regular" &&
                enrollment
            ) {
                if (
                    enrollment.status !== "active"
                ) {
                    errors.push(
                        `${student.full_name} has an inactive enrollment.`
                    )
                }

                if (
                    enrollment.default_session_id !==
                    session.session_template_id
                ) {
                    errors.push(
                        `${student.full_name}'s regular session no longer matches the generated class.`
                    )
                }

                if (
                    enrollment.start_date >
                    session.class_date
                ) {
                    errors.push(
                        `${student.full_name}'s enrollment has not started on ${session.class_date}.`
                    )
                }

                if (
                    enrollment.end_date &&
                    enrollment.end_date <
                    session.class_date
                ) {
                    errors.push(
                        `${student.full_name}'s enrollment has already ended before ${session.class_date}.`
                    )
                }
            }
        }
    }

    // =====================================================
    // OVERLAPPING STUDENT CLASSES
    // =====================================================

    const activeBookings =
        allBookings.filter(
            (booking) =>
                ![
                    "rescheduled",
                    "cancelled",
                    "not_scheduled",
                ].includes(
                    booking.attendance_status
                )
        )

    const bookingsByStudent = new Map<
        string,
        typeof allBookings
    >()

    for (const booking of activeBookings) {
        const current =
            bookingsByStudent.get(
                booking.student_id
            ) ?? []

        current.push(booking)

        bookingsByStudent.set(
            booking.student_id,
            current
        )
    }

    for (const [
        studentId,
        studentBookings,
    ] of bookingsByStudent) {
        for (
            let i = 0;
            i < studentBookings.length;
            i++
        ) {
            for (
                let j = i + 1;
                j < studentBookings.length;
                j++
            ) {
                const first = sessionMap.get(
                    studentBookings[i].class_session_id
                )

                const second = sessionMap.get(
                    studentBookings[j].class_session_id
                )

                if (!first || !second) {
                    continue
                }

                if (
                    first.class_date !==
                    second.class_date
                ) {
                    continue
                }

                const overlaps =
                    first.start_time <
                    second.end_time &&
                    second.start_time <
                    first.end_time

                if (overlaps) {
                    const student =
                        studentMap.get(studentId)

                    errors.push(
                        `${student?.full_name ??
                        "Student"
                        } has overlapping classes on ${first.class_date
                        }.`
                    )
                }
            }
        }
    }

    const uniqueErrors = [
        ...new Set(errors),
    ]

    return {
        valid: uniqueErrors.length === 0,
        errors: uniqueErrors,
        stats: {
            sessions: sessions.length,
            bookings: allBookings.length,
        },
    }
}