import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { QueueOverview, type QueueEntry } from "@/components/queue-overview"

export default async function ReplacementsPage() {
    const supabase = await createClient()

    const { data: obligations, error } = await supabase
        .from("makeup_obligations")
        .select(`
            id,
            student_id,
            source_booking_id,
            target_booking_id,
            status,
            created_at
        `)
        .eq("obligation_type", "replacement")
        .in("status", ["open", "scheduled", "completed", "cancelled"])
        .order("created_at", { ascending: true })

    if (error) {
        return <p className="text-destructive">Unable to load replacements: {error.message}</p>
    }

    const rows = obligations ?? []
    const studentIds = [...new Set(rows.map((item) => item.student_id))]
    const sourceIds = [...new Set(rows.map((item) => item.source_booking_id))]
    const targetIds = [...new Set(rows.map((item) => item.target_booking_id).filter((id): id is string => !!id))]

    const [studentResult, sourceResult, targetResult] = await Promise.all([
        studentIds.length
            ? supabase.from("students").select("id, full_name").in("id", studentIds)
            : Promise.resolve({ data: [], error: null }),
        sourceIds.length
            ? supabase.from("student_bookings").select("id, class_session_id, attendance_status").in("id", sourceIds)
            : Promise.resolve({ data: [], error: null }),
        targetIds.length
            ? supabase.from("student_bookings").select("id, class_session_id").in("id", targetIds)
            : Promise.resolve({ data: [], error: null }),
    ])

    if (studentResult.error || sourceResult.error || targetResult.error) {
        return <p className="text-destructive">Unable to load replacement booking details.</p>
    }

    const students = new Map((studentResult.data ?? []).map((item) => [item.id, item.full_name]))
    const sources = new Map((sourceResult.data ?? []).map((item) => [item.id, item]))
    const targets = new Map((targetResult.data ?? []).map((item) => [item.id, item]))
    const sessionIds = [...new Set([
        ...(sourceResult.data ?? []).map((item) => item.class_session_id),
        ...(targetResult.data ?? []).map((item) => item.class_session_id),
    ])]

    const { data: sessions, error: sessionError } = sessionIds.length
        ? await supabase.from("class_sessions").select(
            "id, class_date, start_time, end_time, branch_id, programme_id"
        ).in("id", sessionIds)
        : { data: [], error: null }

    if (sessionError) {
        return <p className="text-destructive">Unable to load replacement classes.</p>
    }

    const classMap = new Map((sessions ?? []).map((item) => [item.id, item]))
    const branchIds = [...new Set((sessions ?? []).map((item) => item.branch_id))]
    const programmeIds = [...new Set((sessions ?? []).map((item) => item.programme_id))]

    const [branchResult, programmeResult] = await Promise.all([
        branchIds.length
            ? supabase.from("branches").select("id, name").in("id", branchIds)
            : Promise.resolve({ data: [], error: null }),
        programmeIds.length
            ? supabase.from("programmes").select("id, name").in("id", programmeIds)
            : Promise.resolve({ data: [], error: null }),
    ])

    const branches = new Map((branchResult.data ?? []).map((item) => [item.id, item.name]))
    const programmes = new Map((programmeResult.data ?? []).map((item) => [item.id, item.name]))

    return (
        <div className="space-y-6">
            <div>
                <p className="text-sm text-muted-foreground">Scheduling</p>
                <h1 className="mt-1 text-3xl font-bold">Replacement Queue</h1>
                <p className="mt-2 text-muted-foreground">
                    View open, scheduled, completed and cancelled replacements.
                    Assignments may cross months and can precede the original class date.
                </p>
            </div>

            <div className="overflow-x-auto rounded-xl border bg-background">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr className="border-b">
                            <th className="px-5 py-3 text-left">Student</th>
                            <th className="px-5 py-3 text-left">Original Class</th>
                            <th className="px-5 py-3 text-left">Branch / Programme</th>
                            <th className="px-5 py-3 text-left">Absence</th>
                            <th className="px-5 py-3 text-left">Status</th>
                            <th className="px-5 py-3 text-left">Assignment</th>
                            <th className="px-5 py-3 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((item) => {
                            const source = sources.get(item.source_booking_id)
                            const original = source ? classMap.get(source.class_session_id) : null
                            const target = item.target_booking_id ? targets.get(item.target_booking_id) : null
                            const assigned = target ? classMap.get(target.class_session_id) : null

                            const entries: QueueEntry[] = rows.map((item) => {
        const source = sources.get(item.source_booking_id)
        const original = source ? classMap.get(source.class_session_id) : null
        const target = item.target_booking_id ? targets.get(item.target_booking_id) : null
        const assigned = target ? classMap.get(target.class_session_id) : null

        return {
            id: item.id,
            student: students.get(item.student_id) ?? "Student",
            programme: original ? (programmes.get(original.programme_id) ?? "Programme unavailable") : "Programme unavailable",
            branch: original ? (branches.get(original.branch_id) ?? "Branch unavailable") : "Branch unavailable",
            originalDate: original?.class_date ?? "",
            originalTime: original
                ? `${original.start_time.slice(0, 5)}–${original.end_time.slice(0, 5)}`
                : "",
            destination: assigned
                ? `${assigned.class_date} · ${assigned.start_time.slice(0, 5)}–${assigned.end_time.slice(0, 5)}`
                : item.status === "scheduled" || item.status === "completed"
                    ? "Assignment unavailable" : undefined,
            status: item.status,
            attendance: source?.attendance_status === "absent" ? "Confirmed absent" : "Planned",
        }
    })

    return <QueueOverview kind="replacement" entries={entries} />
}
