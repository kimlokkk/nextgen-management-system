import { createClient } from "@/lib/supabase/server"
import { createProgramme, toggleProgramme } from "./actions"

export default async function ProgrammesPage() {
    const supabase = await createClient()

    const { data: programmes } = await supabase
        .from("programmes")
        .select("id, name, code, is_active")
        .order("name")

    return (
        <div className="space-y-8">
            <div>
                <p className="text-sm text-muted-foreground">
                    Housekeeping
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                    Programmes
                </h1>

                <p className="mt-2 text-muted-foreground">
                    Manage NextGen programmes.
                </p>
            </div>

            <div className="rounded-xl border bg-background p-6">
                <h2 className="font-semibold">
                    Add Programme
                </h2>

                <form
                    action={createProgramme}
                    className="mt-5 grid gap-4 md:grid-cols-3"
                >
                    <input
                        name="name"
                        required
                        placeholder="Programme name"
                        className="h-10 rounded-lg border bg-background px-3"
                    />

                    <input
                        name="code"
                        required
                        placeholder="e.g. YOUNG_CODER"
                        className="h-10 rounded-lg border bg-background px-3"
                    />

                    <button
                        type="submit"
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    >
                        Add Programme
                    </button>
                </form>
            </div>

            <div className="overflow-hidden rounded-xl border bg-background">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr className="border-b">
                            <th className="px-6 py-3 text-left">Programme</th>
                            <th className="px-6 py-3 text-left">Code</th>
                            <th className="px-6 py-3 text-left">Status</th>
                            <th className="px-6 py-3 text-left">Action</th>
                        </tr>
                    </thead>

                    <tbody>
                        {programmes?.map((programme) => (
                            <tr
                                key={programme.id}
                                className="border-b last:border-0"
                            >
                                <td className="px-6 py-4 font-medium">
                                    {programme.name}
                                </td>

                                <td className="px-6 py-4">
                                    {programme.code}
                                </td>

                                <td className="px-6 py-4">
                                    {programme.is_active ? "Active" : "Inactive"}
                                </td>

                                <td className="px-6 py-4">
                                    <form action={toggleProgramme}>
                                        <input
                                            type="hidden"
                                            name="id"
                                            value={programme.id}
                                        />

                                        <input
                                            type="hidden"
                                            name="is_active"
                                            value={String(programme.is_active)}
                                        />

                                        <button
                                            type="submit"
                                            className="text-sm underline"
                                        >
                                            {programme.is_active
                                                ? "Deactivate"
                                                : "Activate"}
                                        </button>
                                    </form>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}