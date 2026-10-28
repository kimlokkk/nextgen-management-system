import Link from "next/link"
import { AlertTriangle, CalendarDays, CheckCircle2, LockKeyhole } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import {
    countsTowardsRegularCapacity,
} from "@/lib/reschedule-policy"
import { getScheduleBatchValidation } from "@/lib/schedule-validation"
import { getYellowSeatUsage } from "@/lib/yellow-seat-usage"
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
import { approveSchedule, generateSchedule, lockSchedule, regenerateDraft, reopenSchedule } from "./actions"

type PageProps = {
    searchParams: Promise<{ batch?: string; prepare_month?: string; branch?: string; rebuilt?: string }>
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
            .select("id, programme_id, session_template_id, class_date, week_number, start_time, end_time, regular_capacity, replacement_capacity")
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
        ? await supabase.from("session_templates").select("id, name, day_of_week")
            .eq("branch_id", selectedBatch.branch_id).eq("is_active", true)
        : { data: [] as { id: string; name: string; day_of_week: number }[] }
    const templateNames = new Map((activeSessionDays ?? []).map((item) => [item.id, item.name]))
    const ids = sessions.map((item) => item.id)
    const bookingResult = ids.length
        ? await supabase.from("student_bookings")
            .select("id, class_session_id, booking_type, attendance_status")
            .in("class_session_id", ids)
        : { data: [], error: null }

    if (bookingResult.error) {
        return <div className="rounded-xl border bg-card p-6">
            <h1 className="text-2xl font-semibold">Class schedule</h1>
            <p className="mt-3 text-sm text-destructive">Could not load seat usage. {bookingResult.error.message}</p>
        </div>
    }

    const bookingsByClass = new Map<string, { id: string; class_session_id: string; booking_type: string; attendance_status: string }[]>()
    for (const booking of bookingResult.data ?? []) {
        const current = bookingsByClass.get(booking.class_session_id) ?? []
        current.push(booking)
        bookingsByClass.set(booking.class_session_id, current)
    }

    // Operationally confirmed in the MTDC October Excel, but kept separate
    // from the modern replacement-entitlement/attendance pipeline.
    const { data: legacySourceRows, error: legacySeatError } = ids.length
        ? await supabase.from("legacy_replacement_reviews")
            .select("target_class_id, review_state, linked_active_booking_id")
            .in("target_class_id", ids)
        : { data: [], error: null }
    if (legacySeatError) {
        return <section className="rounded-xl border bg-card p-5 text-sm text-destructive">
            Cannot load confirmed legacy yellow seats: {legacySeatError.message}.
            Apply local migration 019 before reviewing class capacity.
        </section>
    }

    const classes: ScheduleClassSummary[] = sessions.map((item) => {
        const bookings = bookingsByClass.get(item.id) ?? []
        const yellow = getYellowSeatUsage(
            item.id, item.replacement_capacity, bookings, legacySourceRows ?? []
        )
        return {
            id: item.id,
            date: item.class_date,
            week: item.week_number,
            programme: programmeNames.get(item.programme_id) ?? "Programme unavailable",
            templateLabel: templateNames.get(item.session_template_id) ?? undefined,
            start: item.start_time,
            end: item.end_time,
            regularUsed: bookings.filter(countsTowardsRegularCapacity).length,
            regularCapacity: item.regular_capacity,
            yellowUsed: yellow.occupied,
            modernYellowUsed: yellow.active,
            yellowCapacity: item.replacement_capacity,
            legacyBooked: yellow.legacy,
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
                    Generating is for a month that has no schedule yet. A draft that is wrong can be rebuilt from its own page while nothing real depends on it;
                    approved and locked schedules are protected.
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
                        <p className="text-xs leading-5 text-muted-foreground sm:col-span-2 lg:col-span-3">
                            Existing schedules cannot be overwritten. Review the November preflight before
                            creating the first draft for MTDC.
                        </p>
                        <div className="flex items-end sm:col-span-2 lg:col-span-3">
                            <FormSubmit>Generate draft</FormSubmit>
                        </div>
                    </form>
        </div>
    )

    // Audited manual changes to this month (migration 029). Missing table => show nothing.
    const { data: editRows } = selectedBatch
        ? await supabase.from("draft_schedule_edits")
            .select("id, action, student_id, from_class_date, from_start_time, to_class_date, to_start_time, reason, edited_at")
            .eq("schedule_batch_id", selectedBatch.id)
            .order("edited_at", { ascending: false })
            .limit(50)
        : { data: [] }
    const manualEdits = editRows ?? []
    // What a rebuild would do (migration 032, read-only). Missing function => no rebuild panel.
    const rebuildPreview = selectedBatch?.status === "draft"
        ? ((await supabase.rpc("preview_draft_regeneration", { p_batch_id: selectedBatch.id })).data as {
            found?: boolean; classes?: number; bookings?: number; manual_edits?: number; seat_changes?: number
            capacity_decisions?: number; blockers?: string[]; can_regenerate?: boolean
        } | null)
        : null
    const editStudentIds = [...new Set(manualEdits.map((row) => row.student_id).filter(Boolean))] as string[]
    const { data: editStudents } = editStudentIds.length > 0
        ? await supabase.from("students").select("id, full_name").in("id", editStudentIds)
        : { data: [] }
    const editStudentName = new Map((editStudents ?? []).map((item) => [item.id, item.full_name]))
    const editDate = (date: string | null, time: string | null) => date
        ? `${new Intl.DateTimeFormat("en-MY", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }
        ).format(new Date(`${date}T00:00:00Z`))} ${time?.slice(0, 5) ?? ""}`.trim()
        : ""
    const editLabel = (row: (typeof manualEdits)[number]) => {
        const who = row.student_id ? editStudentName.get(row.student_id) ?? "A student" : null
        if (row.action === "move") return `${who} moved from ${editDate(row.from_class_date, row.from_start_time)} to ${editDate(row.to_class_date, row.to_start_time)}`
        if (row.action === "remove") return `${who} removed from ${editDate(row.from_class_date, row.from_start_time)}`
        if (row.action === "add") return `${who} added to ${editDate(row.to_class_date, row.to_start_time)}`
        return "Sent back to draft after approval"
    }

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

            {params.rebuilt === "1" && selectedBatch?.status === "draft" && (
                <p role="status" className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
                    The draft was rebuilt from today&apos;s enrollments. Review it again before approving.
                </p>
            )}

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
                                        <form action={approveSchedule} className="space-y-3">
                                            <input type="hidden" name="batch_id" value={selectedBatch.id} />
                                             <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                                                 <input type="checkbox" name="confirm_operations_review" value="yes" required className="mt-0.5 size-4 accent-primary" />
                                                 I verified the dates, room capacity and facilitator arrangements. Approval is not a UAT simulation.
                                             </label>
                                            <button type="submit" disabled={!validation.valid}
                                                className="ui-primary-action w-full disabled:cursor-not-allowed disabled:opacity-50">
                                                Approve draft
                                            </button>
                                        </form>
                                    )}
                                    {selectedBatch.status === "draft" && rebuildPreview?.found && (
                                        <details className="rounded-lg border bg-muted/20 p-3 text-xs">
                                            <summary className="cursor-pointer select-none font-semibold">Wrong enrollments? Rebuild this draft</summary>
                                            <div className="mt-3 space-y-2 leading-5">
                                                <p>
                                                    This throws away the draft ({rebuildPreview.classes ?? 0} classes, {rebuildPreview.bookings ?? 0} bookings)
                                                    and builds it again from today&apos;s enrollments. If the new draft cannot be built, this one stays as it is.
                                                </p>
                                                {(rebuildPreview.blockers ?? []).length > 0 ? (
                                                    <>
                                                        <p className="font-medium text-destructive">It cannot be rebuilt right now:</p>
                                                        <ul className="space-y-1 text-destructive">
                                                            {(rebuildPreview.blockers ?? []).map((blocker) => <li key={blocker}>• {blocker}</li>)}
                                                        </ul>
                                                    </>
                                                ) : (
                                                    <form action={regenerateDraft} className="space-y-2">
                                                        <input type="hidden" name="batch_id" value={selectedBatch.id} />
                                                        {((rebuildPreview.manual_edits ?? 0) + (rebuildPreview.seat_changes ?? 0) + (rebuildPreview.capacity_decisions ?? 0)) > 0 && (
                                                            <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 leading-5">
                                                                <input name="acknowledge_losses" type="checkbox" value="yes" required
                                                                    className="mt-0.5 size-4 accent-primary" />
                                                                I accept losing {rebuildPreview.manual_edits ?? 0} manual change(s), {rebuildPreview.seat_changes ?? 0} seat change(s)
                                                                and {rebuildPreview.capacity_decisions ?? 0} capacity decision(s) in this draft. They stay in the audit history.
                                                            </label>
                                                        )}
                                                        <input name="reason" required minLength={10} maxLength={500}
                                                            placeholder="Why? (at least 10 characters)"
                                                            className="h-9 w-full rounded-lg border bg-background px-2 text-xs" />
                                                        <label className="flex items-start gap-2 leading-5">
                                                            <input name="confirm_rebuild" type="checkbox" value="yes" required
                                                                className="mt-0.5 size-4 accent-primary" />
                                                            Rebuild this month&apos;s draft now.
                                                        </label>
                                                        <button type="submit" className="ui-primary-action w-full">Rebuild draft</button>
                                                    </form>
                                                )}
                                            </div>
                                        </details>
                                    )}
                                    {selectedBatch.status === "approved" && (
                                        <>
                                            <form action={lockSchedule} className="space-y-3">
                                                <input type="hidden" name="batch_id" value={selectedBatch.id} />
                                             <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                                                 <input type="checkbox" name="confirm_final_release" value="yes" required className="mt-0.5 size-4 accent-primary" />
                                                 I verified the approved timetable for final operational release. Locking is not a UAT simulation.
                                             </label>
                                                <button type="submit" disabled={!validation.valid}
                                                    className="ui-primary-action w-full disabled:cursor-not-allowed disabled:opacity-50">
                                                    <LockKeyhole className="size-4" aria-hidden="true" />
                                                    Lock schedule
                                                </button>
                                            </form>
                                            <p className="text-xs leading-5 text-muted-foreground">
                                                Locking finalises this month&apos;s regular classes and prevents regeneration.
                                            </p>
                                            <details className="rounded-lg border bg-muted/20 p-3 text-xs">
                                                <summary className="cursor-pointer select-none font-semibold">Found a mistake? Send back to draft</summary>
                                                <form action={reopenSchedule} className="mt-3 space-y-2">
                                                    <input type="hidden" name="batch_id" value={selectedBatch.id} />
                                                    <input name="reason" required minLength={10} maxLength={500}
                                                        placeholder="Why? (at least 10 characters)"
                                                        className="h-9 w-full rounded-lg border bg-background px-2 text-xs" />
                                                    <label className="flex items-start gap-2 leading-5">
                                                        <input name="confirm_reopen" type="checkbox" value="yes" required
                                                            className="mt-0.5 size-4 accent-primary" />
                                                        Send this month back to draft. It must be approved again before locking.
                                                    </label>
                                                    <button type="submit" className="ui-primary-action w-full">Send back to draft</button>
                                                </form>
                                            </details>
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
                    {manualEdits.length > 0 && (
                        <section className="rounded-xl border bg-card p-4 sm:p-5" aria-label="Manual changes to this month">
                            <details>
                                <summary className="cursor-pointer select-none font-semibold">
                                    Manual changes to this month · {manualEdits.length}
                                </summary>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                    Admins changed who attends which class this month. Enrollments were not changed.
                                </p>
                                <ul className="mt-3 space-y-2 text-sm">
                                    {manualEdits.map((row) => (
                                        <li key={row.id} className="rounded-lg bg-muted/30 p-3">
                                            <p className="font-medium">{editLabel(row)}</p>
                                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                                {row.reason} · {new Intl.DateTimeFormat("en-MY", {
                                                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                                                    timeZone: "Asia/Kuala_Lumpur",
                                                }).format(new Date(row.edited_at))}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        </section>
                    )}
                    <ScheduleClassList key={selectedBatch.id} classes={classes} />
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
