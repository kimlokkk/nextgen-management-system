import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { RecordDirectory, type DirectoryRow } from "@/components/record-directory"
import { FormSubmit } from "@/components/form-submit"
import { createStudent } from "./actions"

export default async function StudentsPage() {
    const supabase = await createClient()
    const [parentsResult, studentsResult] = await Promise.all([
        supabase.from("parents").select("id, full_name").order("full_name"),
        supabase.from("students").select(`
            id, full_name, date_of_birth, status, laptop_type, notes,
            student_guardians (
                relationship, is_primary,
                parents (full_name, whatsapp_phone)
            )
        `).order("full_name"),
    ])

    if (studentsResult.error || parentsResult.error) {
        return <div className="rounded-xl border bg-card p-6">
            <h1 className="text-2xl font-semibold">Students</h1>
            <p className="mt-3 text-sm text-destructive">
                Could not load student records. {studentsResult.error?.message || parentsResult.error?.message}
            </p>
        </div>
    }

    const parents = parentsResult.data ?? []
    const rows: DirectoryRow[] = (studentsResult.data ?? []).map((student) => {
        const guardian = student.student_guardians?.find((entry) => entry.is_primary)
        const guardianName = guardian?.parents?.[0]?.full_name ?? "Not assigned"
        return {
            id: student.id,
            title: student.full_name,
            status: student.status || "unknown",
            fields: [
                { label: "Primary guardian", value: guardianName },
                { label: "Date of birth", value: student.date_of_birth || "Not recorded" },
                { label: "Laptop", value: student.laptop_type?.replaceAll("_", " ") || "Not specified" },
            ],
            searchText: [student.full_name, guardianName, student.date_of_birth,
                student.laptop_type, student.status, student.notes].filter(Boolean).join(" "),
        }
    })

    const createForm = (
        <form
                    action={createStudent}
                    className="grid gap-4 md:grid-cols-2"
                >
                    <div>
                        <label htmlFor="create-full_name" className="mb-2 block text-sm font-medium">
                            Student Name *
                        </label>

                        <input
                            id="create-full_name"
                            name="full_name"
                            required
                            className="h-10 w-full rounded-lg border bg-background px-3"
                            placeholder="Student full name"
                        />
                    </div>

                    <div>
                        <label htmlFor="create-date_of_birth" className="mb-2 block text-sm font-medium">
                            Date of Birth
                        </label>

                        <input
                            type="date"
                            id="create-date_of_birth"
                            name="date_of_birth"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                        />
                    </div>

                    <div>
                        <label htmlFor="create-parent_id" className="mb-2 block text-sm font-medium">
                            Primary Parent / Guardian *
                        </label>

                        <select
                            id="create-parent_id"
                            name="parent_id"
                            required
                            className="h-10 w-full rounded-lg border bg-background px-3"
                            defaultValue=""
                        >
                            <option value="" disabled>
                                Select parent
                            </option>

                            {parents?.map((parent) => (
                                <option
                                    key={parent.id}
                                    value={parent.id}
                                >
                                    {parent.full_name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="create-relationship" className="mb-2 block text-sm font-medium">
                            Relationship
                        </label>

                        <select
                            id="create-relationship"
                            name="relationship"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                            defaultValue=""
                        >
                            <option value="">
                                Not specified
                            </option>

                            <option value="father">
                                Father
                            </option>

                            <option value="mother">
                                Mother
                            </option>

                            <option value="guardian">
                                Guardian
                            </option>
                        </select>
                    </div>

                    <div>
                        <label htmlFor="create-laptop_type" className="mb-2 block text-sm font-medium">
                            Laptop
                        </label>

                        <select
                            id="create-laptop_type"
                            name="laptop_type"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                            defaultValue=""
                        >
                            <option value="">
                                Not specified
                            </option>

                            <option value="own">
                                Own
                            </option>

                            <option value="academy">
                                Academy
                            </option>
                        </select>
                    </div>

                    <div className="md:col-span-2">
                        <label htmlFor="create-notes" className="mb-2 block text-sm font-medium">
                            Notes
                        </label>

                        <textarea
                            id="create-notes"
                            name="notes"
                            rows={3}
                            className="w-full rounded-lg border bg-background px-3 py-2"
                        />
                    </div>

                    <div className="md:col-span-2">
                        <FormSubmit>Add Student</FormSubmit>
                    </div>
                </form>
    )

    return <RecordDirectory
        title="Students"
        description="Find students, check their guardian details and manage profiles."
        eyebrow="People"
        rows={rows}
        columns={["Student", "Primary guardian", "Date of birth", "Laptop"]}
        createLabel="Add student"
        createForm={createForm}
        emptyTitle="No students yet"
        emptyDescription="Create a student profile after adding their parent or guardian."
        searchPlaceholder="Search student or guardian"
        prerequisites={parents.length === 0
            ? <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                Add a parent first. <Link href="/parents" className="font-semibold underline underline-offset-2">Go to Parents</Link>
            </p>
            : undefined}
    />
}
