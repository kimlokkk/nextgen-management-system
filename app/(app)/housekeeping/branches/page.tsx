import { createClient } from "@/lib/supabase/server"
import { createBranch, toggleBranch } from "./actions"

export default async function BranchesPage() {
    const supabase = await createClient()

    const { data: branches } = await supabase
        .from("branches")
        .select("id, name, code, is_active")
        .order("name")

    return (
        <div className="space-y-8">
            <div>
                <p className="text-sm text-muted-foreground">
                    Housekeeping
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                    Branches
                </h1>

                <p className="mt-2 text-muted-foreground">
                    Manage NextGen branches.
                </p>
            </div>

            <div className="rounded-xl border bg-background p-6">
                <h2 className="font-semibold">
                    Add Branch
                </h2>

                <form
                    action={createBranch}
                    className="mt-5 grid gap-4 md:grid-cols-3"
                >
                    <input
                        name="name"
                        required
                        placeholder="Branch name"
                        className="h-10 rounded-lg border bg-background px-3"
                    />

                    <input
                        name="code"
                        required
                        placeholder="e.g. CYBERJAYA"
                        className="h-10 rounded-lg border bg-background px-3"
                    />

                    <button
                        type="submit"
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    >
                        Add Branch
                    </button>
                </form>
            </div>

            <div className="overflow-hidden rounded-xl border bg-background">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr className="border-b">
                            <th className="px-6 py-3 text-left">Branch</th>
                            <th className="px-6 py-3 text-left">Code</th>
                            <th className="px-6 py-3 text-left">Status</th>
                            <th className="px-6 py-3 text-left">Action</th>
                        </tr>
                    </thead>

                    <tbody>
                        {branches?.map((branch) => (
                            <tr
                                key={branch.id}
                                className="border-b last:border-0"
                            >
                                <td className="px-6 py-4 font-medium">
                                    {branch.name}
                                </td>

                                <td className="px-6 py-4">
                                    {branch.code}
                                </td>

                                <td className="px-6 py-4">
                                    {branch.is_active ? "Active" : "Inactive"}
                                </td>

                                <td className="px-6 py-4">
                                    <form action={toggleBranch}>
                                        <input
                                            type="hidden"
                                            name="id"
                                            value={branch.id}
                                        />

                                        <input
                                            type="hidden"
                                            name="is_active"
                                            value={String(branch.is_active)}
                                        />

                                        <button
                                            type="submit"
                                            className="text-sm underline"
                                        >
                                            {branch.is_active ? "Deactivate" : "Activate"}
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