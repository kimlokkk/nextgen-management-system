import { createClient } from "@/lib/supabase/server"
import { RecordDirectory, type DirectoryRow } from "@/components/record-directory"
import { FormSubmit } from "@/components/form-submit"
import { createParent } from "./actions"

export default async function ParentsPage() {
    const supabase = await createClient()
    const { data: parents, error } = await supabase.from("parents")
        .select("id, full_name, phone, whatsapp_phone, email, notes, created_at")
        .order("full_name")

    if (error) {
        return <div className="rounded-xl border bg-card p-6">
            <h1 className="text-2xl font-semibold">Parents</h1>
            <p className="mt-3 text-sm text-destructive">Could not load parents. {error.message}</p>
        </div>
    }

    const rows: DirectoryRow[] = (parents ?? []).map((parent) => ({
        id: parent.id,
        title: parent.full_name,
        fields: [
            { label: "WhatsApp", value: parent.whatsapp_phone || "—" },
            { label: "Phone", value: parent.phone || "—" },
            { label: "Email", value: parent.email || "—" },
        ],
        searchText: [parent.full_name, parent.whatsapp_phone, parent.phone, parent.email, parent.notes]
            .filter(Boolean).join(" "),
    }))

    const createForm = (
        <form
                    action={createParent}
                    className="grid gap-4 md:grid-cols-2"
                >
                    <div>
                        <label htmlFor="create-full_name" className="mb-2 block text-sm font-medium">
                            Full Name *
                        </label>

                        <input
                            id="create-full_name"
                            name="full_name"
                            required
                            className="h-10 w-full rounded-lg border bg-background px-3"
                            placeholder="Parent / guardian name"
                        />
                    </div>

                    <div>
                        <label htmlFor="create-whatsapp_phone" className="mb-2 block text-sm font-medium">
                            WhatsApp Number
                        </label>

                        <input
                            id="create-whatsapp_phone"
                            name="whatsapp_phone"
                            inputMode="tel"
                            autoComplete="tel"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                            placeholder="e.g. 60123456789"
                        />
                    </div>

                    <div>
                        <label htmlFor="create-phone" className="mb-2 block text-sm font-medium">
                            Phone Number
                        </label>

                        <input
                            id="create-phone"
                            name="phone"
                            inputMode="tel"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                        />
                    </div>

                    <div>
                        <label htmlFor="create-email" className="mb-2 block text-sm font-medium">
                            Email
                        </label>

                        <input
                            type="email"
                            id="create-email"
                            name="email"
                            autoComplete="email"
                            className="h-10 w-full rounded-lg border bg-background px-3"
                        />
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
                        <FormSubmit>Add Parent</FormSubmit>
                    </div>
                </form>
    )

    return <RecordDirectory
        title="Parents"
        description="Keep guardian contact details organised and easy to find."
        eyebrow="People"
        rows={rows}
        columns={["Parent", "WhatsApp", "Phone", "Email"]}
        createLabel="Add parent"
        createForm={createForm}
        emptyTitle="No parents yet"
        emptyDescription="Add a parent or guardian before creating a student profile."
        searchPlaceholder="Search name, phone or email"
    />
}
