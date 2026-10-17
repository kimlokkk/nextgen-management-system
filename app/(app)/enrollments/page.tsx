import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { RecordDirectory, type DirectoryRow } from "@/components/record-directory"
import { EnrollmentForm } from "@/components/enrollment-form"

export default async function EnrollmentsPage() {
    const supabase = await createClient()

    // Fetch all reference names, including inactive records, so historical
    // enrollments never display a misleading dash instead of the real name.
    const [studentsResult, branchesResult, programmesResult, sessionsResult, enrollmentsResult] = await Promise.all([
        supabase.from("students").select("id, full_name, status").order("full_name"),
        supabase.from("branches").select("id, name, is_active").order("name"),
        supabase.from("programmes").select("id, name, is_active").order("name"),
        supabase.from("session_templates")
            .select("id, name, branch_id, programme_id, start_time, end_time, is_active")
            .order("start_time"),
        supabase.from("enrollments")
            .select("id, student_id, branch_id, programme_id, default_session_id, frequency_type, start_date, status")
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

    const rows: DirectoryRow[] = (enrollmentsResult.data ?? []).map((enrollment) => {
        const student = studentMap.get(enrollment.student_id) ?? "Student unavailable"
        const branch = branchMap.get(enrollment.branch_id) ?? "Branch unavailable"
        const programme = programmeMap.get(enrollment.programme_id) ?? "Programme unavailable"
        const session = enrollment.default_session_id
            ? (sessionMap.get(enrollment.default_session_id) ?? "Session unavailable")
            : "Not assigned"
        const frequency = enrollment.frequency_type.replaceAll("_", " ")
        return {
            id: enrollment.id,
            title: student,
            subtitle: `${programme} · ${branch}`,
            status: enrollment.status,
            fields: [
                { label: "Regular session", value: session },
                { label: "Frequency", value: frequency },
                { label: "Start date", value: enrollment.start_date ?? "Not recorded" },
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

    return <RecordDirectory
        title="Enrollments"
        description="See current enrollments and assign students to a regular weekly class."
        eyebrow="People"
        rows={rows}
        columns={["Student", "Regular session", "Frequency", "Start date"]}
        createLabel="Add enrollment"
        createForm={ready ? createForm : null}
        emptyTitle="No enrollments yet"
        emptyDescription="Enroll a student into a branch, programme and regular class session."
        searchPlaceholder="Search student or programme"
        prerequisites={!ready
            ? <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                Enrollment requires an active student and an active session, branch and programme.
                <Link href="/students" className="ml-1 font-semibold underline underline-offset-2">
                    Check students
                </Link>
            </p> : undefined}
    />
}
