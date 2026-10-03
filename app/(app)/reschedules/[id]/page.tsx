import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import {
    countsTowardsRegularCapacity,
    countsTowardsReplacementCapacity,
} from "@/lib/reschedule-policy"
import {
    assignRescheduleSlot,
    reopenRescheduleAssignment,
} from "./actions"

type PageProps = {
    params: Promise<{
        id: string
    }>
}

function getMalaysiaDate() {
    const parts =
        new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Kuala_Lumpur",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(new Date())

    const year =
        parts.find(
            (part) => part.type === "year"
        )?.value ?? ""

    const month =
        parts.find(
            (part) => part.type === "month"
        )?.value ?? ""

    const day =
        parts.find(
            (part) => part.type === "day"
        )?.value ?? ""

    return `${year}-${month}-${day}`
}

export default async function RescheduleDetailPage({
    params,
}: PageProps) {
    const { id } = await params
    const supabase = await createClient()

    // =====================================================
    // OBLIGATION
    // =====================================================

    const {
        data: obligation,
        error: obligationError,
    } = await supabase
        .from("makeup_obligations")
        .select(`
      id,
      student_id,
      enrollment_id,
      source_booking_id,
      target_booking_id,
      obligation_type,
      status,
      reason
    `)
        .eq("id", id)
        .eq("obligation_type", "reschedule")
        .single()

    if (obligationError || !obligation) {
        notFound()
    }

    // =====================================================
    // STUDENT
    // =====================================================

    const { data: student } = await supabase
        .from("students")
        .select(`
      id,
      full_name
    `)
        .eq("id", obligation.student_id)
        .single()

    // =====================================================
    // SOURCE BOOKING
    // =====================================================

    const { data: sourceBooking } = await supabase
        .from("student_bookings")
        .select(`
      id,
      class_session_id
    `)
        .eq(
            "id",
            obligation.source_booking_id
        )
        .single()

    if (!sourceBooking) {
        notFound()
    }

    // =====================================================
    // ORIGINAL CLASS
    // =====================================================

    const { data: originalClass } =
        await supabase
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
        end_time
      `)
            .eq(
                "id",
                sourceBooking.class_session_id
            )
            .single()

    if (!originalClass) {
        notFound()
    }

    // =====================================================
    // TARGET BOOKING + ASSIGNED CLASS
    // =====================================================

    let targetBooking = null
    let targetClass = null

    if (obligation.target_booking_id) {
        const targetBookingResult = await supabase
            .from("student_bookings")
            .select(`
            id,
            class_session_id,
            booking_type,
            attendance_status
        `)
            .eq(
                "id",
                obligation.target_booking_id
            )
            .single()

        targetBooking = targetBookingResult.data

        if (targetBooking) {
            const targetClassResult = await supabase
                .from("class_sessions")
                .select(`
                id,
                schedule_batch_id,
                branch_id,
                programme_id,
                class_date,
                week_number,
                start_time,
                end_time,
                status
            `)
                .eq(
                    "id",
                    targetBooking.class_session_id
                )
                .single()

            targetClass =
                targetClassResult.data
        }
    }

    // =====================================================
    // SUPPORTING DATA
    // =====================================================

    const [
        branchResult,
        programmeResult,
    ] = await Promise.all([
        supabase
            .from("branches")
            .select("id, name")
            .eq("id", originalClass.branch_id)
            .single(),

        supabase
            .from("programmes")
            .select("id, name")
            .eq(
                "id",
                originalClass.programme_id
            )
            .single(),
    ])

    const branch = branchResult.data
    const programme = programmeResult.data

    // =====================================================
    // LOCKED BATCHES
    // =====================================================

    const { data: lockedBatches } =
        await supabase
            .from("schedule_batches")
            .select("id")
            .eq(
                "branch_id",
                originalClass.branch_id
            )
            .eq("status", "locked")

    const lockedBatchIds =
        lockedBatches?.map(
            (batch) => batch.id
        ) ?? []

    // =====================================================
    // CANDIDATE CLASSES
    // =====================================================

    const today = getMalaysiaDate()

    const { data: candidateSessions } =
        lockedBatchIds.length > 0
            ? await supabase
                .from("class_sessions")
                .select(`
            id,
            schedule_batch_id,
            session_template_id,
            class_date,
            week_number,
            start_time,
            end_time,
            regular_capacity,
            replacement_capacity,
            status
          `)
                .in(
                    "schedule_batch_id",
                    lockedBatchIds
                )
                .eq(
                    "branch_id",
                    originalClass.branch_id
                )
                .eq(
                    "programme_id",
                    originalClass.programme_id
                )
                .eq("status", "scheduled")
                .gte("class_date", today)
                .neq("id", originalClass.id)
                .order("class_date")
                .order("start_time")
            : { data: [] }

    const candidateIds =
        candidateSessions?.map(
            (session) => session.id
        ) ?? []

    // =====================================================
    // EXISTING BOOKINGS IN CANDIDATES
    // =====================================================

    const { data: candidateBookings } =
        candidateIds.length > 0
            ? await supabase
                .from("student_bookings")
                .select(`
            id,
            class_session_id,
            student_id,
            booking_type,
            attendance_status
          `)
                .in(
                    "class_session_id",
                    candidateIds
                )
            : { data: [] }

    // =====================================================
    // REMOVE CLASSES STUDENT ALREADY HAS
    // =====================================================

    const studentExistingSessionIds =
        new Set(
            candidateBookings
                ?.filter(
                    (booking) =>
                        booking.student_id ===
                        obligation.student_id
                )
                .map(
                    (booking) =>
                        booking.class_session_id
                ) ?? []
        )

    const availableCandidates =
        candidateSessions?.filter(
            (session) =>
                !studentExistingSessionIds.has(
                    session.id
                )
        ) ?? []

    // =====================================================
    // CAPACITY COUNTS
    // =====================================================

    const regularOccupied = new Map<
        string,
        number
    >()

    const replacementOccupied = new Map<
        string,
        number
    >()

    const rescheduleCounts = new Map<
        string,
        number
    >()

    for (const booking of candidateBookings ?? []) {
        if (
            countsTowardsRegularCapacity(
                booking
            )
        ) {
            const count =
                regularOccupied.get(
                    booking.class_session_id
                ) ?? 0

            regularOccupied.set(
                booking.class_session_id,
                count + 1
            )
        }

        if (
            countsTowardsReplacementCapacity(
                booking
            )
        ) {
            const count =
                replacementOccupied.get(
                    booking.class_session_id
                ) ?? 0

            replacementOccupied.set(
                booking.class_session_id,
                count + 1
            )
        }

        if (
            booking.booking_type ===
            "reschedule" &&
            ![
                "cancelled",
                "not_scheduled",
            ].includes(
                booking.attendance_status
            )
        ) {
            const count =
                rescheduleCounts.get(
                    booking.class_session_id
                ) ?? 0

            rescheduleCounts.set(
                booking.class_session_id,
                count + 1
            )
        }
    }

    return (
        <div className="space-y-8">
            <div>
                <Link
                    href="/reschedules"
                    className="text-sm text-muted-foreground hover:underline"
                >
                    ← Back to reschedule queue
                </Link>

                <div className="mt-4">
                    <p className="text-sm text-muted-foreground">
                        {obligation.status === "open"
                            ? "Find New Slot"
                            : "Reschedule Details"}
                    </p>

                    <h1 className="mt-1 text-3xl font-bold">
                        {student?.full_name ??
                            "Student"}
                    </h1>
                    <div className="mt-3">
                        <span className="rounded-full border px-3 py-1 text-xs font-medium uppercase">
                            {obligation.status}
                        </span>
                    </div>
                </div>
            </div>

            {/* ORIGINAL CLASS */}

            <div className="rounded-xl border bg-background p-6">
                <h2 className="font-semibold">
                    Original Class
                </h2>

                <div className="mt-4 grid gap-4 md:grid-cols-4">
                    <div>
                        <p className="text-xs text-muted-foreground">
                            Branch
                        </p>

                        <p className="mt-1 font-medium">
                            {branch?.name ?? "-"}
                        </p>
                    </div>

                    <div>
                        <p className="text-xs text-muted-foreground">
                            Programme
                        </p>

                        <p className="mt-1 font-medium">
                            {programme?.name ?? "-"}
                        </p>
                    </div>

                    <div>
                        <p className="text-xs text-muted-foreground">
                            Date
                        </p>

                        <p className="mt-1 font-medium">
                            {originalClass.class_date}
                        </p>
                    </div>

                    <div>
                        <p className="text-xs text-muted-foreground">
                            Time
                        </p>

                        <p className="mt-1 font-medium">
                            {originalClass.start_time.slice(
                                0,
                                5
                            )}
                            {" - "}
                            {originalClass.end_time.slice(
                                0,
                                5
                            )}
                        </p>
                    </div>
                </div>
            </div>

            {/* ASSIGNED CLASS */}

            {obligation.status === "scheduled" && targetClass && (
                <div className="rounded-xl border bg-background p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="font-semibold">
                                Assigned Class
                            </h2>

                            <p className="mt-1 text-sm text-muted-foreground">
                                New class selected for this reschedule.
                            </p>
                        </div>

                        <span className="rounded-full border px-3 py-1 text-xs font-medium uppercase">
                            Scheduled
                        </span>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-4">
                        <div>
                            <p className="text-xs text-muted-foreground">
                                Branch
                            </p>

                            <p className="mt-1 font-medium">
                                {branch?.name ?? "-"}
                            </p>
                        </div>

                        <div>
                            <p className="text-xs text-muted-foreground">
                                Programme
                            </p>

                            <p className="mt-1 font-medium">
                                {programme?.name ?? "-"}
                            </p>
                        </div>

                        <div>
                            <p className="text-xs text-muted-foreground">
                                Date
                            </p>

                            <p className="mt-1 font-medium">
                                {targetClass.class_date}
                            </p>

                            <p className="text-xs text-muted-foreground">
                                W{targetClass.week_number}
                            </p>
                        </div>

                        <div>
                            <p className="text-xs text-muted-foreground">
                                Time
                            </p>

                            <p className="mt-1 font-medium">
                                {targetClass.start_time.slice(0, 5)}
                                {" - "}
                                {targetClass.end_time.slice(0, 5)}
                            </p>
                        </div>
                    </div>

                    {targetBooking && (
                        <div className="mt-5 border-t pt-4">
                            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                <div className="flex flex-wrap gap-6 text-sm">
                                    <div>
                                        <span className="text-muted-foreground">
                                            Booking Type:
                                        </span>{" "}
                                        <span className="font-medium capitalize">
                                            {targetBooking.booking_type}
                                        </span>
                                    </div>

                                    <div>
                                        <span className="text-muted-foreground">
                                            Attendance:
                                        </span>{" "}
                                        <span className="font-medium capitalize">
                                            {targetBooking.attendance_status.replaceAll(
                                                "_",
                                                " "
                                            )}
                                        </span>
                                    </div>
                                </div>

                                {targetBooking.attendance_status ===
                                    "upcoming" && (
                                        <form
                                            action={
                                                reopenRescheduleAssignment
                                            }
                                        >
                                            <input
                                                type="hidden"
                                                name="obligation_id"
                                                value={obligation.id}
                                            />

                                            <button
                                                type="submit"
                                                className="text-sm font-medium underline underline-offset-4"
                                            >
                                                Change Slot
                                            </button>
                                        </form>
                                    )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* DATA INTEGRITY WARNING */}

            {obligation.status === "scheduled" && !targetClass && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
                    <p className="font-medium text-destructive">
                        Assigned class could not be found.
                    </p>

                    <p className="mt-1 text-sm text-muted-foreground">
                        This reschedule is marked as scheduled,
                        but its target booking or class is missing.
                    </p>
                </div>
            )}

            {/* CANDIDATES */}

            {obligation.status === "open" && (
                <div className="space-y-4">
                    <div>
                        <h2 className="text-xl font-semibold">
                            Available Classes
                        </h2>

                        <p className="mt-1 text-sm text-muted-foreground">
                            Showing scheduled classes from
                            locked schedules. Classes where
                            this student already has a booking
                            are excluded.
                        </p>
                    </div>

                    <div className="overflow-hidden rounded-xl border bg-background">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr className="border-b">
                                    <th className="px-5 py-3 text-left">
                                        Date
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Week
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Time
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Regular
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Replacement
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Reschedule
                                    </th>

                                    <th className="px-5 py-3 text-right">
                                        Action
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {availableCandidates.length >
                                    0 ? (
                                    availableCandidates.map(
                                        (session) => (
                                            <tr
                                                key={session.id}
                                                className="border-b last:border-0"
                                            >
                                                <td className="px-5 py-4 font-medium">
                                                    {session.class_date}
                                                </td>

                                                <td className="px-5 py-4">
                                                    W
                                                    {
                                                        session.week_number
                                                    }
                                                </td>

                                                <td className="px-5 py-4">
                                                    {session.start_time.slice(
                                                        0,
                                                        5
                                                    )}
                                                    {" - "}
                                                    {session.end_time.slice(
                                                        0,
                                                        5
                                                    )}
                                                </td>

                                                <td className="px-5 py-4">
                                                    {regularOccupied.get(
                                                        session.id
                                                    ) ?? 0}
                                                    {" / "}
                                                    {session.regular_capacity}
                                                </td>

                                                <td className="px-5 py-4">
                                                    {replacementOccupied.get(
                                                        session.id
                                                    ) ?? 0}
                                                </td>

                                                <td className="px-5 py-4">
                                                    {rescheduleCounts.get(
                                                        session.id
                                                    ) ?? 0}
                                                </td>

                                                <td className="px-5 py-4 text-right">
                                                    {(() => {
                                                        const occupied =
                                                            regularOccupied.get(
                                                                session.id
                                                            ) ?? 0

                                                        const available =
                                                            session.regular_capacity -
                                                            occupied

                                                        if (available <= 0) {
                                                            return (
                                                                <span className="text-xs font-medium text-destructive">
                                                                    Full
                                                                </span>
                                                            )
                                                        }

                                                        return (
                                                            <form action={assignRescheduleSlot}>
                                                                <input
                                                                    type="hidden"
                                                                    name="obligation_id"
                                                                    value={obligation.id}
                                                                />

                                                                <input
                                                                    type="hidden"
                                                                    name="target_session_id"
                                                                    value={session.id}
                                                                />

                                                                <button
                                                                    type="submit"
                                                                    className="font-medium underline underline-offset-4"
                                                                >
                                                                    Assign
                                                                </button>
                                                            </form>
                                                        )
                                                    })()}
                                                </td>
                                            </tr>
                                        )
                                    )
                                ) : (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            className="px-5 py-10 text-center text-muted-foreground"
                                        >
                                            No candidate classes found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>)}
        </div>
    )
}