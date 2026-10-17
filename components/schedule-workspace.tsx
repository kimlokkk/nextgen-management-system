"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, CalendarDays, CheckCircle2, LockKeyhole, Search, SlidersHorizontal } from "lucide-react"
import { TableScrollArea } from "@/components/table-scroll-area"

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
    start: string
    end: string
    regularUsed: number
    regularCapacity: number
    yellowUsed: number
    yellowCapacity: number
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

export function ScheduleClassList({ classes }: { classes: ScheduleClassSummary[] }) {
    const [search, setSearch] = useState("")
    const [programme, setProgramme] = useState("all")
    const [week, setWeek] = useState("all")
    const programmes = useMemo(() => [...new Set(classes.map((item) => item.programme))].sort(), [classes])
    const weeks = useMemo(() => [...new Set(classes.map((item) => item.week))].sort((a, b) => a - b), [classes])

    const visible = useMemo(() => classes.filter((item) =>
        (programme === "all" || item.programme === programme)
        && (week === "all" || String(item.week) === week)
        && [item.date, item.programme, item.start, item.end].join(" ")
            .toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ), [classes, programme, week, search])

    return (
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-col gap-3 border-b p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">Class sessions</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {visible.length} shown · {classes.length} total · Select a class to review its students and attendance
                        </p>
                    </div>
                    <SlidersHorizontal className="size-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.75fr)]">
                    <label className="relative block">
                        <span className="sr-only">Search class sessions</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search date or class"
                            className="h-10 w-full min-w-0 rounded-lg border bg-background pl-9 pr-3 text-sm" />
                    </label>
                    <label>
                        <span className="sr-only">Filter by programme</span>
                        <select value={programme} onChange={(e) => setProgramme(e.target.value)}
                            className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm">
                            <option value="all">All programmes</option>
                            {programmes.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </label>
                    <label>
                        <span className="sr-only">Filter by week</span>
                        <select value={week} onChange={(e) => setWeek(e.target.value)}
                            className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm">
                            <option value="all">All weeks</option>
                            {weeks.map((item) => <option key={item} value={item}>Week {item}</option>)}
                        </select>
                    </label>
                </div>
            </div>
            {visible.length === 0 ? (
                <div className="px-5 py-10 text-center">
                    <p className="font-medium">{classes.length ? "No classes match these filters" : "No classes in this schedule"}</p>
                    <p className="mt-2 text-sm text-muted-foreground">{classes.length ? "Change the search, programme or week." : "Review the schedule generation settings."}</p>
                    {classes.length > 0 && <button type="button" onClick={() => { setSearch(""); setProgramme("all"); setWeek("all") }}
                        className="ui-secondary-action mt-4">Clear filters</button>}
                </div>
            ) : (
                <>
                    <div className="divide-y lg:hidden">
                        {visible.map((item) => (
                            <article key={item.id} className="space-y-3 p-4 sm:p-5">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-semibold">{item.programme}</p>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {formatDate(item.date)} · {item.start.slice(0, 5)}–{item.end.slice(0, 5)}
                                        </p>
                                    </div>
                                    <span className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs font-medium">W{item.week}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-sm">
                                    <div><p className="mb-1 text-xs text-muted-foreground">Regular seats</p>
                                        <Capacity used={item.regularUsed} maximum={item.regularCapacity} label="Regular" /></div>
                                    <div><p className="mb-1 text-xs text-muted-foreground">Yellow seats</p>
                                        <Capacity used={item.yellowUsed} maximum={item.yellowCapacity} label="Yellow" /></div>
                                </div>
                                <Link href={`/schedule/sessions/${item.id}`} className="ui-primary-action flex w-full items-center justify-between">
                                    Review class <ArrowRight className="size-4" aria-hidden="true" />
                                </Link>
                            </article>
                        ))}
                    </div>
                    <div className="hidden min-w-0 lg:block">
                        <TableScrollArea label="Class sessions">
                            <table className="w-full min-w-[50rem] text-sm">
                                <thead className="bg-muted/40 text-xs text-muted-foreground">
                                    <tr className="border-b">
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Date / Time</th>
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Programme</th>
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Week</th>
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Regular</th>
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Yellow</th>
                                        <th scope="col" className="px-5 py-3 text-right font-medium">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map((item) => (
                                        <tr key={item.id} className="border-b last:border-0">
                                            <td className="px-5 py-4">
                                                <p className="font-semibold">{formatDate(item.date)}</p>
                                                <p className="mt-1 text-xs text-muted-foreground">{item.start.slice(0, 5)}–{item.end.slice(0, 5)}</p>
                                            </td>
                                            <td className="px-5 py-4 font-medium">{item.programme}</td>
                                            <td className="px-5 py-4">W{item.week}</td>
                                            <td className="px-5 py-4"><Capacity used={item.regularUsed} maximum={item.regularCapacity} label="Regular" /></td>
                                            <td className="px-5 py-4"><Capacity used={item.yellowUsed} maximum={item.yellowCapacity} label="Yellow" /></td>
                                            <td className="px-5 py-4 text-right">
                                                <Link href={`/schedule/sessions/${item.id}`} className="ui-action-link">
                                                    Review <ArrowRight className="size-4" aria-hidden="true" />
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
