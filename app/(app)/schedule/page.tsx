import { createClient } from "@/lib/supabase/server"
import {
    approveSchedule,
    generateSchedule,
    lockSchedule,
} from "./actions"

import { getScheduleBatchValidation } from "@/lib/schedule-validation"
import Link from "next/link"

function formatMonth(value: string) {
    const [year, month] = value
        .split("-")
        .map(Number)

    return new Intl.DateTimeFormat("en-MY", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    }).format(
        new Date(
            Date.UTC(year, month - 1, 1)
        )
    )
}

type SchedulePageProps = {
    searchParams: Promise<{
        batch?: string
    }>
}

export default async function SchedulePage({
    searchParams,
}: SchedulePageProps) {
    const supabase = await createClient()

    const params = await searchParams

    /*
     * Branches
     */

    const { data: branches } = await supabase
        .from("branches")
        .select("id, name")
        .eq("is_active", true)
        .order("name")

    const { data: existingSchedules } =
        await supabase
            .from("schedule_batches")
            .select(`
      id,
      branch_id,
      schedule_month,
      status,
      generated_at,
      approved_at,
      locked_at
    `)
            .order("schedule_month", {
                ascending: false,
            })
            .order("created_at", {
                ascending: false,
            })

    const branchMap = new Map(
        branches?.map((branch) => [
            branch.id,
            branch.name,
        ]) ?? []
    )

    /*
     * Selected batch
     */

    let batch = null
    let classSessions = null

    if (params.batch) {
        const batchResult = await supabase
            .from("schedule_batches")
            .select(`
                id,
                branch_id,
                schedule_month,
                status,
                generated_at,
                approved_at,
                locked_at
                `)
            .eq("id", params.batch)
            .single()

        batch = batchResult.data

        const classResult = await supabase
            .from("class_sessions")
            .select(`
        id,
        programme_id,
        session_template_id,
        class_date,
        week_number,
        start_time,
        end_time,
        regular_capacity,
        replacement_capacity
      `)
            .eq("schedule_batch_id", params.batch)
            .order("class_date")
            .order("start_time")

        classSessions = classResult.data
    }

    /*
     * Supporting data
     */

    const { data: programmes } = await supabase
        .from("programmes")
        .select("id, name")

    const programmeMap = new Map(
        programmes?.map(
            (programme) => [
                programme.id,
                programme.name,
            ]
        ) ?? []
    )

    /*
     * Booking counts
     */

    const sessionIds =
        classSessions?.map(
            (session) => session.id
        ) ?? []

    let bookingCounts = new Map<string, number>()

    if (sessionIds.length > 0) {
        const { data: bookings } = await supabase
            .from("student_bookings")
            .select("class_session_id")
            .in("class_session_id", sessionIds)
            .eq("booking_type", "regular")

        for (const booking of bookings ?? []) {
            const count =
                bookingCounts.get(
                    booking.class_session_id
                ) ?? 0

            bookingCounts.set(
                booking.class_session_id,
                count + 1
            )
        }
    }

    let validation = null

    if (batch) {
        validation =
            await getScheduleBatchValidation(
                batch.id
            )
    }

    return (
        <div className="space-y-8">
            <div>
                <p className="text-sm text-muted-foreground">
                    Scheduling
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                    Monthly Schedule
                </h1>

                <p className="mt-2 text-muted-foreground">
                    Generate monthly class schedules
                    from active student enrollments.
                </p>
            </div>

            {/* GENERATOR */}

            <div className="rounded-xl border bg-background p-6">
                <h2 className="text-lg font-semibold">
                    Generate Schedule
                </h2>

                <form
                    action={generateSchedule}
                    className="mt-5 grid gap-4 md:grid-cols-3"
                >
                    <div>
                        <label className="mb-2 block text-sm font-medium">
                            Branch *
                        </label>

                        <select
                            name="branch_id"
                            required
                            defaultValue=""
                            className="h-10 w-full rounded-lg border bg-background px-3"
                        >
                            <option value="" disabled>
                                Select branch
                            </option>

                            {branches?.map((branch) => (
                                <option
                                    key={branch.id}
                                    value={branch.id}
                                >
                                    {branch.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium">
                            Month *
                        </label>

                        <input
                            type="month"
                            name="month"
                            required
                            className="h-10 w-full rounded-lg border bg-background px-3"
                        />
                    </div>

                    <div className="flex items-end">
                        <button
                            type="submit"
                            className="h-10 w-full rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
                        >
                            Generate Draft
                        </button>
                    </div>
                </form>
            </div>

            {/* EXISTING SCHEDULES */}

            <div className="space-y-4">
                <div>
                    <h2 className="text-xl font-semibold">
                        Existing Schedules
                    </h2>

                    <p className="mt-1 text-sm text-muted-foreground">
                        View previously generated monthly
                        schedules.
                    </p>
                </div>

                <div className="overflow-hidden rounded-xl border bg-background">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr className="border-b">
                                <th className="px-5 py-3 text-left">
                                    Month
                                </th>

                                <th className="px-5 py-3 text-left">
                                    Branch
                                </th>

                                <th className="px-5 py-3 text-left">
                                    Status
                                </th>

                                <th className="px-5 py-3 text-left">
                                    Generated
                                </th>

                                <th className="px-5 py-3 text-right">
                                    Action
                                </th>
                            </tr>
                        </thead>

                        <tbody>
                            {existingSchedules?.length ? (
                                existingSchedules.map(
                                    (schedule) => (
                                        <tr
                                            key={schedule.id}
                                            className={`border-b last:border-0 ${params.batch ===
                                                    schedule.id
                                                    ? "bg-muted/30"
                                                    : ""
                                                }`}
                                        >
                                            <td className="px-5 py-4 font-medium">
                                                {formatMonth(
                                                    schedule.schedule_month
                                                )}
                                            </td>

                                            <td className="px-5 py-4">
                                                {branchMap.get(
                                                    schedule.branch_id
                                                ) ?? "-"}
                                            </td>

                                            <td className="px-5 py-4">
                                                <span className="rounded-full border px-3 py-1 text-xs font-medium uppercase">
                                                    {schedule.status}
                                                </span>
                                            </td>

                                            <td className="px-5 py-4 text-muted-foreground">
                                                {new Date(
                                                    schedule.generated_at
                                                ).toLocaleDateString(
                                                    "en-MY"
                                                )}
                                            </td>

                                            <td className="px-5 py-4 text-right">
                                                <Link
                                                    href={`/schedule?batch=${schedule.id}`}
                                                    className="font-medium underline underline-offset-4"
                                                >
                                                    View
                                                </Link>
                                            </td>
                                        </tr>
                                    )
                                )
                            ) : (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-5 py-10 text-center text-muted-foreground"
                                    >
                                        No schedules generated yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* GENERATED RESULT */}

            {batch && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-semibold">
                                Draft Schedule
                            </h2>

                            <p className="text-sm text-muted-foreground">
                                {batch.schedule_month}
                            </p>
                        </div>

                        <span className="rounded-full border px-3 py-1 text-xs font-medium uppercase">
                            {batch.status}
                        </span>
                    </div>

                    {validation && (
                        <div className="rounded-xl border bg-background p-6">
                            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <h3 className="font-semibold">
                                        Schedule Validation
                                    </h3>

                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {validation.stats.sessions} classes
                                        {" · "}
                                        {validation.stats.bookings} student bookings
                                    </p>

                                    {validation.valid ? (
                                        <p className="mt-3 text-sm font-medium">
                                            ✓ No blocking conflicts detected.
                                        </p>
                                    ) : (
                                        <div className="mt-3">
                                            <p className="text-sm font-medium text-destructive">
                                                Schedule has blocking conflicts.
                                            </p>

                                            <ul className="mt-2 space-y-1 text-sm text-destructive">
                                                {validation.errors.map(
                                                    (error) => (
                                                        <li key={error}>
                                                            • {error}
                                                        </li>
                                                    )
                                                )}
                                            </ul>
                                        </div>
                                    )}
                                </div>

                                <div className="shrink-0">
                                    {batch.status === "draft" && (
                                        <form action={approveSchedule}>
                                            <input
                                                type="hidden"
                                                name="batch_id"
                                                value={batch.id}
                                            />

                                            <button
                                                type="submit"
                                                disabled={!validation.valid}
                                                className="h-10 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                Approve Schedule
                                            </button>
                                        </form>
                                    )}

                                    {batch.status === "approved" && (
                                        <div className="space-y-3 text-right">
                                            <div>
                                                <p className="text-sm font-medium">
                                                    ✓ Schedule approved
                                                </p>

                                                {batch.approved_at && (
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {new Date(
                                                            batch.approved_at
                                                        ).toLocaleString("en-MY")}
                                                    </p>
                                                )}
                                            </div>

                                            <form action={lockSchedule}>
                                                <input
                                                    type="hidden"
                                                    name="batch_id"
                                                    value={batch.id}
                                                />

                                                <button
                                                    type="submit"
                                                    className="h-10 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
                                                >
                                                    Lock Schedule
                                                </button>
                                            </form>

                                            <p className="max-w-xs text-xs text-muted-foreground">
                                                Locking finalises the regular monthly
                                                schedule. It cannot be regenerated after
                                                this.
                                            </p>
                                        </div>
                                    )}

                                    {batch.status === "locked" && (
                                        <div className="text-right">
                                            <p className="text-sm font-medium">
                                                🔒 Schedule locked
                                            </p>

                                            {batch.locked_at && (
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {new Date(
                                                        batch.locked_at
                                                    ).toLocaleString("en-MY")}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="overflow-hidden rounded-xl border bg-background">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr className="border-b">
                                    <th className="px-5 py-3 text-left">
                                        Week
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Date
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Programme
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Time
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Regular
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Replacement
                                    </th>

                                    <th className="px-5 py-3 text-left">
                                        Action
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {classSessions?.map(
                                    (session) => {
                                        const regularCount =
                                            bookingCounts.get(
                                                session.id
                                            ) ?? 0

                                        const isOverCapacity =
                                            regularCount >
                                            session.regular_capacity

                                        return (
                                            <tr
                                                key={session.id}
                                                className="border-b last:border-0"
                                            >
                                                <td className="px-5 py-4">
                                                    W{session.week_number}
                                                </td>

                                                <td className="px-5 py-4">
                                                    {session.class_date}
                                                </td>

                                                <td className="px-5 py-4 font-medium">
                                                    {programmeMap.get(
                                                        session.programme_id
                                                    ) ?? "-"}
                                                </td>

                                                <td className="px-5 py-4">
                                                    {session.start_time.slice(
                                                        0,
                                                        5
                                                    )}
                                                    {" - "}
                                                    {session.end_time.slice(
                                                        0,
                                                        5
                                                    )}
                                                </td>

                                                <td
                                                    className={`px-5 py-4 ${isOverCapacity
                                                        ? "font-semibold text-destructive"
                                                        : ""
                                                        }`}
                                                >
                                                    {regularCount}
                                                    {" / "}
                                                    {session.regular_capacity}

                                                    {isOverCapacity && (
                                                        <div className="text-xs">
                                                            Over capacity
                                                        </div>
                                                    )}
                                                </td>

                                                <td className="px-5 py-4">
                                                    0 /{" "}
                                                    {
                                                        session.replacement_capacity
                                                    }
                                                </td>

                                                <td className="px-5 py-4">
                                                    <Link
                                                        href={`/schedule/sessions/${session.id}`}
                                                        className="font-medium underline underline-offset-4"
                                                    >
                                                        Review
                                                    </Link>
                                                </td>
                                            </tr>
                                        )
                                    }
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}