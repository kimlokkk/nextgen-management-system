import Link from "next/link"
import { AlertTriangle, ArrowLeft, CalendarDays, CalendarOff, CheckCircle2, ChevronDown, LockKeyhole, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createCalendarEvent } from "./actions"
import { CalendarDecisionForm, type CalendarDecision } from "@/components/calendar-decision-form"
import { FormSubmit } from "@/components/form-submit"
import { TransitionWeekOverview } from "@/components/transition-week-overview"
import { TableScrollArea } from "@/components/table-scroll-area"
import { generateClassSessions, getMonthlyDatesForDay, getMonthlyTeachingCycle, type CalendarException, type SessionTemplate } from "@/lib/scheduling"

type PageProps = {
    searchParams: Promise<{ branch?: string; month?: string }>
}

function malaysiaMonth() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit",
    }).formatToParts(new Date())
    const piece = (type: string) => parts.find((item) => item.type === type)?.value ?? ""
    return `${piece("year")}-${piece("month")}`
}

function formatDate(date: string) {
    const parsed = new Date(`${date}T00:00:00Z`)
    return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-MY", {
        timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
    }).format(parsed)
}

function statusStyle(status: string) {
    return status === "pending"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
        : status === "move"
            ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
            : status === "skip"
                ? "border-violet-500/30 bg-violet-500/10 text-violet-800 dark:text-violet-300"
                : "border-border bg-muted text-muted-foreground"
}

