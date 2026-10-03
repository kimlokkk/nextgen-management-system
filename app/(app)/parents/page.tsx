import { createClient } from "@/lib/supabase/server"
import { createParent } from "./actions"

export default async function ParentsPage() {
    const supabase = await createClient()

    const { data: parents, error } = await supabase
        .from("parents")
        .select(`
      id,
      full_name,
      phone,
      whatsapp_phone,
      email,
      notes,
      created_at
    `)
        .order("full_name")

    if (error) {
        return (
            <div>
                <h1 className="text-3xl font-bold">Parents</h1>
                <p className="mt-4 text-destructive">{error.message}</p>
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
                    Parents
                </h1>

                <p className="mt-2 text-muted-foreground">
                    Manage parent and guardian contact information.
                </p>
            </div>

            <div className="rounded-xl border bg-background p-6">
                <h2 className="text-lg font-semibold">
                    Add Parent
                </h2>

                <form
                    action={createParent}
                    className="mt-5 grid gap-4 md:grid-cols-2"
                >
                    <div>
                        <label className="mb-2 block text-sm font-medium">
                            Full Name *
                        </label>

                        <input
                            name="full_name"
                            required
                            className="h-10 w-full rounded-lg border bg-background px-3"
                            placeholder="Parent / guardian name"
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium">
                            WhatsApp Number
                        </label>

                        <input
                            name="whatsapp_phone"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                            placeholder="e.g. 60123456789"
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium">
                            Phone Number
                        </label>

                        <input
                            name="phone"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium">
                            Email
                        </label>

                        <input
                            type="email"
                            name="email"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                        />
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
                            Add Parent
                        </button>
                    </div>
                </form>
            </div>

            <div className="overflow-hidden rounded-xl border bg-background">
                <div className="border-b px-6 py-4">
                    <h2 className="font-semibold">
                        Parent List
                    </h2>

                    <p className="text-sm text-muted-foreground">
                        {parents?.length ?? 0} records
                    </p>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr className="border-b">
                                <th className="px-6 py-3 text-left">Name</th>
                                <th className="px-6 py-3 text-left">WhatsApp</th>
                                <th className="px-6 py-3 text-left">Phone</th>
                                <th className="px-6 py-3 text-left">Email</th>
                            </tr>
                        </thead>

                        <tbody>
                            {parents?.length ? (
                                parents.map((parent) => (
                                    <tr
                                        key={parent.id}
                                        className="border-b last:border-0"
                                    >
                                        <td className="px-6 py-4 font-medium">
                                            {parent.full_name}
                                        </td>

                                        <td className="px-6 py-4">
                                            {parent.whatsapp_phone || "-"}
                                        </td>

                                        <td className="px-6 py-4">
                                            {parent.phone || "-"}
                                        </td>

                                        <td className="px-6 py-4">
                                            {parent.email || "-"}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td
                                        colSpan={4}
                                        className="px-6 py-10 text-center text-muted-foreground"
                                    >
                                        No parents added yet.
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