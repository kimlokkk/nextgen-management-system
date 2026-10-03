import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { markForReschedule } from "./actions"

type PageProps = {
    params: Promise<{
        id: string
    }>
}

export default async function ScheduleSessionPage({
    params,
}: PageProps) {
    const { id } = await params
    const supabase = await createClient()

    // =====================================================
    // CLASS SESSION
    // =====================================================

    const { data: session, error: sessionError } = await supabase
        .from("class_sessions")
        .select(`
      id,
      schedule_batch_id,
      session_template_id,
      branch_id,
      programme_id,
      class_date,
      week_number,
      start_time,
      end_time,
      regular_capacity,
      replacement_capacity,
      status
    `)
        .eq("id", id)
        .single()

    if (sessionError || !session) {
        notFound()
    }

    // =====================================================
    // SUPPORTING DATA
    // =====================================================

    const [
        branchResult,
        programmeResult,
        batchResult,
        bookingResult,
    ] = await Promise.all([
        supabase
            .from("branches")
            .select("id, name")
            .eq("id", session.branch_id)
            .single(),

        supabase
            .from("programmes")
            .select("id, name")
            .eq("id", session.programme_id)
            .single(),

        supabase
            .from("schedule_batches")
            .select("id, schedule_month, status")
            .eq("id", session.schedule_batch_id)
            .single(),

        supabase
            .from("student_bookings")
            .select(`
        id,
        student_id,
        enrollment_id,
        booking_type,
        attendance_status
      `)
            .eq("class_session_id", session.id),
    ])

    const branch = branchResult.data
    const programme = programmeResult.data
    const batch = batchResult.data
    const bookings = bookingResult.data ?? []

    // =====================================================
    // STUDENTS
    // =====================================================

    const studentIds = [
        ...new Set(
            bookings.map((booking) => booking.student_id)
        ),
    ]

    const enrollmentIds = [
        ...new Set(
            bookings
                .map((booking) => booking.enrollment_id)
                .filter(Boolean)
        ),
    ] as string[]

    const { data: students } =
        studentIds.length > 0
            ? await supabase
                .from("students")
                .select("id, full_name, status, laptop_type")
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

    // =====================================================
    // COUNTS
    // =====================================================

    const regularBookings = bookings.filter(
        (booking) => booking.booking_type === "regular"
    )

    const replacementBookings = bookings.filter(
        (booking) => booking.booking_type === "replacement"
    )

    const rescheduleBookings = bookings.filter(
        (booking) =>
            booking.attendance_status === "rescheduled"
    )

    // =====================================================
    // VALIDATION / WARNINGS
    // =====================================================

    const warnings: string[] = []

    if (
        regularBookings.length >
        session.regular_capacity
    ) {
        warnings.push(
            `Regular capacity exceeded: ${regularBookings.length}/${session.regular_capacity}`
        )
    }

    if (
        replacementBookings.length >
        session.replacement_capacity
    ) {
        warnings.push(
            `Replacement capacity exceeded: ${replacementBookings.length}/${session.replacement_capacity}`
        )
    }

    for (const booking of bookings) {
        const student = studentMap.get(
            booking.student_id
        )

        const enrollment = booking.enrollment_id
            ? enrollmentMap.get(booking.enrollment_id)
            : null

        if (student && student.status !== "active") {
            warnings.push(
                `${student.full_name} is currently ${student.status}`
            )
        }

        if (
            booking.booking_type === "regular" &&
            enrollment &&
            enrollment.status !== "active"
        ) {
            warnings.push(
                `${student?.full_name ?? "Student"} has an inactive enrollment`
            )
        }

        if (
            booking.booking_type === "regular" &&
            enrollment &&
            enrollment.default_session_id !==
            session.session_template_id
        ) {
            warnings.push(
                `${student?.full_name ?? "Student"} regular session no longer matches this class`
            )
        }
    }

    const bookingIds = bookings.map(
        (booking) => booking.id
    )

    const { data: obligations } =
        bookingIds.length > 0
            ? await supabase
                .from("makeup_obligations")
                .select(`
          id,
          source_booking_id,
          obligation_type,
          status
        `)
                .in(
                    "source_booking_id",
                    bookingIds
                )
            : { data: [] }

    const obligationMap = new Map(
        obligations?.map((obligation) => [
            obligation.source_booking_id,
            obligation,
        ]) ?? []
    )

    const uniqueWarnings = [
        ...new Set(warnings),
    ]

    return (
        <div className="space-y-8">

            {/* HEADER */}

            <div>
                <Link
                    href={`/schedule?batch=${session.schedule_batch_id}`}
                    className="text-sm text-muted-foreground hover:underline"
                >
                    ← Back to monthly schedule
                </Link>

                <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <p className="text-sm text-muted-foreground">
                            W{session.week_number} · {session.class_date}
                        </p>

                        <h1 className="mt-1 text-3xl font-bold">
                            {programme?.name ?? "Class Session"}
                        </h1>

                        <p className="mt-2 text-muted-foreground">
                            {branch?.name ?? "-"}
                            {" · "}
                            {session.start_time.slice(0, 5)}
                            {" - "}
                            {session.end_time.slice(0, 5)}
                        </p>
                    </div>

                    <span className="rounded-full border px-3 py-1 text-xs font-medium uppercase">
                        {batch?.status ?? session.status}
                    </span>
                </div>
            </div>

            {/* CAPACITY */}

            <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border bg-background p-5">
                    <p className="text-sm text-muted-foreground">
                        Regular
                    </p>

                    <p className="mt-2 text-2xl font-bold">
                        {regularBookings.length}
                        {" / "}
                        {session.regular_capacity}
                    </p>
                </div>

                <div className="rounded-xl border bg-background p-5">
                    <p className="text-sm text-muted-foreground">
                        Replacement
                    </p>

                    <p className="mt-2 text-2xl font-bold">
                        {replacementBookings.length}
                        {" / "}
                        {session.replacement_capacity}
                    </p>
                </div>

                <div className="rounded-xl border bg-background p-5">
                    <p className="text-sm text-muted-foreground">
                        Reschedule
                    </p>

                    <p className="mt-2 text-2xl font-bold">
                        {rescheduleBookings.length}
                    </p>
                </div>
            </div>

            {/* WARNINGS */}

            {uniqueWarnings.length > 0 && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
                    <h2 className="font-semibold text-destructive">
                        Schedule Warnings
                    </h2>

                    <ul className="mt-3 space-y-2 text-sm">
                        {uniqueWarnings.map((warning) => (
                            <li key={warning}>
                                • {warning}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {uniqueWarnings.length === 0 && (
                <div className="rounded-xl border bg-background p-5">
                    <p className="text-sm font-medium">
                        No conflicts detected.
                    </p>
                </div>
            )}

            {/* STUDENTS */}

            <div className="overflow-hidden rounded-xl border bg-background">
                <div className="border-b px-6 py-4">
                    <h2 className="font-semibold">
                        Students
                    </h2>

                    <p className="text-sm text-muted-foreground">
                        {bookings.length} students assigned
                    </p>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr className="border-b">
                                <th className="px-6 py-3 text-left">
                                    Student
                                </th>

                                <th className="px-6 py-3 text-left">
                                    Type
                                </th>

                                <th className="px-6 py-3 text-left">
                                    Laptop
                                </th>

                                <th className="px-6 py-3 text-left">
                                    Enrollment
                                </th>

                                <th className="px-6 py-3 text-left">
                                    Attendance
                                </th>

                                <th className="px-6 py-3 text-left">
                                    Action
                                </th>
                            </tr>
                        </thead>

                        <tbody>
                            {bookings.length ? (
                                bookings.map((booking) => {
                                    const student =
                                        studentMap.get(
                                            booking.student_id
                                        )

                                    const enrollment =
                                        booking.enrollment_id
                                            ? enrollmentMap.get(
                                                booking.enrollment_id
                                            )
                                            : null

                                    const obligation =
                                        obligationMap.get(booking.id)

                                    const hasActiveObligation =
                                        obligation &&
                                        obligation.status !== "cancelled"

                                    return (
                                        <tr
                                            key={booking.id}
                                            className="border-b last:border-0"
                                        >
                                            <td className="px-6 py-4 font-medium">
                                                {student?.full_name ?? "-"}
                                            </td>

                                            <td className="px-6 py-4 capitalize">
                                                {booking.booking_type}
                                            </td>

                                            <td className="px-6 py-4 capitalize">
                                                {student?.laptop_type ?? "-"}
                                            </td>

                                            <td className="px-6 py-4 capitalize">
                                                {enrollment?.status ?? "-"}
                                            </td>

                                            <td className="px-6 py-4 capitalize">
                                                {booking.attendance_status.replaceAll(
                                                    "_",
                                                    " "
                                                )}
                                            </td>

                                            <td className="px-6 py-4">
                                                {hasActiveObligation ? (
                                                    <span className="text-sm font-medium capitalize">
                                                        {obligation.obligation_type}
                                                        {" · "}
                                                        {obligation.status}
                                                    </span>
                                                ) : booking.booking_type ===
                                                    "regular" &&
                                                    booking.attendance_status ===
                                                    "upcoming" &&
                                                    batch?.status === "locked" ? (
                                                    <form action={markForReschedule}>
                                                        <input
                                                            type="hidden"
                                                            name="booking_id"
                                                            value={booking.id}
                                                        />

                                                        <input
                                                            type="hidden"
                                                            name="session_id"
                                                            value={session.id}
                                                        />

                                                        <button
                                                            type="submit"
                                                            className="text-sm font-medium underline underline-offset-4"
                                                        >
                                                            Mark Reschedule
                                                        </button>
                                                    </form>
                                                ) : (
                                                    <span className="text-muted-foreground">
                                                        -
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })
                            ) : (
                                <tr>
                                    <td
                                        colSpan={6}
                                        className="px-6 py-10 text-center text-muted-foreground"
                                    >
                                        No students assigned to this session.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}