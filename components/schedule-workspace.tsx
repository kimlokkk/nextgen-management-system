"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, CalendarDays, CheckCircle2, LockKeyhole, Search, ChevronDown, Clock3, LayoutGrid } from "lucide-react"
import { TableScrollArea } from "@/components/table-scroll-area"
import { compactSessionTemplateLabel } from "@/lib/schedule-display"

export type ScheduleBatchSummary = {
    id: string
    month: string
    branch: string
    status: string
    generatedAt: string | null
}

export type ScheduleClassSummary = {
    id: string
    date: string
    week: number
    programme: string
    templateLabel?: string
    start: string
    end: string
    regularUsed: number
    regularCapacity: number
    yellowUsed: number
    yellowCapacity: number
    legacyBooked?: number
    modernYellowUsed?: number
}

export function ScheduleStatus({ status }: { status: string }) {
    const styles: Record<string, string> = {
        draft: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        approved: "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300",
        locked: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    }
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${styles[status] ?? "border-border bg-muted text-muted-foreground"}`}>
            {status === "locked" ? <LockKeyhole className="size-3.5" aria-hidden="true" />
                : status === "approved" ? <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    : <CalendarDays className="size-3.5" aria-hidden="true" />}
            {status}
        </span>
    )
}

function formatDate(value: string) {
    const parsed = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) return value
    return new Intl.DateTimeFormat("en-MY", {
        weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
    }).format(parsed)
}

function Capacity({ used, maximum, label }: { used: number; maximum: number; label: string }) {
    const over = used > maximum
    const full = maximum > 0 && used === maximum
    return (
        <span aria-label={`${label}: ${used} of ${maximum} seats occupied`}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium tabular-nums ${over ? "text-destructive" : "text-foreground"}`}>
            {used} / {maximum}
            {over && <span className="text-xs font-semibold">Over</span>}
            {!over && full && <span className="text-xs text-amber-700 dark:text-amber-300">Full</span>}
        </span>
    )
}