export default async function AcademicCalendarPage({ searchParams }: PageProps) {
    const supabase = await createClient()
    const params = await searchParams

    const [branchResult, programmeResult] = await Promise.all([
        supabase.from("branches").select("id, name, is_active").order("name"),
        supabase.from("programmes").select("id, name"),
    ])
    if (branchResult.error || programmeResult.error) {
        return <div className="rounded-xl border bg-card p-6">
            <h1 className="text-2xl font-semibold">Academic Calendar</h1>
            <p className="mt-3 text-sm text-destructive">
                Could not load setup data: {branchResult.error?.message ?? programmeResult.error?.message}
            </p>
        </div>
    }

    const branches = branchResult.data ?? []
    const programmes = new Map((programmeResult.data ?? []).map((p) => [p.id, p.name]))
    const selectedBranch = branches.find((b) => b.id === params.branch)
        ?? branches.find((b) => b.is_active) ?? branches[0]
    const branchId = selectedBranch?.id ?? null
    const month = params.month && /^20\d{2}-(0[1-9]|1[0-2])$/.test(params.month)
        ? params.month : malaysiaMonth()
    const [year, monthNumber] = month.split("-").map(Number)
    const start = `${month}-01`
    const end = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10)
    const lastDate = `${month}-${new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()}`

    const empty = { data: [], error: null }
    const [eventResult, templateResult, batchResult] = branchId ? await Promise.all([
        supabase.from("academic_calendar_exceptions")
            .select("id, branch_id, closed_on, title, event_type, decision, target_on, notes, created_at, updated_at")
            .eq("branch_id", branchId).gte("closed_on", start).lt("closed_on", end)
            .order("closed_on"),
        supabase.from("session_templates")
            .select("id, branch_id, programme_id, day_of_week, start_time, end_time, regular_capacity, replacement_capacity")
            .eq("branch_id", branchId).eq("is_active", true),
        supabase.from("schedule_batches")
            .select("id, status, generated_at")
            .eq("branch_id", branchId).eq("schedule_month", start).maybeSingle(),
    ]) : [empty, empty, { data: null, error: null }]

    const pageError = eventResult.error || templateResult.error || batchResult.error
    const events = eventResult.data ?? []
    const templates = (templateResult.data ?? []) as SessionTemplate[]
    const batch = batchResult.data
    const frozen = batch?.status === "approved" || batch?.status === "locked"
    const pending = events.filter((event) => event.decision === "pending")
    const modifiedSinceGeneration = batch?.generated_at && events.some(
        (event) => event.updated_at > batch.generated_at
    )

    const policies = events.map((event): CalendarException => ({
        closed_on: event.closed_on,
        decision: event.decision as CalendarException["decision"],
        target_on: event.target_on,
    }))

    let preview: ReturnType<typeof generateClassSessions> = []
    let previewError: string | null = null
    if (!pageError && templates.length) {
        try {
            preview = generateClassSessions(templates, year, monthNumber, policies)
        } catch (error) {
            previewError = error instanceof Error ? error.message : "Calendar decisions must be reviewed."
        }
    }

    const baseCount = templates.reduce((total, template) =>
        total + getMonthlyTeachingCycle(year, monthNumber, template.day_of_week).regularDates.length, 0)
    const sorted = [...preview].sort((a, b) =>
        a.class_date.localeCompare(b.class_date) || a.start_time.localeCompare(b.start_time)
        || a.programme_id.localeCompare(b.programme_id))

    return (
        <div className="min-w-0 space-y-6">
            <header>
                <Link href="/schedule" className="ui-action-link -ml-2">
                    <ArrowLeft className="size-4" aria-hidden="true" /> Back to class schedule
                </Link>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium text-primary">Class planning</p>
                        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Academic Calendar</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                            Record holidays, events and branch closures. An admin must decide what happens to classes;
                            the generator never makes that decision automatically.
                        </p>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-xs font-semibold">
                        <CalendarDays className="size-4 text-primary" aria-hidden="true" /> Branch-wide · V1
                    </span>
                </div>
            </header>

            <form method="get" className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end sm:p-5">
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">Branch</span>
                    <select name="branch" defaultValue={branchId ?? ""}
                        className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm" required>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">Month</span>
                    <input type="month" name="month" defaultValue={month} required
                        className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm" />
                </label>
                <button type="submit" className="ui-secondary-action w-full sm:w-auto">View month</button>
            </form>

            {pageError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                    <p className="font-semibold text-destructive">Academic Calendar unavailable</p>
                    <p className="mt-1 text-sm text-destructive">
                        {pageError.message}. Apply migration 016 in your development Supabase project before testing.
                    </p>
                </div>
            )}

            {!pageError && branchId && (
                <>
                    <TransitionWeekOverview year={year} month={monthNumber}
                        dayOfWeeks={templates.map((t) => t.day_of_week)} branchId={branchId} />
                    {batch && (
                        <div className={`rounded-xl border p-4 sm:p-5 ${frozen ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                            <div className="flex items-start gap-3">
                                {frozen ? <LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                                    : <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />}
                                <div>
                                    <p className="font-semibold">
                                        {frozen ? "Calendar frozen for this month" : "Draft schedule already exists"}
                                    </p>
                                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                        {frozen
                                            ? "This schedule is approved or locked. Events and decisions cannot be changed here."
                                            : modifiedSinceGeneration
                                                ? "The calendar changed after this draft was generated. Regenerate the draft before approving it."
                                                : "You can edit events, but the existing draft will not change until it is regenerated. Confirm overwrite explicitly when generating again."}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Monthly planning summary">
                        {[
                            { label: "Calendar events", value: events.filter((e) => e.decision !== "withdrawn").length, icon: CalendarDays },
                            { label: "Pending decisions", value: pending.length, icon: AlertTriangle },
                            { label: "Planned classes", value: previewError ? "—" : String(preview.length), icon: CheckCircle2 },
                        ].map((item) => (
                            <div key={item.label} className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
                                <item.icon className="size-5 text-primary" aria-hidden="true" />
                                <p className="mt-3 text-xs text-muted-foreground">{item.label}</p>
                                <p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p>
                            </div>
                        ))}
                    </section>

                    <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <h2 className="text-base font-semibold">Events & admin decisions</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    One event covers the selected branch on that date. Affected class groups follow the chosen decision.
                                </p>
                            </div>
                            <span className="text-xs text-muted-foreground">{events.length} records</span>
                        </div>

                        {events.length === 0 ? (
                            <div className="mt-4 rounded-lg bg-muted/30 px-4 py-8 text-center">
                                <CalendarOff className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                                <p className="mt-3 font-medium">No events recorded for this month</p>
                                <p className="mt-1 text-sm text-muted-foreground">Use Add event below if NextGen plans a holiday or activity.</p>
                            </div>
                        ) : (
                            <div className="mt-4 divide-y rounded-lg border">
                                {events.map((event) => {
                                    const relevantTemplates = templates.filter((t) =>
                                        getMonthlyTeachingCycle(year, monthNumber, t.day_of_week).regularDates.includes(event.closed_on)
                                    )
                                    return (
                                        <article key={event.id} className="space-y-3 p-4">
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div>
                                                    <p className="font-semibold">{event.title}</p>
                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        {formatDate(event.closed_on)} · <span className="capitalize">{event.event_type}</span>
                                                        {" · "}{relevantTemplates.length} regular class templates affected
                                                    </p>
                                                    {event.notes && <p className="mt-2 text-sm text-muted-foreground">{event.notes}</p>}
                                                </div>
                                                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusStyle(event.decision)}`}>
                                                    {event.decision === "move" ? "Move class" : event.decision === "skip" ? "Skip class"
                                                        : event.decision === "withdrawn" ? "Withdrawn" : "Pending"}
                                                </span>
                                            </div>
                                            {event.decision === "move" && event.target_on && (
                                                <p className="text-sm font-medium text-primary">New class date: {formatDate(event.target_on)}</p>
                                            )}
                                            {frozen ? (
                                                <p className="text-xs text-muted-foreground">Decisions are read-only for an approved/locked month.</p>
                                            ) : (
                                                <CalendarDecisionForm
                                                    eventId={event.id}
                                                    initialDecision={event.decision as CalendarDecision}
                                                    initialTarget={event.target_on}
                                                />
                                            )}
                                        </article>
                                    )
                                })}
                            </div>
                        )}
                    </section>

                    {!frozen && (
                        <details className="group overflow-hidden rounded-xl border bg-card" open={events.length === 0}>
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-5">
                                <span className="flex items-center gap-2 font-semibold">
                                    <Plus className="size-4 text-primary" aria-hidden="true" />
                                    Add calendar event
                                </span>
                                <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                            </summary>
                            <div className="border-t p-4 sm:p-5">
                                <p className="mb-4 text-sm text-muted-foreground">
                                    Events begin as Pending. NextGen will not assume a move or skip until you explicitly decide.
                                </p>
                                <form action={createCalendarEvent} className="grid gap-4 sm:grid-cols-2">
                                    <input type="hidden" name="branch_id" value={branchId} />
                                    <label className="block">
                                        <span className="mb-1.5 block text-sm font-medium">Title *</span>
                                        <input type="text" name="title" required minLength={3} maxLength={160}
                                            placeholder="e.g. NextGen robotics event"
                                            className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm" />
                                    </label>
                                    <label className="block">
                                        <span className="mb-1.5 block text-sm font-medium">Date *</span>
                                        <input type="date" name="closed_on" required min={start} max={lastDate}
                                            className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm" />
                                    </label>
                                    <label className="block">
                                        <span className="mb-1.5 block text-sm font-medium">Event type *</span>
                                        <select name="event_type" defaultValue="event" required
                                            className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm">
                                            <option value="event">NextGen event</option>
                                            <option value="holiday">Holiday</option>
                                            <option value="closure">Branch closure</option>
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className="mb-1.5 block text-sm font-medium">Notes (optional)</span>
                                        <input type="text" name="notes" maxLength={1000}
                                            placeholder="Why classes are affected"
                                            className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm" />
                                    </label>
                                    <div className="sm:col-span-2">
                                        <FormSubmit>Add event</FormSubmit>
                                    </div>
                                </form>
                            </div>
                        </details>
                    )}

                    <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
                        <div className="p-4 sm:p-5">
                            <h2 className="text-base font-semibold">Preview class dates</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Read-only preview using current session templates and calendar decisions.
                                Week numbers stay attached to their original lessons.
                            </p>
                        </div>
                        {previewError ? (
                            <div className="border-t bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-300">
                                <AlertTriangle className="mr-2 inline size-4" aria-hidden="true" />
                                {previewError}
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-3 border-t p-4 sm:grid-cols-3 sm:p-5">
                                    <div><p className="text-xs text-muted-foreground">Original classes</p>
                                        <p className="mt-1 text-xl font-semibold tabular-nums">{baseCount}</p></div>
                                    <div><p className="text-xs text-muted-foreground">After decisions</p>
                                        <p className="mt-1 text-xl font-semibold tabular-nums">{preview.length}</p></div>
                                    <div><p className="text-xs text-muted-foreground">Skipped class sessions</p>
                                        <p className="mt-1 text-xl font-semibold tabular-nums">{baseCount - preview.length}</p></div>
                                </div>
                                <details className="group border-t">
                                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 text-sm font-semibold sm:px-5">
                                        View all class dates
                                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                                    </summary>
                                    <TableScrollArea label="Academic Calendar class preview">
                                        <table className="w-full min-w-[42rem] text-sm">
                                            <thead className="bg-muted/40 text-xs text-muted-foreground">
                                                <tr className="border-b">
                                                    {["Scheduled date", "Week", "Programme", "Time", "Change"].map((name) =>
                                                        <th key={name} className="px-5 py-3 text-left font-medium" scope="col">{name}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sorted.map((item) => {
                                                    const template = templates.find((t) => t.id === item.session_template_id)
                                                    const original = template
                                                        ? getMonthlyDatesForDay(year, monthNumber, template.day_of_week)[item.week_number - 1]
                                                        : item.class_date
                                                    return (
                                                        <tr key={`${item.session_template_id}-${item.class_date}`} className="border-b last:border-0">
                                                            <td className="px-5 py-3 font-medium">{formatDate(item.class_date)}</td>
                                                            <td className="px-5 py-3">W{item.week_number}</td>
                                                            <td className="px-5 py-3">{programmes.get(item.programme_id) ?? "Unknown"}</td>
                                                            <td className="px-5 py-3">{item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}</td>
                                                            <td className="px-5 py-3">{original !== item.class_date
                                                                ? <span className="text-primary">Moved from {formatDate(original)}</span>
                                                                : <span className="text-muted-foreground">Regular</span>}</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </TableScrollArea>
                                </details>
                            </>
                        )}
                    </section>
                </>
            )}
            {!branchId && (
                <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                    Add a branch in Class Settings before planning the Academic Calendar.
                </p>
            )}
        </div>
    )
}
