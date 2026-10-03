import { createClient } from "@/lib/supabase/server"
import { updateSessionCapacity } from "./actions"

const dayNames: Record<number, string> = {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
}

export default async function SessionSetupPage() {
    const supabase = await createClient()

    const { data: sessions, error } = await supabase
        .from("session_templates")
        .select(`
    id,
    branch_id,
    programme_id,
    name,
    day_of_week,
    start_time,
    end_time,
    regular_capacity,
    replacement_capacity,
    is_active
  `)
        .order("start_time")

    const { data: branches } = await supabase
        .from("branches")
        .select("id, name")

    const { data: programmes } = await supabase
        .from("programmes")
        .select("id, name")

    const branchMap = new Map(
        branches?.map((branch) => [
            branch.id,
            branch.name,
        ]) ?? []
    )

    const programmeMap = new Map(
        programmes?.map((programme) => [
            programme.id,
            programme.name,
        ]) ?? []
    )

    if (error) {
        return (
            <p className="text-destructive">
                {error.message}
            </p>
        )
    }

    return (
        <div className="space-y-8">
            <div>
                <p className="text-sm text-muted-foreground">
                    Housekeeping
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                    Session Setup
                </h1>

                <p className="mt-2 text-muted-foreground">
                    Configure regular and replacement capacity for each class session.
                </p>
            </div>

            <div className="overflow-hidden rounded-xl border bg-background">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr className="border-b">
                            <th className="px-5 py-3 text-left">Branch</th>
                            <th className="px-5 py-3 text-left">Programme</th>
                            <th className="px-5 py-3 text-left">Schedule</th>
                            <th className="px-5 py-3 text-left">Regular</th>
                            <th className="px-5 py-3 text-left">Replacement</th>
                            <th className="px-5 py-3 text-left">Action</th>
                        </tr>
                    </thead>

                    <tbody>
                        {sessions?.map((session) => (
                            <tr
                                key={session.id}
                                className="border-b last:border-0"
                            >
                                <td className="px-5 py-4">
                                    {branchMap.get(session.branch_id) ?? "-"}
                                </td>

                                <td className="px-5 py-4">
                                    {programmeMap.get(session.programme_id) ?? "-"}
                                </td>

                                <td className="px-5 py-4">
                                    <div className="font-medium">
                                        {dayNames[session.day_of_week]}
                                    </div>

                                    <div className="text-xs text-muted-foreground">
                                        {session.start_time.slice(0, 5)}
                                        {" - "}
                                        {session.end_time.slice(0, 5)}
                                    </div>
                                </td>

                                <td colSpan={3} className="px-5 py-4">
                                    <form
                                        action={updateSessionCapacity}
                                        className="flex items-center gap-3"
                                    >
                                        <input
                                            type="hidden"
                                            name="id"
                                            value={session.id}
                                        />

                                        <input
                                            type="number"
                                            name="regular_capacity"
                                            min="0"
                                            defaultValue={session.regular_capacity}
                                            className="h-9 w-20 rounded-lg border bg-background px-3"
                                        />

                                        <input
                                            type="number"
                                            name="replacement_capacity"
                                            min="0"
                                            defaultValue={session.replacement_capacity}
                                            className="h-9 w-20 rounded-lg border bg-background px-3"
                                        />

                                        <button
                                            type="submit"
                                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                                        >
                                            Save
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