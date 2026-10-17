"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { TableScrollArea } from "@/components/table-scroll-area"
import {
    ArrowRight,
    CalendarClock,
    CalendarDays,
    CheckCircle2,
    Clock3,
    Search,
} from "lucide-react"

export type QueueEntry = {
    id: string
    student: string
    programme: string
    branch: string
    originalDate: string
    originalTime: string
    status: string
    destination?: string | null
    attendance?: string
}

type Kind = "reschedule" | "replacement"
type Filter = "all" | "open" | "scheduled" | "history"

function prettyDate(date: string) {
    if (!date) return "Date unavailable"
    const parsed = new Date(date + "T00:00:00Z")
    if (Number.isNaN(parsed.getTime())) return date
    return new Intl.DateTimeFormat("en-MY", {
        day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    }).format(parsed)
}

function Status({ status }: { status: string }) {
    const labels: Record<string, string> = {
        open: "Needs assignment",
        scheduled: "Scheduled",
        completed: "Completed",
        cancelled: "Cancelled",
    }
    const icon = status === "completed" ? <CheckCircle2 className="size-3.5" aria-hidden="true" />
        : status === "open" ? <Clock3 className="size-3.5" aria-hidden="true" />
            : <CalendarClock className="size-3.5" aria-hidden="true" />

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${status === "open"
            ? "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            : status === "completed"
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : status === "scheduled"
                    ? "border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-300"
                    : status === "cancelled"
                        ? "border-rose-500/25 bg-rose-500/10 text-rose-800 dark:text-rose-300"
                        : "border-border bg-muted/50 text-foreground/80"}`}>
            {icon}
            {labels[status] ?? status}
        </span>
    )
}

const filterOptions: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "open", label: "To assign" },
    { value: "scheduled", label: "Scheduled" },
    { value: "history", label: "History" },
]

export function QueueOverview({ kind, entries }: { kind: Kind; entries: QueueEntry[] }) {
    const [filter, setFilter] = useState<Filter>("all")
    const [search, setSearch] = useState("")
    const isReplacement = kind === "replacement"
    const base = isReplacement ? "/replacements" : "/reschedules"
    const pending = entries.filter((entry) => entry.status === "open").length
    const scheduled = entries.filter((entry) => entry.status === "scheduled").length
    const history = entries.filter((entry) => ["completed", "cancelled"].includes(entry.status)).length

    const visible = useMemo(() => {
        const q = search.trim().toLocaleLowerCase()
        const priority: Record<string, number> = { open: 0, scheduled: 1, completed: 2, cancelled: 3 }
        return entries
            .filter((entry) => {
                const matchesStatus = filter === "all" || (filter === "history"
                    ? ["completed", "cancelled"].includes(entry.status)
                    : entry.status === filter)
                const searchable = [entry.student, entry.programme, entry.branch, entry.originalDate,
                    entry.originalTime, entry.status, entry.destination ?? ""].join(" ").toLocaleLowerCase()
                return matchesStatus && (!q || searchable.includes(q))
            })
            .sort((a, b) => (priority[a.status] ?? 4) - (priority[b.status] ?? 4)
                || a.originalDate.localeCompare(b.originalDate)
                || a.originalTime.localeCompare(b.originalTime)
                || a.student.localeCompare(b.student))
    }, [entries, filter, search])

    const primaryAction = (entry: QueueEntry) => entry.status === "open"
        ? isReplacement ? "Assign yellow slot" : "Choose new class"
        : "View details"

    return (
        <div className="space-y-6">
            <div>
                <p className="text-sm text-muted-foreground">Class operations</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                    {isReplacement ? "Replacements" : "Reschedules"}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {isReplacement
                        ? "Manage missed classes and assign yellow seats. An open request still needs a class."
                        : "Manage changes to regular classes. Open requests are waiting for a new class."}
                </p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-4" aria-label="Request summary">
                {[
                    { label: "To assign", value: pending, description: "Need a slot" },
                    { label: "Scheduled", value: scheduled, description: "Class assigned" },
                    { label: "History", value: history, description: "Done or cancelled" },
                ].map((item) => (
                    <div key={item.label} className="rounded-xl border bg-card p-3 sm:p-5">
                        <p className="text-[11px] font-medium text-muted-foreground sm:text-sm">{item.label}</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">{item.value}</p>
                        <p className="mt-1 hidden text-xs text-muted-foreground sm:block">{item.description}</p>
                    </div>
                ))}
            </div>

            <section aria-label="Request records" className="overflow-hidden rounded-xl border bg-card">
                <div className="space-y-3 border-b p-4 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:space-y-0 sm:p-5">
                    <div>
                        <h2 className="text-sm font-semibold">Requests</h2>
                        <p className="text-xs text-muted-foreground">
                            {visible.length} shown · {entries.length} total
                        </p>
                    </div>
                    <label className="relative block w-full sm:max-w-xs">
                        <span className="sr-only">Search requests by student or programme</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search student or class"
                            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground"
                        />
                    </label>
                </div>

                <div className="flex flex-wrap gap-2 border-b px-4 py-3 sm:px-5" role="group" aria-label="Filter requests">
                    {filterOptions.map((option) => (
                        <button key={option.value} type="button"
                            aria-pressed={filter === option.value}
                            onClick={() => setFilter(option.value)}
                            className={`min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${filter === option.value
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                {visible.length === 0 ? (
                    <div className="flex flex-col items-center px-5 py-12 text-center">
                        <CalendarDays className="size-8 text-muted-foreground/60" aria-hidden="true" />
                        <p className="mt-3 text-sm font-medium">
                            {entries.length === 0 ? "No requests yet" : "No matching requests"}
                        </p>
                        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                            {entries.length === 0
                                ? "Requests will appear here when an admin marks a class for reschedule or replacement."
                                : "Try another filter or search term."}
                        </p>
                        {entries.length > 0 && (
                            <button type="button" className="ui-secondary-action mt-4"
                                onClick={() => { setFilter("all"); setSearch("") }}>
                                Clear filters
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Mobile and tablet: all essential information and actions stay visible. */}
                        <div className="divide-y lg:hidden">
                            {visible.map((entry) => (
                                <article key={entry.id} className="space-y-3 p-4 sm:p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <h3 className="text-base font-semibold leading-6">{entry.student}</h3>
                                            <p className="mt-0.5 text-sm text-muted-foreground">
                                                {entry.programme} · {entry.branch}
                                            </p>
                                        </div>
                                        <Status status={entry.status} />
                                    </div>

                                    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/35 p-3 text-sm">
                                        <div className="min-w-0">
                                            <dt className="text-xs text-muted-foreground">Original class</dt>
                                            <dd className="mt-1 font-medium">{prettyDate(entry.originalDate)}</dd>
                                            <dd className="text-muted-foreground">{entry.originalTime || "Time unavailable"}</dd>
                                        </div>
                                        <div className="min-w-0">
                                            <dt className="text-xs text-muted-foreground">
                                                {isReplacement ? "Replacement slot" : "New class"}
                                            </dt>
                                            <dd className="mt-1 font-medium break-words">
                                                {entry.destination || (entry.status === "open" ? "Not assigned" : "—")}
                                            </dd>
                                            {entry.attendance && (
                                                <dd className="mt-1 text-xs text-muted-foreground">{entry.attendance}</dd>
                                            )}
                                        </div>
                                    </dl>

                                    <Link href={`${base}/${entry.id}`}
                                        className={entry.status === "open"
                                            ? "ui-primary-action flex w-full justify-between"
                                            : "ui-secondary-action flex w-full justify-between"}>
                                        {primaryAction(entry)}
                                        <ArrowRight className="size-4" aria-hidden="true" />
                                    </Link>
                                </article>
                            ))}
                        </div>

                        {/* Desktop: compact scanning table, with a separate action column. */}
                        <div className="hidden min-w-0 lg:block">
                            <TableScrollArea label={isReplacement ? "Replacement queue" : "Reschedule queue"}>
                                <table className="w-full min-w-[58rem] text-sm">
                                <thead className="bg-muted/40 text-xs text-muted-foreground">
                                    <tr className="border-b">
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Student / Class</th>
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Original class</th>
                                        <th scope="col" className="px-5 py-3 text-left font-medium">
                                            {isReplacement ? "Replacement slot" : "New class"}
                                        </th>
                                        <th scope="col" className="px-5 py-3 text-left font-medium">Status</th>
                                        <th scope="col" className="px-5 py-3 text-right font-medium">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map((entry) => (
                                        <tr key={entry.id} className="border-b last:border-0">
                                            <td className="px-5 py-4">
                                                <p className="font-semibold">{entry.student}</p>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {entry.programme} · {entry.branch}
                                                </p>
                                            </td>
                                            <td className="px-5 py-4">
                                                <p className="font-medium">{prettyDate(entry.originalDate)}</p>
                                                <p className="mt-1 text-xs text-muted-foreground">{entry.originalTime}</p>
                                            </td>
                                            <td className="px-5 py-4">
                                                <p>{entry.destination || (entry.status === "open" ? "Not assigned" : "—")}</p>
                                                {entry.attendance && (
                                                    <p className="mt-1 text-xs text-muted-foreground">{entry.attendance}</p>
                                                )}
                                            </td>
                                            <td className="px-5 py-4"><Status status={entry.status} /></td>
                                            <td className="px-5 py-4 text-right">
                                                <Link href={`${base}/${entry.id}`}
                                                    className={entry.status === "open" ? "ui-primary-action" : "ui-secondary-action"}>
                                                    {primaryAction(entry)}
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
        </div>
    )
}
