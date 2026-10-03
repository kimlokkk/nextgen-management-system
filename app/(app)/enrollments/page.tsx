import { createClient } from "@/lib/supabase/server"
import { createEnrollment } from "./actions"
import { EnrollmentForm } from "@/components/enrollment-form"

export default async function EnrollmentsPage() {
    const supabase = await createClient()

    const { data: students } = await supabase
        .from("students")
        .select("id, full_name")
        .eq("status", "active")
        .order("full_name")

    const { data: branches } = await supabase
        .from("branches")
        .select("id, name")
        .eq("is_active", true)
        .order("name")

    const { data: programmes } = await supabase
        .from("programmes")
        .select("id, name")
        .eq("is_active", true)
        .order("name")

    const { data: sessions } = await supabase
        .from("session_templates")
        .select(`
      id,
      name,
      branch_id,
      programme_id,
      start_time,
      end_time
    `)
        .eq("is_active", true)
        .order("start_time")

    const { data: enrollments } = await supabase
        .from("enrollments")
        .select(`
      id,
      student_id,
      branch_id,
      programme_id,
      default_session_id,
      frequency_type,
      start_date,
      status
    `)
        .order("created_at", { ascending: false })

    const studentMap = new Map(
        students?.map((item) => [item.id, item.full_name]) ?? []
    )

    const branchMap = new Map(
        branches?.map((item) => [item.id, item.name]) ?? []
    )

    const programmeMap = new Map(
        programmes?.map((item) => [item.id, item.name]) ?? []
    )

    const sessionMap = new Map(
        sessions?.map((item) => [item.id, item.name]) ?? []
    )

    return (
        <div className="space-y-8">
            <div>
                <p className="text-sm text-muted-foreground">
                    Student Management
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                    Enrollments
                </h1>

                <p className="mt-2 text-muted-foreground">
                    Assign students to branches, programmes and regular sessions.
                </p>
            </div>

            <div className="rounded-xl border bg-background p-6">
                <h2 className="text-lg font-semibold">
                    Add Enrollment
                </h2>

                <EnrollmentForm
                    students={students ?? []}
                    branches={branches ?? []}
                    programmes={programmes ?? []}
                    sessions={sessions ?? []}
                />
            </div>

            <div className="overflow-hidden rounded-xl border bg-background">
                <div className="border-b px-6 py-4">
                    <h2 className="font-semibold">
                        Enrollment List
                    </h2>

                    <p className="text-sm text-muted-foreground">
                        {enrollments?.length ?? 0} records
                    </p>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr className="border-b">
                                <th className="px-6 py-3 text-left">Student</th>
                                <th className="px-6 py-3 text-left">Branch</th>
                                <th className="px-6 py-3 text-left">Programme</th>
                                <th className="px-6 py-3 text-left">Session</th>
                                <th className="px-6 py-3 text-left">Frequency</th>
                                <th className="px-6 py-3 text-left">Status</th>
                            </tr>
                        </thead>

                        <tbody>
                            {enrollments?.length ? (
                                enrollments.map((enrollment) => (
                                    <tr
                                        key={enrollment.id}
                                        className="border-b last:border-0"
                                    >
                                        <td className="px-6 py-4 font-medium">
                                            {studentMap.get(enrollment.student_id) ?? "-"}
                                        </td>

                                        <td className="px-6 py-4">
                                            {branchMap.get(enrollment.branch_id) ?? "-"}
                                        </td>

                                        <td className="px-6 py-4">
                                            {programmeMap.get(enrollment.programme_id) ?? "-"}
                                        </td>

                                        <td className="px-6 py-4">
                                            {enrollment.default_session_id
                                                ? sessionMap.get(enrollment.default_session_id) ?? "-"
                                                : "-"}
                                        </td>

                                        <td className="px-6 py-4 capitalize">
                                            {enrollment.frequency_type.replaceAll("_", " ")}
                                        </td>

                                        <td className="px-6 py-4 capitalize">
                                            {enrollment.status}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td
                                        colSpan={6}
                                        className="px-6 py-10 text-center text-muted-foreground"
                                    >
                                        No enrollments added yet.
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