import Link from "next/link"
import { createClient } from "@/lib/supabase/server"

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
      obligation_type,
      status,
      reason,
      created_at
    `)
        .eq("obligation_type", "reschedule")
        .in("status", ["open", "scheduled"])
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

    return (
        <div className="space-y-8">
            <div>
                <p className="text-sm text-muted-foreground">
                    Scheduling
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                    Reschedule Queue
                </h1>

                <p className="mt-2 text-muted-foreground">
                    Students waiting for a new class slot.
                </p>
            </div>

            <div className="overflow-hidden rounded-xl border bg-background">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr className="border-b">
                            <th className="px-5 py-3 text-left">
                                Student
                            </th>

                            <th className="px-5 py-3 text-left">
                                Original Class
                            </th>

                            <th className="px-5 py-3 text-left">
                                Programme
                            </th>

                            <th className="px-5 py-3 text-left">
                                Branch
                            </th>

                            <th className="px-5 py-3 text-left">
                                Status
                            </th>

                            <th className="px-5 py-3 text-right">
                                Action
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        {rows.length > 0 ? (
                            rows.map((obligation) => {
                                const student =
                                    studentMap.get(
                                        obligation.student_id
                                    )

                                const sourceBooking =
                                    sourceBookingMap.get(
                                        obligation.source_booking_id
                                    )

                                const classSession =
                                    sourceBooking
                                        ? classSessionMap.get(
                                            sourceBooking.class_session_id
                                        )
                                        : null

                                return (
                                    <tr
                                        key={obligation.id}
                                        className="border-b last:border-0"
                                    >
                                        <td className="px-5 py-4 font-medium">
                                            {student?.full_name ?? "-"}
                                        </td>

                                        <td className="px-5 py-4">
                                            {classSession ? (
                                                <>
                                                    <div className="font-medium">
                                                        {classSession.class_date}
                                                    </div>

                                                    <div className="text-xs text-muted-foreground">
                                                        W
                                                        {
                                                            classSession.week_number
                                                        }
                                                        {" · "}
                                                        {classSession.start_time.slice(
                                                            0,
                                                            5
                                                        )}
                                                        {" - "}
                                                        {classSession.end_time.slice(
                                                            0,
                                                            5
                                                        )}
                                                    </div>
                                                </>
                                            ) : (
                                                "-"
                                            )}
                                        </td>

                                        <td className="px-5 py-4">
                                            {classSession
                                                ? programmeMap.get(
                                                    classSession.programme_id
                                                ) ?? "-"
                                                : "-"}
                                        </td>

                                        <td className="px-5 py-4">
                                            {classSession
                                                ? branchMap.get(
                                                    classSession.branch_id
                                                ) ?? "-"
                                                : "-"}
                                        </td>

                                        <td className="px-5 py-4">
                                            <span className="rounded-full border px-3 py-1 text-xs font-medium uppercase">
                                                {obligation.status}
                                            </span>
                                        </td>

                                        <td className="px-5 py-4 text-right">
                                            {obligation.status ===
                                                "open" ? (
                                                <Link
                                                    href={`/reschedules/${obligation.id}`}
                                                    className="font-medium underline underline-offset-4"
                                                >
                                                    Find New Slot
                                                </Link>
                                            ) : (
                                                <Link
                                                    href={`/reschedules/${obligation.id}`}
                                                    className="font-medium underline underline-offset-4"
                                                >
                                                    View
                                                </Link>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })
                        ) : (
                            <tr>
                                <td
                                    colSpan={6}
                                    className="px-5 py-10 text-center text-muted-foreground"
                                >
                                    No open reschedules.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}