import { createClient } from "@/lib/supabase/server"
import { createStudent } from "./actions"

export default async function StudentsPage() {
    const supabase = await createClient()

    const { data: parents } = await supabase
        .from("parents")
        .select("id, full_name")
        .order("full_name")

    const { data: students, error } = await supabase
        .from("students")
        .select(`
      id,
      full_name,
      date_of_birth,
      status,
      laptop_type,
      notes,
      student_guardians (
        relationship,
        is_primary,
        parents (
          full_name,
          whatsapp_phone
        )
      )
    `)
        .order("full_name")

    if (error) {
        return (
            <div>
                <h1 className="text-3xl font-bold">
                    Students
                </h1>

                <p className="mt-4 text-destructive">
                    {error.message}
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-8">
            <div>
                <p className="text-sm text-muted-foreground">
                    Student Management
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                    Students
                </h1>

                <p className="mt-2 text-muted-foreground">
                    Manage student profiles and parent relationships.
                </p>
            </div>

            <div className="rounded-xl border bg-background p-6">
                <h2 className="text-lg font-semibold">
                    Add Student
                </h2>

                <form
                    action={createStudent}
                    className="mt-5 grid gap-4 md:grid-cols-2"
                >
                    <div>
                        <label className="mb-2 block text-sm font-medium">
                            Student Name *
                        </label>

                        <input
                            name="full_name"
                            required
                            className="h-10 w-full rounded-lg border bg-background px-3"
                            placeholder="Student full name"
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium">
                            Date of Birth
                        </label>

                        <input
                            type="date"
                            name="date_of_birth"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium">
                            Primary Parent / Guardian *
                        </label>

                        <select
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
                        <label className="mb-2 block text-sm font-medium">
                            Relationship
                        </label>

                        <select
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
                        <label className="mb-2 block text-sm font-medium">
                            Laptop
                        </label>

                        <select
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
                        <label className="mb-2 block text-sm font-medium">
                            Notes
                        </label>

                        <textarea
                            name="notes"
                            rows={3}
                            className="w-full rounded-lg border bg-background px-3 py-2"
                        />
                    </div>

                    <div className="md:col-span-2">
                        <button
                            type="submit"
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                        >
                            Add Student
                        </button>
                    </div>
                </form>
            </div>

            <div className="overflow-hidden rounded-xl border bg-background">
                <div className="border-b px-6 py-4">
                    <h2 className="font-semibold">
                        Student List
                    </h2>

                    <p className="text-sm text-muted-foreground">
                        {students?.length ?? 0} students
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
                                    Parent
                                </th>

                                <th className="px-6 py-3 text-left">
                                    Laptop
                                </th>

                                <th className="px-6 py-3 text-left">
                                    Status
                                </th>
                            </tr>
                        </thead>

                        <tbody>
                            {students?.length ? (
                                students.map((student) => {
                                    const primaryGuardian =
                                        student.student_guardians?.find(
                                            (guardian) => guardian.is_primary
                                        )

                                    return (
                                        <tr
                                            key={student.id}
                                            className="border-b last:border-0"
                                        >
                                            <td className="px-6 py-4">
                                                <div className="font-medium">
                                                    {student.full_name}
                                                </div>

                                                {student.date_of_birth && (
                                                    <div className="text-xs text-muted-foreground">
                                                        DOB: {student.date_of_birth}
                                                    </div>
                                                )}
                                            </td>

                                            <td className="px-6 py-4">
                                                {primaryGuardian?.parents?.[0]?.full_name ?? "-"}
                                            </td>

                                            <td className="px-6 py-4 capitalize">
                                                {student.laptop_type ?? "-"}
                                            </td>

                                            <td className="px-6 py-4 capitalize">
                                                {student.status}
                                            </td>
                                        </tr>
                                    )
                                })
                            ) : (
                                <tr>
                                    <td
                                        colSpan={4}
                                        className="px-6 py-10 text-center text-muted-foreground"
                                    >
                                        No students added yet.
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