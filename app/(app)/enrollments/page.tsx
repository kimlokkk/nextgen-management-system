import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { RecordDirectory, type DirectoryRow } from "@/components/record-directory"
import { EnrollmentForm } from "@/components/enrollment-form"
import { EnrollmentRowActions, type RowActionProps, type SlotOption } from "@/components/enrollment-row-actions"

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const SAVED: Record<string, string> = {
    added: "Enrollment added.",
    changed: "Change saved.",
    paused: "Enrollment paused.",
    resumed: "Enrollment resumed.",
    stopped: "Enrollment stopped.",
}

// First day of next month in Malaysia: the usual date for a change to start.
function nextMonthStart() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit" })
        .formatToParts(new Date())
    const year = Number(parts.find((part) => part.type === "year")?.value)
    const month = Number(parts.find((part) => part.type === "month")?.value)
    const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
    return `${next.year}-${String(next.month).padStart(2, "0")}-01`
}

type PageProps = { searchParams: Promise<{ saved?: string; later?: string }> }

export default async function EnrollmentsPage({ searchParams }: PageProps) {
    const { saved, later } = await searchParams
    const supabase = await createClient()

    // Fetch all reference names, including inactive records, so historical
    // enrollments never display a misleading dash instead of the real name.
    const [studentsResult, branchesResult, programmesResult, sessionsResult, enrollmentsResult] = await Promise.all([
        supabase.from("students").select("id, full_name, status").order("full_name"),
        supabase.from("branches").select("id, name, is_active").order("name"),
        supabase.from("programmes").select("id, name, is_active").order("name"),
        supabase.from("session_templates")
            .select("id, name, branch_id, programme_id, day_of_week, start_time, end_time, regular_capacity, is_active")
            .order("start_time"),
        supabase.from("enrollments")
            .select("id, student_id, branch_id, programme_id, default_session_id, frequency_type, preferred_weeks, start_date, end_date, status")
            .order("created_at", { ascending: false }),
    ])

    const error = [studentsResult.error, branchesResult.error, programmesResult.error,
        sessionsResult.error, enrollmentsResult.error].find(Boolean)
    if (error) {
        return <div className="rounded-xl border bg-card p-6">
            <h1 className="text-2xl font-semibold">Enrollments</h1>
            <p className="mt-3 text-sm text-destructive">Could not load enrollments. {error.message}</p>
        </div>
    }

    const students = studentsResult.data ?? []
    const branches = branchesResult.data ?? []
    const programmes = programmesResult.data ?? []
    const sessions = sessionsResult.data ?? []
    const studentMap = new Map(students.map((item) => [item.id, item.full_name]))
    const branchMap = new Map(branches.map((item) => [item.id, item.name]))
    const programmeMap = new Map(programmes.map((item) => [item.id, item.name]))
    const sessionMap = new Map(sessions.map((item) => [item.id, item.name]))

    const enrolledBySession = new Map<string, number>()
    for (const enrollment of enrollmentsResult.data ?? []) {
        if (enrollment.status === "active" && enrollment.default_session_id) {
            enrolledBySession.set(enrollment.default_session_id, (enrolledBySession.get(enrollment.default_session_id) ?? 0) + 1)
        }
    }
    const slotLabel = (session: typeof sessions[number]) =>
        `${DAYS[session.day_of_week] ?? "Day"} ${session.start_time.slice(0, 5)}–${session.end_time.slice(0, 5)} · ${programmeMap.get(session.programme_id) ?? "Programme"}`
    const slotsByBranch = new Map<string, SlotOption[]>()
    for (const session of sessions.filter((item) => item.is_active)) {
        const list = slotsByBranch.get(session.branch_id) ?? []
        list.push({
            id: session.id,
            label: slotLabel(session),
            enrolled: enrolledBySession.get(session.id) ?? 0,
            capacity: session.regular_capacity,
        })
        slotsByBranch.set(session.branch_id, list)
    }
    const defaultFrom = nextMonthStart()

    const rowActionProps: Record<string, RowActionProps> = {}
    const rows: DirectoryRow[] = (enrollmentsResult.data ?? []).map((enrollment) => {
        const student = studentMap.get(enrollment.student_id) ?? "Student unavailable"
        const branch = branchMap.get(enrollment.branch_id) ?? "Branch unavailable"
        const programme = programmeMap.get(enrollment.programme_id) ?? "Programme unavailable"
        const session = enrollment.default_session_id
            ? (sessionMap.get(enrollment.default_session_id) ?? "Session unavailable")
            : "Not assigned"
        const weeks = (enrollment.preferred_weeks ?? []) as number[]
        const frequency = enrollment.frequency_type.replaceAll("_", " ")
            + (weeks.length ? ` (weeks ${weeks.join(", ")})` : "")
        rowActionProps[enrollment.id] = {
            enrollmentId: enrollment.id,
            status: enrollment.status,
            sessionId: enrollment.default_session_id,
            frequency: enrollment.frequency_type,
            weeks: weeks,
            startDate: enrollment.start_date,
            endDate: enrollment.end_date,
            slots: slotsByBranch.get(enrollment.branch_id) ?? [],
            defaultFrom: defaultFrom,
        }
        return {
            id: enrollment.id,
            title: student,
            subtitle: `${programme} · ${branch}`,
            status: enrollment.status,
            fields: [
                { label: "Regular session", value: session },
                { label: "Frequency", value: frequency },
                { label: "Start date", value: enrollment.start_date ?? "Not recorded" },
                { label: "Last class date", value: enrollment.end_date ?? "—" },
            ],

            searchText: [student, branch, programme, session, frequency, enrollment.start_date, enrollment.status]
                .filter(Boolean).join(" "),
        }
    })

    const activeStudents = students.filter((item) => item.status === "active")
    const activeBranches = branches.filter((item) => item.is_active)
    const activeProgrammes = programmes.filter((item) => item.is_active)
    const activeSessions = sessions.filter((item) => item.is_active)
    const ready = activeStudents.length > 0 && activeBranches.length > 0
        && activeProgrammes.length > 0 && activeSessions.length > 0

    const createForm = <EnrollmentForm
        students={activeStudents}
        branches={activeBranches}
        programmes={activeProgrammes}
        sessions={activeSessions}
    />

    const notice = saved && SAVED[saved] ? <p role="status" className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
        {SAVED[saved]}
        {saved === "changed" && Number(later) > 0
            ? ` ${later} booking(s) on or after the start date in schedules already generated still follow the old class. Use the schedule page to move those students.`
            : saved === "changed" ? " Schedules already generated are not changed." : ""}
    </p> : null

    return <RecordDirectory
        title="Enrollments"
        description="See current enrollments, assign students to a regular class, and change a class, how often, or pause and stop."
        eyebrow="People"
        rows={rows}
        columns={["Student", "Regular session", "Frequency", "Start date", "Last class date"]}
        createLabel="Add enrollment"
        createForm={ready ? createForm : null}
        emptyTitle="No enrollments yet"
        emptyDescription="Enroll a student into a branch, programme and regular class session."
        searchPlaceholder="Search student or programme"
        notice={notice}
        RowActions={EnrollmentRowActions}
        rowActionProps={rowActionProps}
        prerequisites={!ready
            ? <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                Enrollment requires an active student and an active session, branch and programme.
                <Link href="/students" className="ml-1 font-semibold underline underline-offset-2">
                    Check students
                </Link>
            </p> : undefined}
    />
}