export function ScheduleBatchLibrary({ batches, selectedId }: {
    batches: ScheduleBatchSummary[]
    selectedId: string | null
}) {
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState("all")

    const visible = useMemo(() => batches.filter((batch) => {
        const terms = [batch.month, batch.branch, batch.status].join(" ").toLocaleLowerCase()
        return (filter === "all" || batch.status === filter)
            && terms.includes(search.trim().toLocaleLowerCase())
    }), [batches, filter, search])

    return (
        <section id="schedule-library" className="min-w-0 overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                    <h2 className="text-base font-semibold">Monthly schedules</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {visible.length} shown · {batches.length} total · Select a month to review
                    </p>
                </div>
                <label className="relative block w-full sm:max-w-64">
                    <span className="sr-only">Search monthly schedules</span>
                    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search month or branch"
                        className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm" />
                </label>
            </div>
            <div className="flex flex-wrap gap-2 border-b px-4 py-3 sm:px-5" role="group" aria-label="Filter schedule status">
                {["all", "draft", "approved", "locked"].map((status) => (
                    <button type="button" key={status} onClick={() => setFilter(status)}
                        aria-pressed={status === filter}
                        className={`min-h-9 rounded-lg border px-3 text-xs font-medium capitalize transition-colors ${status === filter
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                        {status}
                    </button>
                ))}
            </div>
            {visible.length === 0 ? (
                <div className="px-5 py-10 text-center">
                    <p className="text-sm font-semibold">{batches.length ? "No matching schedules" : "No schedules yet"}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {batches.length ? "Try a different month, branch or filter." : "Generate your first monthly schedule below."}
                    </p>
                    {batches.length > 0 && <button type="button" className="ui-secondary-action mt-4"
                        onClick={() => { setSearch(""); setFilter("all") }}>Clear filters</button>}
                </div>
            ) : (
                <>
                    <div className="divide-y lg:hidden">
                        {visible.map((batch) => (
                            <article key={batch.id} className={`p-4 sm:p-5 ${selectedId === batch.id ? "bg-primary/5" : ""}`}>
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="font-semibold">{batch.month}</p>
                                        <p className="mt-1 text-sm text-muted-foreground">{batch.branch}</p>
                                    </div>
                                    <ScheduleStatus status={batch.status} />
                                </div>
                                <Link href={`/schedule?batch=${batch.id}`}
                                    className="ui-secondary-action mt-3 flex w-full items-center justify-between">
                                    {selectedId === batch.id ? "Viewing this schedule" : "Review schedule"}
                                    <ArrowRight className="size-4" aria-hidden="true" />
                                </Link>
                            </article>
                        ))}
                    </div>
                    <div className="hidden min-w-0 lg:block">
                        <TableScrollArea label="Monthly schedule library">
                            <table className="w-full min-w-[42rem] text-sm">
                                <thead className="bg-muted/40 text-xs text-muted-foreground">
                                    <tr className="border-b">
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Month</th>
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Branch</th>
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Status</th>
                                        <th scope="col" className="px-5 py-3 text-right font-medium">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map((batch) => (
                                        <tr key={batch.id} className={`border-b last:border-0 ${selectedId === batch.id ? "bg-primary/5" : ""}`}>
                                            <td className="px-5 py-4 font-semibold">{batch.month}</td>
                                            <td className="px-5 py-4">{batch.branch}</td>
                                            <td className="px-5 py-4"><ScheduleStatus status={batch.status} /></td>
                                            <td className="px-5 py-4 text-right">
                                                <Link href={`/schedule?batch=${batch.id}`} className="ui-action-link">
                                                    {selectedId === batch.id ? "Viewing" : "Review"}
                                                    <ArrowRight className="size-4" aria-hidden="true" />
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScrollArea>
                    </div>
                </>
            )}
        </section>
    )
}


/**
 * Compact, week-first schedule board. Admins see one teaching week at a time
 * rather than 48+ flat rows. Searching searches the whole month.
 * The lesson's W number remains authoritative even when its date is moved.
 */
function getDayLabel(date: string) {
    return new Intl.DateTimeFormat("en-MY", {
        timeZone: "UTC", weekday: "long",
    }).format(new Date(date + "T00:00:00Z"))
}

function groupByDateAndTime(items: ScheduleClassSummary[]) {
    const dates = new Map<string, Map<string, ScheduleClassSummary[]>>()
    for (const item of items) {
        const times = dates.get(item.date) ?? new Map<string, ScheduleClassSummary[]>()
        const key = item.start + "|" + item.end
        const slot = times.get(key) ?? []
        slot.push(item)
        times.set(key, slot)
        dates.set(item.date, times)
    }

    return [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, slots]) => ({
        date,
        slots: [...slots].sort(([a], [b]) => a.localeCompare(b)).map(([time, classes]) => ({
            time,
            classes: [...classes].sort((a, b) =>
                a.programme.localeCompare(b.programme) || (a.templateLabel ?? "").localeCompare(b.templateLabel ?? "")
            ),
        })),
    }))
}

export function ScheduleClassList({ classes }: { classes: ScheduleClassSummary[] }) {
    const [selectedWeek, setSelectedWeek] = useState<string>("1")
    const [day, setDay] = useState("all")
    const [programme, setProgramme] = useState("all")
    const [search, setSearch] = useState("")
    const [showAllWeeks, setShowAllWeeks] = useState(false)

    const weeks = useMemo(() => [...new Set(classes.map((item) => item.week))].sort((a, b) => a - b), [classes])
    const programmes = useMemo(() => [...new Set(classes.map((item) => item.programme))].sort(), [classes])
    const days = useMemo(() => [...new Set(classes.map((item) => getDayLabel(item.date)))], [classes])
    const activeWeek = weeks.some((week) => String(week) === selectedWeek) ? selectedWeek : String(weeks[0] ?? 1)
    const isSearching = search.trim().length > 0
    const allWeeks = showAllWeeks || isSearching
    const query = search.trim().toLocaleLowerCase()

    const visible = useMemo(() => classes.filter((item) =>
        (allWeeks || String(item.week) === activeWeek)
        && (day === "all" || getDayLabel(item.date) === day)
        && (programme === "all" || item.programme === programme)
        && (!query || [
            formatDate(item.date), item.date, item.programme,
            item.templateLabel ?? "", item.start, item.end,
            "w" + item.week, "week " + item.week,
        ].some((value) => value.toLocaleLowerCase().includes(query)))
    ), [classes, allWeeks, activeWeek, day, programme, query])

    const groups = useMemo(() => groupByDateAndTime(visible), [visible])
    const regularUsed = visible.reduce((total, item) => total + item.regularUsed, 0)
    const yellowUsed = visible.reduce((total, item) => total + item.yellowUsed, 0)

    const resetFilters = () => {
        setSearch("")
        setProgramme("all")
        setDay("all")
        setSelectedWeek(String(weeks[0] ?? 1))
        setShowAllWeeks(false)
    }

    return (
        <section id="schedule-class-board" className="min-w-0 overflow-hidden rounded-xl border bg-card">
            <div className="space-y-4 border-b p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <LayoutGrid className="size-5 text-primary" aria-hidden="true" />
                            <h2 className="text-base font-semibold">Class timetable</h2>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Choose a week, then review classes by day and time. No need to scroll through the whole month.
                        </p>
                    </div>
                    <span className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                        {classes.length} classes this month
                    </span>
                </div>

                <nav aria-label="Teaching week" className="flex flex-wrap gap-2">
                    {weeks.map((week) => {
                        const count = classes.filter((item) => item.week === week).length
                        const active = !allWeeks && activeWeek === String(week)
                        return (
                            <button key={week} type="button"
                                aria-pressed={active}
                                onClick={() => { setSelectedWeek(String(week)); setShowAllWeeks(false); setSearch("") }}
                                className={active
                                    ? "min-h-11 rounded-lg border border-primary bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground"
                                    : "min-h-11 rounded-lg border bg-background px-3.5 py-2 text-sm font-medium hover:bg-muted"}>
                                W{week} <span className={active ? "ml-1 text-xs opacity-85" : "ml-1 text-xs text-muted-foreground"}>{count} classes</span>
                            </button>
                        )
                    })}
                    <button type="button" aria-pressed={allWeeks && !isSearching}
                        onClick={() => { setShowAllWeeks(true); setSearch("") }}
                        className={allWeeks && !isSearching
                            ? "min-h-11 rounded-lg border border-primary bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground"
                            : "min-h-11 rounded-lg border bg-background px-3.5 py-2 text-sm font-medium hover:bg-muted"}>
                        All weeks
                    </button>
                </nav>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
                    <label className="relative block">
                        <span className="sr-only">Search all class dates, times and programmes</span>
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search all weeks, dates or sessions"
                            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm" />
                    </label>
                    <label>
                        <span className="sr-only">Filter classes by day</span>
                        <select value={day} onChange={(e) => setDay(e.target.value)}
                            className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                            <option value="all">All days</option>
                            {days.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </label>
                    <label>
                        <span className="sr-only">Filter classes by programme</span>
                        <select value={programme} onChange={(e) => setProgramme(e.target.value)}
                            className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                            <option value="all">All programmes</option>
                            {programmes.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span aria-live="polite">
                        {isSearching ? "Searching the whole month" : allWeeks ? "All weeks" : "Week " + activeWeek}
                        {" · "}{visible.length} classes · {regularUsed} regular bookings · {yellowUsed} yellow bookings
                    </span>
                    {(day !== "all" || programme !== "all" || query || showAllWeeks) && (
                        <button type="button" onClick={resetFilters}
                            className="font-semibold text-primary hover:underline">
                            Reset view
                        </button>
                    )}
                </div>
            </div>

            {groups.length === 0 ? (
                <div className="p-8 text-center">
                    <p className="font-semibold">{classes.length ? "No classes match this view" : "No classes in this schedule"}</p>
                    <p className="mt-2 text-sm text-muted-foreground">Try another week, day or programme.</p>
                    {classes.length > 0 && (
                        <button type="button" onClick={resetFilters}
                            className="ui-secondary-action mt-4">Show first week</button>
                    )}
                </div>
            ) : (
                <div className="space-y-3 bg-muted/20 p-3 sm:p-4">
                    {groups.map((group) => {
                        const dayClasses = group.slots.flatMap((slot) => slot.classes)
                        const dayRegular = dayClasses.reduce((total, item) => total + item.regularUsed, 0)
                        return (
                            <details key={group.date + (allWeeks ? ":all" : ":week")} open={!allWeeks}
                                className="group min-w-0 overflow-hidden rounded-xl border bg-card">
                                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3.5 sm:px-5 [&::-webkit-details-marker]:hidden">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                            <CalendarDays className="size-5" aria-hidden="true" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold">{formatDate(group.date)}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {dayClasses.length} classes · {dayRegular} regular bookings
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                                            W{[...new Set(dayClasses.map((item) => item.week))].join(", W")}
                                        </span>
                                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                                    </div>
                                </summary>
                                <div className="divide-y border-t">
                                    {group.slots.map((slot) => (
                                        <div key={slot.time} className="p-3 sm:px-5 sm:py-4">
                                            <div className="mb-2 flex items-center justify-between gap-2">
                                                <p className="flex items-center gap-2 text-sm font-semibold">
                                                    <Clock3 className="size-4 text-primary" aria-hidden="true" />
                                                    {slot.classes[0].start.slice(0, 5)}–{slot.classes[0].end.slice(0, 5)}
                                                </p>
                                                <span className="text-xs text-muted-foreground">
                                                    {slot.classes.length} {slot.classes.length === 1 ? "class" : "parallel classes"}
                                                </span>
                                            </div>
                                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                                {slot.classes.map((item) => (
                                                    <article key={item.id} className="min-w-0 rounded-lg border bg-background p-3">
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-semibold">{item.programme}</p>
                                                            {item.templateLabel && (
                                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                                    {compactSessionTemplateLabel(item.templateLabel)}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                                            <span>Regular <Capacity used={item.regularUsed} maximum={item.regularCapacity} label="Regular" /></span>
                                                            <span>Yellow <Capacity used={item.yellowUsed} maximum={item.yellowCapacity} label="Yellow" /></span>
                                                        </div>
                                                        {!!item.legacyBooked && (
                                                            <div className="mt-2 space-y-1">
                                                                <p className="text-xs font-medium text-muted-foreground">
                                                                    {item.legacyBooked} Excel legacy + {item.modernYellowUsed ?? 0} active
                                                                    {" · "}{Math.max(0, item.yellowCapacity - item.yellowUsed)} seats left
                                                                </p>
                                                                {item.yellowUsed > item.yellowCapacity && (
                                                                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                                                                        {item.yellowUsed - item.yellowCapacity} seat(s) over capacity · admin decision required
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                        <Link href={"/schedule/sessions/" + item.id}
                                                            className="ui-action-link mt-2 w-full justify-between border bg-card">
                                                            Review class <ArrowRight className="size-4" aria-hidden="true" />
                                                        </Link>
                                                    </article>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )
                    })}
                    {allWeeks && !isSearching && (
                        <p className="px-2 pb-2 text-xs text-muted-foreground">
                            Dates are collapsed in All weeks view. Open a day to review its sessions.
                        </p>
                    )}
                </div>
            )}
        </section>
    )
}
