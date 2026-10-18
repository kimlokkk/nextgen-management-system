import Link from "next/link"
import { AlertTriangle, CalendarDays, CheckCircle2, LockKeyhole } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import {
    countsTowardsRegularCapacity,
    countsTowardsReplacementCapacity,
} from "@/lib/reschedule-policy"
import { getScheduleBatchValidation } from "@/lib/schedule-validation"
import { FormSubmit } from "@/components/form-submit"
import { TransitionWeekOverview } from "@/components/transition-week-overview"
import { ScheduleActions } from "@/components/schedule-actions"
import {
    ScheduleBatchLibrary,
    ScheduleClassList,
    ScheduleStatus,
    type ScheduleBatchSummary,
    type ScheduleClassSummary,
} from "@/components/schedule-workspace"
import { approveSchedule, generateSchedule, lockSchedule } from "./actions"

type PageProps = {
    searchParams: Promise<{ batch?: string; prepare_month?: string; branch?: string }>
}

function formatMonth(value: string) {
    const [year, month] = value.slice(0, 7).split("-").map(Number)
    const date = new Date(Date.UTC(year, month - 1, 1))
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat("en-MY", {
        month: "long", year: "numeric", timeZone: "UTC",
    }).format(date)
}

function malaysiaMonth() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kuala_Lumpur",
        year: "numeric", month: "2-digit",
    }).formatToParts(new Date())
    const value = (type: string) => parts.find((item) => item.type === type)?.value ?? ""
    return `${value("year")}-${value("month")}`
}

