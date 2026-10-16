import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { countsTowardsReplacementCapacity } from "@/lib/reschedule-policy"
import { assignReplacementSlot } from "./actions"

type PageProps = {
    params: Promise<{ id: string }>
}

type ClassBooking = {
    class_session_id: string
    student_id: string
    booking_type: string
    attendance_status: string
}

function malaysiaNow() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kuala_Lumpur",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date())

    const value = (key: string) =>
        parts.find((part) => part.type === key)?.value ?? "00"

    return {
        date: `${value("year")}-${value("month")}-${value("day")}`,
        time: `${value("hour")}:${value("minute")}:${value("second")}`,
    }
}

function weekday(date: string) {
    return new Date(`${date}T00:00:00Z`).getUTCDay()
}

function overlaps(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
    return firstStart < secondEnd && secondStart < firstEnd
}

export default async function ReplacementDetailPage({ params }: PageProps) {
    const { id } = await params
    const supabase = await createClient()

    const { data: obligation, error: obligationError } = await supabase
        .from("makeup_obligations")
        .select(`
            id, student_id, enrollment_id, source_booking_id,
            target_booking_id, obligation_type, status, reason
        `)
        .eq("id", id)
        .eq("obligation_type", "replacement")
        .single()

    if (obligationError || !obligation) {
        notFound()
    }

    const [studentResult, sourceResult] = await Promise.all([
        supabase.from("students").select("id, full_name, status")
            .eq("id", obligation.student_id).single(),
        supabase.from("student_bookings")
            .select("id, class_session_id, booking_type, attendance_status")
            .eq("id", obligation.source_booking_id).single(),
    ])

    const student = studentResult.data
    const source = sourceResult.data
    if (!source || !student) {
        notFound()
    }

    const { data: original } = await supabase
        .from("class_sessions")
        .select(`
            id, branch_id, programme_id, session_template_id,
            class_date, start_time, end_time, status
        `)
        .eq("id", source.class_session_id)
        .single()

    if (!original) {
        notFound()
    }

    const [branchResult, programmeResult, targetBookingResult] = await Promise.all([
        supabase.from("branches").select("name").eq("id", original.branch_id).single(),
        supabase.from("programmes").select("name").eq("id", original.programme_id).single(),
        obligation.target_booking_id
            ? supabase.from("student_bookings")
                .select("id, class_session_id, booking_type, attendance_status")
                .eq("id", obligation.target_booking_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ])

    const targetBooking = targetBookingResult.data
    const { data: targetClass } = targetBooking
        ? await supabase.from("class_sessions")
            .select("id, class_date, start_time, end_time, status")
            .eq("id", targetBooking.class_session_id)
            .maybeSingle()
        : { data: null }

    const now = malaysiaNow()
    const open = obligation.status === "open" && !obligation.target_booking_id
    let candidates: Array<{
        id: string
        class_date: string
        start_time: string
        end_time: string
        week_number: number
        replacement_capacity: number
        occupied: number
    }> = []

    if (open) {
        const { data: batches, error: batchesError } = await supabase
            .from("schedule_batches")
            .select("id")
            .eq("branch_id", original.branch_id)
            .eq("status", "locked")

        if (batchesError) {
            throw new Error(batchesError.message)
        }

        const batchIds = (batches ?? []).map((batch) => batch.id)

        const { data: sessions, error: sessionsError } = batchIds.length
            ? await supabase
                .from("class_sessions")
                .select(`
                    id, class_date, start_time, end_time, week_number,
                    session_template_id, replacement_capacity
                `)
                .in("schedule_batch_id", batchIds)
                .eq("branch_id", original.branch_id)
                .eq("programme_id", original.programme_id)
                .eq("status", "scheduled")
                .gte("class_date", now.date)
                .order("class_date", { ascending: true })
                .order("start_time", { ascending: true })
                .limit(300)
            : { data: [], error: null }

        if (sessionsError) {
            throw new Error(sessionsError.message)
        }

        const sessionRows = sessions ?? []
        const sessionIds = sessionRows.map((session) => session.id)

        // Paginate instead of trusting the PostgREST default maximum row count.
        const allBookings: ClassBooking[] = []
        if (sessionIds.length) {
            for (let offset = 0; ; offset += 1000) {
                const { data, error } = await supabase
                    .from("student_bookings")
                    .select("class_session_id, student_id, booking_type, attendance_status")
                    .in("class_session_id", sessionIds)
                    .order("class_session_id")
                    .order("id")
                    .range(offset, offset + 999)

                if (error) {
                    throw new Error(error.message)
                }

                const batch = (data ?? []) as ClassBooking[]
                allBookings.push(...batch)

                if (batch.length < 1000) break
            }
        }

        // Check the student's bookings across all programmes/branches.
        const { data: studentBookings, error: studentBookingsError } =
            await supabase.from("student_bookings")
                .select("class_session_id, attendance_status")
                .eq("student_id", obligation.student_id)

        if (studentBookingsError) {
            throw new Error(studentBookingsError.message)
        }

        const studentSessionIds = [...new Set((studentBookings ?? [])
            .filter((booking) =>
                !["rescheduled", "cancelled", "not_scheduled"].includes(booking.attendance_status)
            )
            .map((booking) => booking.class_session_id))]

        const { data: bookedClasses, error: bookedClassError } = studentSessionIds.length
            ? await supabase.from("class_sessions")
                .select("id, class_date, start_time, end_time")
                .in("id", studentSessionIds)
            : { data: [], error: null }

        if (bookedClassError) {
            throw new Error(bookedClassError.message)
        }

        const existingCandidateIds = new Set(
            allBookings.filter((booking) => booking.student_id === obligation.student_id)
                .map((booking) => booking.class_session_id)
        )

        const { data: regularEnrollments, error: enrollmentError } = await supabase
            .from("enrollments")
            .select("default_session_id")
            .eq("student_id", obligation.student_id)
            .eq("branch_id", original.branch_id)
            .eq("programme_id", original.programme_id)
            .in("status", ["active", "paused"])

        if (enrollmentError) {
            throw new Error(enrollmentError.message)
        }

        const regularTemplateIds = [...new Set((regularEnrollments ?? [])
            .map((row) => row.default_session_id)
            .filter((value): value is string => !!value))]

        const { data: regularTemplates, error: templateError } = regularTemplateIds.length
            ? await supabase.from("session_templates")
                .select("id, day_of_week, start_time, end_time")
                .in("id", regularTemplateIds)
            : { data: [], error: null }

        if (templateError) {
            throw new Error(templateError.message)
        }

        candidates = sessionRows.flatMap((session) => {
            if (
                session.id === original.id ||
                session.session_template_id === original.session_template_id ||
                (session.class_date === now.date && session.start_time <= now.time) ||
                session.replacement_capacity <= 0 ||
                existingCandidateIds.has(session.id)
            ) return []

            const targetDay = weekday(session.class_date)
            if (
                targetDay === weekday(original.class_date) &&
                overlaps(session.start_time, session.end_time, original.start_time, original.end_time)
            ) return []

            const isOwnRegularTime = (regularTemplates ?? []).some((template) =>
                template.day_of_week === targetDay &&
                overlaps(session.start_time, session.end_time, template.start_time, template.end_time)
            )

            if (isOwnRegularTime) return []

            const clashes = (bookedClasses ?? []).some((booked) =>
                booked.class_date === session.class_date &&
                overlaps(session.start_time, session.end_time, booked.start_time, booked.end_time)
            )

            if (clashes) return []

            const occupied = allBookings.filter((booking) =>
                booking.class_session_id === session.id &&
                countsTowardsReplacementCapacity(booking)
            ).length

            if (occupied >= session.replacement_capacity) return []

            return [{
                id: session.id,
                class_date: session.class_date,
                start_time: session.start_time,
                end_time: session.end_time,
                week_number: session.week_number,
                replacement_capacity: session.replacement_capacity,
                occupied,
            }]
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <Link href="/replacements" className="text-sm text-muted-foreground hover:underline">
                    ← Back to replacement queue
                </Link>
                <p className="mt-5 text-sm text-muted-foreground">Replacement Details</p>
                <h1 className="mt-1 text-3xl font-bold">{student.full_name}</h1>
                <p className="mt-2 text-muted-foreground">
                    {branchResult.data?.name ?? "-"} · {programmeResult.data?.name ?? "-"}
                </p>
                <span className="mt-3 inline-block rounded-full border px-3 py-1 text-xs font-medium uppercase">
                    {obligation.status}
                </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border bg-background p-5">
                    <h2 className="font-semibold">Original Class</h2>
                    <p className="mt-2">{original.class_date} · {original.start_time.slice(0, 5)} - {original.end_time.slice(0, 5)}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Attendance: {source.attendance_status === "absent" ? "Confirmed absent" : source.attendance_status === "upcoming" ? "Planned absence" : source.attendance_status}
                    </p>
                </div>
                <div className="rounded-xl border bg-background p-5">
                    <h2 className="font-semibold">Assigned Replacement</h2>
                    {targetClass && targetBooking ? (
                        <>
                            <p className="mt-2">
                                {targetClass.class_date} · {targetClass.start_time.slice(0, 5)} - {targetClass.end_time.slice(0, 5)}
                            </p>
                            <p className="mt-2 text-sm text-muted-foreground">
                                Yellow slot · {targetBooking.attendance_status}
                            </p>
                            <Link href={`/schedule/sessions/${targetClass.id}`}
                                className="mt-3 inline-block text-sm font-medium underline underline-offset-4">
                                View assigned class
                            </Link>
                        </>
                    ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                            {obligation.status === "scheduled" ? "Warning: Assigned booking could not be found." : "Not assigned yet."}
                        </p>
                    )}
                </div>
            </div>

            {open && (
                <div className="space-y-4">
                    <div>
                        <h2 className="text-xl font-semibold">Available Yellow Slots</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Locked future classes only. Regular seats cannot be used. We also exclude
                            the student&apos;s own weekly class time and overlapping bookings.
                            The database rechecks eligibility when assigning.
                        </p>
                    </div>

                    <div className="overflow-x-auto rounded-xl border bg-background">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr className="border-b">
                                    <th className="px-5 py-3 text-left">Date</th>
                                    <th className="px-5 py-3 text-left">Week</th>
                                    <th className="px-5 py-3 text-left">Time</th>
                                    <th className="px-5 py-3 text-left">Yellow Capacity</th>
                                    <th className="px-5 py-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {candidates.map((session) => (
                                    <tr key={session.id} className="border-b last:border-0">
                                        <td className="px-5 py-4">{session.class_date}</td>
                                        <td className="px-5 py-4">W{session.week_number}</td>
                                        <td className="px-5 py-4">{session.start_time.slice(0, 5)} - {session.end_time.slice(0, 5)}</td>
                                        <td className="px-5 py-4">
                                            {session.occupied} / {session.replacement_capacity}
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            <form action={assignReplacementSlot}>
                                                <input type="hidden" name="obligation_id" value={obligation.id} />
                                                <input type="hidden" name="target_session_id" value={session.id} />
                                                <button type="submit" className="font-medium underline underline-offset-4">
                                                    Assign Yellow Slot
                                                </button>
                                            </form>
                                        </td>
                                    </tr>
                                ))}
                                {candidates.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">
                                            No available yellow slots in the current locked schedules.
                                            Generate and lock another month&apos;s schedule to find more choices.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {obligation.status === "scheduled" && (
                <p className="text-sm text-muted-foreground">
                    Assigned replacements are read-only in Phase 2.
                    Change Slot / Cancel will be handled as a separate safe workflow.
                </p>
            )}
        </div>
    )
}
