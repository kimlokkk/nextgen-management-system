import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { QueueOverview, type QueueEntry } from "@/components/queue-overview"

export default async function ReschedulesPage() {
    const supabase = await createClient()

    // =====================================================
    // OBLIGATIONS
    // =====================================================

    const { data: obligations, error } = await supabase
        .from("makeup_obligations")
        .select(`
      id,
      student_id,
      enrollment_id,
      source_booking_id,
      target_booking_id,
      obligation_type,
      status,
      reason,
      created_at
    `)
        .eq("obligation_type", "reschedule")
        .in("status", ["open", "scheduled", "completed", "cancelled"])
        .order("created_at", {
            ascending: true,
        })

    if (error) {
        return (
            <p className="text-destructive">
                {error.message}
            </p>
        )
    }

    const rows = obligations ?? []

    // =====================================================
    // STUDENTS
    // =====================================================

    const studentIds = [
        ...new Set(
            rows.map(
                (obligation) => obligation.student_id
            )
        ),
    ]

    const { data: students } =
        studentIds.length > 0
            ? await supabase
                .from("students")
                .select(`
            id,
            full_name
          `)
                .in("id", studentIds)
            : { data: [] }

    const studentMap = new Map(
        students?.map((student) => [
            student.id,
            student,
        ]) ?? []
    )

    // =====================================================
    // SOURCE BOOKINGS
    // =====================================================

    const sourceBookingIds = rows.map(
        (obligation) =>
            obligation.source_booking_id
    )

    const { data: sourceBookings } =
        sourceBookingIds.length > 0
            ? await supabase
                .from("student_bookings")
                .select(`
            id,
            class_session_id
          `)
                .in("id", sourceBookingIds)
            : { data: [] }

    const sourceBookingMap = new Map(
        sourceBookings?.map((booking) => [
            booking.id,
            booking,
        ]) ?? []
    )

    // =====================================================
    // ORIGINAL CLASS SESSIONS
    // =====================================================

    const classSessionIds = [
        ...new Set(
            sourceBookings?.map(
                (booking) =>
                    booking.class_session_id
            ) ?? []
        ),
    ]

    const { data: classSessions } =
        classSessionIds.length > 0
            ? await supabase
                .from("class_sessions")
                .select(`
            id,
            branch_id,
            programme_id,
            class_date,
            week_number,
            start_time,
            end_time
          `)
                .in("id", classSessionIds)
            : { data: [] }

    const classSessionMap = new Map(
        classSessions?.map((session) => [
            session.id,
            session,
        ]) ?? []
    )

    // =====================================================
    // BRANCH + PROGRAMME
    // =====================================================

    const branchIds = [
        ...new Set(
            classSessions?.map(
                (session) => session.branch_id
            ) ?? []
        ),
    ]

    const programmeIds = [
        ...new Set(
            classSessions?.map(
                (session) => session.programme_id
            ) ?? []
        ),
    ]

    const { data: branches } =
        branchIds.length > 0
            ? await supabase
                .from("branches")
                .select("id, name")
                .in("id", branchIds)
            : { data: [] }

    const { data: programmes } =
        programmeIds.length > 0
            ? await supabase
                .from("programmes")
                .select("id, name")
                .in("id", programmeIds)
            : { data: [] }

    const branchMap = new Map(
        branches?.map((branch) => [
            branch.id,
            branch.name,
        ]) ?? []
    )

    const programmeMap = new Map(
        programmes?.map((programme) => [
            programme.id,
            programme.name,
        ]) ?? []
    )

    // =====================================================
    // PAGE
    // =====================================================

    const targetBookingIds = rows
        .map((item) => item.target_booking_id)
        .filter((id): id is string => !!id)

    const { data: targetBookings, error: targetError } = targetBookingIds.length
        ? await supabase.from("student_bookings")
            .select("id, class_session_id")
            .in("id", targetBookingIds)
        : { data: [], error: null }

    if (targetError) {
        return <p className="text-destructive">Could not load assigned classes.</p>
    }

    const targetSessionIds = [...new Set((targetBookings ?? []).map((item) => item.class_session_id))]
    const { data: targetSessions, error: sessionError } = targetSessionIds.length
        ? await supabase.from("class_sessions")
            .select("id, class_date, start_time, end_time")
            .in("id", targetSessionIds)
        : { data: [], error: null }

    if (sessionError) {
        return <p className="text-destructive">Could not load reschedule assignments.</p>
    }

    const targetMap = new Map((targetBookings ?? []).map((item) => [item.id, item.class_session_id]))
    const targetSessionMap = new Map((targetSessions ?? []).map((item) => [item.id, item]))

    const entries: QueueEntry[] = rows.map((obligation) => {
        const source = sourceBookingMap.get(obligation.source_booking_id)
        const original = source ? classSessionMap.get(source.class_session_id) : null
        const targetSessionId = obligation.target_booking_id
            ? targetMap.get(obligation.target_booking_id) : null
        const target = targetSessionId ? targetSessionMap.get(targetSessionId) : null

        return {
            id: obligation.id,
            student: studentMap.get(obligation.student_id)?.full_name ?? "Student",
            programme: original ? (programmeMap.get(original.programme_id) ?? "Programme unavailable") : "Programme unavailable",
            branch: original ? (branchMap.get(original.branch_id) ?? "Branch unavailable") : "Branch unavailable",
            originalDate: original?.class_date ?? "",
            originalTime: original ? `${original.start_time.slice(0, 5)}–${original.end_time.slice(0, 5)}` : "",
            destination: target
                ? `${target.class_date} · ${target.start_time.slice(0, 5)}–${target.end_time.slice(0, 5)}`
                : obligation.status === "scheduled" || obligation.status === "completed"
                    ? "Assignment unavailable" : undefined,
            status: obligation.status,
        }
    })

    return <QueueOverview kind="reschedule" entries={entries} />
}