export default async function SchedulePage({ searchParams }: PageProps) {
    const supabase = await createClient()
    const params = await searchParams

    const [branchResult, batchResult, programmeResult] = await Promise.all([
        supabase.from("branches").select("id, name, is_active").order("name"),
        supabase.from("schedule_batches")
            .select("id, branch_id, schedule_month, status, generated_at, approved_at, locked_at")
            .order("schedule_month", { ascending: false })
            .order("created_at", { ascending: false }),
        supabase.from("programmes").select("id, name"),
    ])

    const dataError = [branchResult.error, batchResult.error, programmeResult.error].find(Boolean)
    if (dataError) {
        return (
            <div className="rounded-xl border bg-card p-6">
                <h1 className="text-2xl font-semibold">Class schedule</h1>
                <p className="mt-3 text-sm text-destructive">Could not load schedules. {dataError.message}</p>
            </div>
        )
    }

    const branches = branchResult.data ?? []
    const batches = batchResult.data ?? []
    const programmes = programmeResult.data ?? []
    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]))
    const programmeNames = new Map(programmes.map((programme) => [programme.id, programme.name]))
    const currentMonth = malaysiaMonth()
    const prepareMonth = params.prepare_month && /^20\d{2}-(0[1-9]|1[0-2])$/.test(params.prepare_month)
        ? params.prepare_month : null
    const prepareBranch = branches.find((branch) => branch.is_active && branch.id === params.branch) ?? null

    // When no batch is named, open this month's locked schedule first;
    // otherwise select this month's batch, or the latest available record.
    const selectedBatch = params.batch
        ? batches.find((item) => item.id === params.batch) ?? null
        : batches.find((item) => item.schedule_month.startsWith(currentMonth) && item.status === "locked")
            ?? batches.find((item) => item.schedule_month.startsWith(currentMonth))
            ?? batches[0]
            ?? null

    const batchSummaries: ScheduleBatchSummary[] = batches.map((item) => ({
        id: item.id,
        month: formatMonth(item.schedule_month),
        branch: branchNames.get(item.branch_id) ?? "Branch unavailable",
        status: item.status,
        generatedAt: item.generated_at ?? null,
    }))

    const classResult = selectedBatch
        ? await supabase.from("class_sessions")
            .select("id, programme_id, class_date, week_number, start_time, end_time, regular_capacity, replacement_capacity")
            .eq("schedule_batch_id", selectedBatch.id)
            .order("class_date")
            .order("start_time")
        : { data: [], error: null }

    if (classResult.error) {
        return <div className="rounded-xl border bg-card p-6">
            <h1 className="text-2xl font-semibold">Class schedule</h1>
            <p className="mt-3 text-sm text-destructive">Could not load classes. {classResult.error.message}</p>
        </div>
    }

    const sessions = classResult.data ?? []
    const { data: activeSessionDays } = selectedBatch
        ? await supabase.from("session_templates").select("day_of_week")
            .eq("branch_id", selectedBatch.branch_id).eq("is_active", true)
        : { data: [] as { day_of_week: number }[] }
    const ids = sessions.map((item) => item.id)
    const bookingResult = ids.length
        ? await supabase.from("student_bookings")
            .select("class_session_id, booking_type, attendance_status")
            .in("class_session_id", ids)
        : { data: [], error: null }

    if (bookingResult.error) {
        return <div className="rounded-xl border bg-card p-6">
            <h1 className="text-2xl font-semibold">Class schedule</h1>
            <p className="mt-3 text-sm text-destructive">Could not load seat usage. {bookingResult.error.message}</p>
        </div>
    }

    const bookingsByClass = new Map<string, { booking_type: string; attendance_status: string }[]>()
    for (const booking of bookingResult.data ?? []) {
        const current = bookingsByClass.get(booking.class_session_id) ?? []
        current.push(booking)
        bookingsByClass.set(booking.class_session_id, current)
    }

    const classes: ScheduleClassSummary[] = sessions.map((item) => {
        const bookings = bookingsByClass.get(item.id) ?? []
        return {
            id: item.id,
            date: item.class_date,
            week: item.week_number,
            programme: programmeNames.get(item.programme_id) ?? "Programme unavailable",
            start: item.start_time,
            end: item.end_time,
            regularUsed: bookings.filter(countsTowardsRegularCapacity).length,
            regularCapacity: item.regular_capacity,
            yellowUsed: bookings.filter(countsTowardsReplacementCapacity).length,
            yellowCapacity: item.replacement_capacity,
        }
    })

    const validation = selectedBatch
        ? await getScheduleBatchValidation(selectedBatch.id)
        : null

    const totalRegular = classes.reduce((sum, item) => sum + item.regularUsed, 0)
    const totalYellow = classes.reduce((sum, item) => sum + item.yellowUsed, 0)
    const maxRegular = classes.reduce((sum, item) => sum + item.regularCapacity, 0)
    const maxYellow = classes.reduce((sum, item) => sum + item.yellowCapacity, 0)

    const generatePanel = (
        <div className="rounded-lg bg-card p-4 sm:p-5">
            <div className="mb-4">
                <h2 className="font-semibold">Generate monthly schedule</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Select a branch and month to create a new draft.
                    Regenerating an existing draft will replace that draft and its bookings.
                    Approved and locked schedules cannot be regenerated.
                    Plan branch closures in the <Link href="/housekeeping/calendar" className="font-semibold text-primary underline underline-offset-2">Academic Calendar</Link> first;
                    an undecided closure blocks affected class generation.
                </p>
            </div>
            {prepareMonth && (
                <p className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    Preparing {formatMonth(prepareMonth)}. This only creates a draft;
                    review and approve it separately before sharing with parents.
                </p>
            )}
            <form action={generateSchedule} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <div>
                            <label htmlFor="schedule-generate-branch" className="mb-2 block text-sm font-medium">Branch *</label>
                            <select id="schedule-generate-branch" name="branch_id" required defaultValue={prepareBranch?.id ?? ""}
                                className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm">
                                <option value="" disabled>Select active branch</option>
                                {branches.filter((branch) => branch.is_active).map((branch) => (
                                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="schedule-generate-month" className="mb-2 block text-sm font-medium">Month *</label>
                            <input id="schedule-generate-month" type="month" name="month" required defaultValue={prepareMonth ?? currentMonth}
                                className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm" />
                        </div>
                        <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground sm:col-span-2 lg:col-span-3">
                            <input type="checkbox" name="confirm_regenerate" value="yes" className="mt-1 size-4 shrink-0 accent-primary" />
                            If a draft already exists for this branch and month, I understand generating again
                            permanently replaces that draft and its bookings.
                        </label>
                        <div className="flex items-end sm:col-span-2 lg:col-span-3">
                            <FormSubmit>Generate draft</FormSubmit>
                        </div>
                    </form>
        </div>
    )

    return (
        <div className="min-w-0 space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-primary">Class operations</p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Class schedule</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                        Review monthly classes, monitor seat capacity and open each class for attendance.
                    </p>
                </div>
            </header>

            <ScheduleActions
                key={`${selectedBatch?.id ?? "no-schedule"}:${prepareMonth ?? "current"}`}
                selectedLabel={selectedBatch ? formatMonth(selectedBatch.schedule_month) : undefined}
                selectedBranch={selectedBatch ? branchNames.get(selectedBatch.branch_id) ?? "Branch unavailable" : undefined}
                scheduleCount={batches.length}
                initialPanel={prepareMonth || batches.length === 0 ? "generate" : params.batch && !selectedBatch ? "browse" : null}
                library={<ScheduleBatchLibrary batches={batchSummaries} selectedId={selectedBatch?.id ?? null} />}
                generator={generatePanel}
            />

            {selectedBatch ? (
                <>
                    <section className="rounded-xl border bg-card p-4 sm:p-6" aria-label="Selected schedule">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-muted-foreground">Selected monthly schedule</p>
                                <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                                    {formatMonth(selectedBatch.schedule_month)}
                                </h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {branchNames.get(selectedBatch.branch_id) ?? "Branch unavailable"}
                                </p>
                            </div>
                            <ScheduleStatus status={selectedBatch.status} />
                        </div>
                        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                            {[
                                { label: "Classes", value: String(classes.length), info: "Generated sessions" },
                                { label: "Regular seats", value: `${totalRegular} / ${maxRegular}`, info: "Occupied / capacity" },
                                { label: "Yellow seats", value: `${totalYellow} / ${maxYellow}`, info: "Occupied / capacity" },
                                { label: "Validation", value: validation?.valid ? "Clear" : `${validation?.errors.length ?? 0} issues`,
                                    info: "Blocking conflicts" },
                            ].map((item) => (
                                <div key={item.label} className="min-w-0 rounded-lg border bg-muted/30 p-3 sm:p-4">
                                    <p className="text-xs text-muted-foreground">{item.label}</p>
                                    <p className="mt-1 truncate text-xl font-semibold tabular-nums sm:text-2xl" title={item.value}>{item.value}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">{item.info}</p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <TransitionWeekOverview
                        year={Number(selectedBatch.schedule_month.slice(0, 4))}
                        month={Number(selectedBatch.schedule_month.slice(5, 7))}
                        branchId={selectedBatch.branch_id}
                        dayOfWeeks={(activeSessionDays ?? []).map((item) => item.day_of_week)}
                    />
                    {validation && (
                        <section className="rounded-xl border bg-card p-4 sm:p-5" aria-label="Schedule validation">
                            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        {validation.valid
                                            ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                                            : <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden="true" />}
                                        <h2 className="font-semibold">
                                            {validation.valid ? "Ready — no blocking conflicts" : "Attention — blocking conflicts"}
                                        </h2>
                                    </div>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {validation.stats.sessions} classes · {validation.stats.bookings} bookings checked
                                    </p>
                                    {!validation.valid && (
                                        <ul className="mt-3 space-y-1.5 text-sm text-destructive">
                                            {validation.errors.map((error) => <li key={error}>• {error}</li>)}
                                        </ul>
                                    )}
                                </div>
                                <div className="w-full shrink-0 space-y-2 md:w-auto md:max-w-72">
                                    {selectedBatch.status === "draft" && (
                                        <form action={approveSchedule}>
                                            <input type="hidden" name="batch_id" value={selectedBatch.id} />
                                            <button type="submit" disabled={!validation.valid}
                                                className="ui-primary-action w-full disabled:cursor-not-allowed disabled:opacity-50">
                                                Approve draft
                                            </button>
                                        </form>
                                    )}
                                    {selectedBatch.status === "approved" && (
                                        <>
                                            <form action={lockSchedule}>
                                                <input type="hidden" name="batch_id" value={selectedBatch.id} />
                                                <button type="submit" disabled={!validation.valid}
                                                    className="ui-primary-action w-full disabled:cursor-not-allowed disabled:opacity-50">
                                                    <LockKeyhole className="size-4" aria-hidden="true" />
                                                    Lock schedule
                                                </button>
                                            </form>
                                            <p className="text-xs leading-5 text-muted-foreground">
                                                Locking finalises this month&apos;s regular classes and prevents regeneration.
                                            </p>
                                        </>
                                    )}
                                    {selectedBatch.status === "locked" && (
                                        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                                            <LockKeyhole className="size-4" aria-hidden="true" /> Schedule locked
                                        </p>
                                    )}
                                </div>
                            </div>
                        </section>
                    )}
                    <ScheduleClassList classes={classes} />
                </>
            ) : (
                <section className="rounded-xl border bg-card px-5 py-10 text-center">
                    <CalendarDays className="mx-auto size-9 text-primary" aria-hidden="true" />
                    <h2 className="mt-3 text-lg font-semibold">
                        {params.batch ? "Selected schedule unavailable" : "No monthly schedule yet"}
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {params.batch
                            ? "Use Browse months above to choose another schedule. This one may have been removed."
                            : "Use Generate draft above to start reviewing classes."}
                    </p>
                </section>
            )}


        </div>
    )
}
