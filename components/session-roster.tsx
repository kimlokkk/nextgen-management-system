"use client"

import { useMemo, useState, type ReactNode } from "react"
import { useFormStatus } from "react-dom"
import { ArrowRight, Check, LoaderCircle, Search, UsersRound } from "lucide-react"
import { TableScrollArea } from "@/components/table-scroll-area"

export type SessionRosterEntry = {
    id: string
    student: string
    type: string
    laptop: string
    enrollment: string
    attendance: string
    attendanceActions: ReactNode
    followupActions: ReactNode
}

type Tone = "present" | "absent" | "secondary" | "warning"

export function RosterActionSubmit({ label, tone = "secondary" }: { label: string; tone?: Tone }) {
    const { pending } = useFormStatus()
    const colors: Record<Tone, string> = {
        present: "border-primary bg-primary/10 text-primary hover:bg-primary/15",
        absent: "border-amber-500/35 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300",
        secondary: "border-border bg-background text-foreground hover:bg-accent",
        warning: "border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300",
    }
    return (
        <button type="submit" disabled={pending} aria-busy={pending}
            className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${colors[tone]}`}>
            {pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                : tone === "present" ? <Check className="size-3.5" aria-hidden="true" /> : null}
            {pending ? "Saving…" : label}
        </button>
    )
}

function AttendanceTag({ value }: { value: string }) {
    const status = value.toLowerCase()
    const label = status === "upcoming" ? "Unmarked" : status.replaceAll("_", " ")
    const style = status === "present"
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
        : status === "absent"
            ? "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            : status === "upcoming"
                ? "border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-300"
                : "border-border bg-muted text-muted-foreground"
    return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${style}`}>{label}</span>
}

const filters = [
    { value: "all", label: "All" },
    { value: "upcoming", label: "Unmarked" },
    { value: "present", label: "Present" },
    { value: "absent", label: "Absent" },
    { value: "other", label: "Other" },
] as const

export function SessionRoster({ entries }: { entries: SessionRosterEntry[] }) {
    const [query, setQuery] = useState("")
    const [filter, setFilter] = useState<string>("all")
    const [type, setType] = useState("all")
    const types = useMemo(() => [...new Set(entries.map((entry) => entry.type))].sort(), [entries])
    const counts = useMemo(() => ({
        upcoming: entries.filter((item) => item.attendance === "upcoming").length,
        present: entries.filter((item) => item.attendance === "present").length,
        absent: entries.filter((item) => item.attendance === "absent").length,
    }), [entries])
    const visible = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase()
        return entries.filter((entry) => {
            const searchText = [entry.student, entry.type, entry.laptop, entry.enrollment]
                .join(" ").toLocaleLowerCase()
            const statusMatch = filter === "all"
                || (filter === "other"
                    ? !["upcoming", "present", "absent"].includes(entry.attendance)
                    : entry.attendance === filter)
            return statusMatch
                && (type === "all" || entry.type === type)
                && (!normalized || searchText.includes(normalized))
        })
    }, [entries, query, filter, type])

    return (
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card" aria-label="Class roster and attendance">
            <div className="space-y-4 border-b p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold">Students & attendance</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {visible.length} shown · {entries.length} bookings · Mark each eligible student or review a follow-up
                        </p>
                    </div>
                    {counts.upcoming > 0 && (
                        <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-800 dark:text-sky-300">
                            {counts.upcoming} unmarked
                        </span>
                    )}
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)]">
                    <label className="relative">
                        <span className="sr-only">Search class students</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search students"
                            className="h-10 w-full min-w-0 rounded-lg border bg-background pl-9 pr-3 text-sm" />
                    </label>
                    <label>
                        <span className="sr-only">Filter booking type</span>
                        <select value={type} onChange={(event) => setType(event.target.value)}
                            className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm">
                            <option value="all">All booking types</option>
                            {types.map((value) => <option key={value} value={value} className="capitalize">{value.replaceAll("_", " ")}</option>)}
                        </select>
                    </label>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filter attendance">
                    {filters.map((item) => (
                        <button type="button" key={item.value}
                            aria-pressed={filter === item.value}
                            onClick={() => setFilter(item.value)}
                            className={`min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${filter === item.value
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>

            {visible.length === 0 ? (
                <div className="px-5 py-12 text-center">
                    <UsersRound className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                    <p className="mt-3 font-semibold">{entries.length ? "No matching students" : "No students assigned yet"}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {entries.length ? "Try changing the search or filters." : "Students will appear here when bookings are assigned."}
                    </p>
                    {entries.length > 0 && (
                        <button type="button" onClick={() => { setQuery(""); setFilter("all"); setType("all") }}
                            className="ui-secondary-action mt-4">Clear filters</button>
                    )}
                </div>
            ) : (
                <>
                    <div className="divide-y lg:hidden">
                        {visible.map((entry) => (
                            <article key={entry.id} className="space-y-3 p-4 sm:p-5">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="break-words text-base font-semibold">{entry.student}</h3>
                                        <p className="mt-1 text-xs capitalize text-muted-foreground">
                                            {entry.type.replaceAll("_", " ")} · Laptop: {entry.laptop}
                                        </p>
                                    </div>
                                    <AttendanceTag value={entry.attendance} />
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Enrollment</span>
                                    <span className="text-xs font-medium capitalize">{entry.enrollment}</span>
                                </div>
                                <div className="flex flex-wrap gap-2">{entry.attendanceActions}</div>
                                {entry.followupActions && (
                                    <div className="border-t pt-3">
                                        <p className="mb-2 text-xs font-medium text-muted-foreground">Follow-up</p>
                                        <div className="flex flex-wrap items-center gap-2">{entry.followupActions}</div>
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                    <div className="hidden min-w-0 lg:block">
                        <TableScrollArea label="Class roster">
                            <table className="w-full min-w-[65rem] text-sm">
                                <thead className="bg-muted/40 text-xs text-muted-foreground">
                                    <tr className="border-b">
                                        {["Student", "Type", "Laptop", "Enrollment", "Attendance", "Mark attendance", "Follow-up"].map((label) =>
                                            <th key={label} scope="col" className="px-4 py-3 text-left font-medium">{label}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map((entry) => (
                                        <tr key={entry.id} className="border-b align-top last:border-0">
                                            <td className="px-4 py-4 font-semibold">{entry.student}</td>
                                            <td className="px-4 py-4 capitalize">{entry.type}</td>
                                            <td className="px-4 py-4 capitalize">{entry.laptop}</td>
                                            <td className="px-4 py-4 capitalize">{entry.enrollment}</td>
                                            <td className="px-4 py-4"><AttendanceTag value={entry.attendance} /></td>
                                            <td className="px-4 py-4"><div className="flex flex-wrap gap-2">{entry.attendanceActions}</div></td>
                                            <td className="px-4 py-4"><div className="flex flex-wrap gap-2">{entry.followupActions || "—"}</div></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScrollArea>
                    </div>
                </>
            )}
            <p className="flex items-center gap-2 border-t bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
                <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
                Original reschedules and cancelled seats stay visible for history; they are excluded from attendance totals.
            </p>
        </section>
    )
}
