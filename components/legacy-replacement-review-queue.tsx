"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowUpRight, ClipboardList, Search } from "lucide-react"
import { saveLegacyReplacementReview } from "@/app/(app)/replacements/legacy/actions"

export type LegacyReplacementReview = {
    id: string
    source_ref: string
    student_name: string
    source_tab: string | null
    source_row: number | null
    original_date: string | null
    replacement_date: string
    programme_code: string
    space_number: number | null
    start_time: string
    end_time: string
    technical_status: string
    review_state: string
    review_note: string
    source_date_type: string
    over_capacity: boolean
    original_booking_id: string | null
    target_class_id: string | null
    source_booking_candidates: number
    target_class_candidates: number
}

const categories = [
    { value: "SOURCE_LINK_CANDIDATE_ADMIN_REVIEW", label: "Source candidates", help: "A booking candidate exists; entitlement still needs evidence" },
    { value: "ORIGINAL_BOOKING_MISSING", label: "Original booking missing", help: "Usually needs a June–September source schedule" },
    { value: "ORIGINAL_DATE_NOT_BEFORE_TARGET", label: "Date order review", help: "Original date is same/later; verify whether this was planned" },
    { value: "MISSING_OCTOBER_ROSTER_IDENTITY", label: "Identity review", help: "The student is not in the October regular roster" },
] as const

function readableDate(value: string | null) {
    if (!value) return "Unknown"
    return new Intl.DateTimeFormat("en-MY", {
        weekday: "short", day: "numeric", month: "short",
        timeZone: "UTC",
    }).format(new Date(value + "T00:00:00Z"))
}

const reviewLabels: Record<string,string> = {
    pending: "Not reviewed",
    evidence_requested: "Evidence requested",
    evidence_received: "Evidence received (not approved)",
    excluded: "Not applicable / excluded",
}

export function LegacyReplacementReviewQueue({ rows }: { rows: LegacyReplacementReview[] }) {
    const [category, setCategory] = useState("SOURCE_LINK_CANDIDATE_ADMIN_REVIEW")
    const [search, setSearch] = useState("")
    const [reviewFilter, setReviewFilter] = useState("all")
    const [page, setPage] = useState(0)

    const shown = useMemo(() => rows.filter((item) =>
        (category === "all" || item.technical_status === category)
        && (reviewFilter === "all" || item.review_state === reviewFilter)
        && (!search.trim() || [
            item.student_name, item.source_ref, item.programme_code,
            item.replacement_date, item.original_date ?? "",
        ].some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
    ), [rows, category, search, reviewFilter])

    const pageSize = 10
    const maxPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1)
    const currentPage = Math.min(page, maxPage)
    const visible = shown.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

    const choose = (value: string) => { setCategory(value); setPage(0) }
    const pending = rows.filter((item) => item.review_state === "pending").length
    const flagged = rows.filter((item) => item.over_capacity).length

    return (
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
            <div className="space-y-4 border-b p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="flex items-center gap-2 font-semibold">
                            <ClipboardList className="size-5 text-primary" aria-hidden="true" />
                            Historical replacement evidence
                        </h2>
                        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                            A private review queue for the MTDC October spreadsheet.
                            These are historical source records, NOT active yellow-seat bookings.
                            A candidate match is not proof that the student earned a replacement.
                        </p>
                    </div>
                    <span className="rounded-lg bg-muted px-3 py-2 text-xs font-semibold">
                        {rows.length} source rows
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {[
                        { label: "Source candidates", value: rows.filter((r) => r.technical_status === "SOURCE_LINK_CANDIDATE_ADMIN_REVIEW").length },
                        { label: "Missing sources", value: rows.filter((r) => r.technical_status === "ORIGINAL_BOOKING_MISSING").length },
                        { label: "Pending review", value: pending },
                        { label: "Overcapacity flagged", value: flagged },
                    ].map((item) => (
                        <div key={item.label} className="rounded-lg border bg-muted/30 p-3">
                            <p className="text-xs text-muted-foreground">{item.label}</p>
                            <p className="mt-1 text-xl font-semibold tabular-nums">{item.value}</p>
                        </div>
                    ))}
                </div>
                <nav className="flex flex-wrap gap-2" aria-label="Evidence categories">
                    {categories.map((item) => (
                        <button key={item.value} type="button" title={item.help}
                            onClick={() => choose(item.value)}
                            aria-pressed={category === item.value}
                            className={category === item.value
                                ? "min-h-10 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                                : "min-h-10 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"}>
                            {item.label} · {rows.filter((r) => r.technical_status === item.value).length}
                        </button>
                    ))}
                    <button type="button" onClick={() => choose("all")} aria-pressed={category === "all"}
                        className={category === "all"
                            ? "min-h-10 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                            : "min-h-10 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"}>
                        All · {rows.length}
                    </button>
                </nav>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
                    <label className="relative block">
                        <span className="sr-only">Search student or source record</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <input type="search" value={search}
                            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
                            placeholder="Search student, original date or source ref"
                            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm" />
                    </label>
                    <label>
                        <span className="sr-only">Filter evidence review state</span>
                        <select className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                            value={reviewFilter} onChange={(e) => { setReviewFilter(e.target.value); setPage(0) }}>
                            <option value="all">All review states</option>
                            {Object.entries(reviewLabels).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <p aria-live="polite" className="text-xs text-muted-foreground">
                    {shown.length} matching records · Showing {shown.length ? currentPage * pageSize + 1 : 0}–{Math.min(shown.length, (currentPage + 1) * pageSize)}
                </p>
            </div>
            {visible.length ? (
                <div className="divide-y">
                    {visible.map((item) => (
                        <article key={item.id} className="min-w-0 px-4 py-4 sm:px-5">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="font-semibold">{item.student_name}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {item.programme_code} · MTDC Space {item.space_number ?? "?"}
                                        {" · "}{item.start_time.slice(0,5)}–{item.end_time.slice(0,5)}
                                        {item.source_row ? " · Source row " + item.source_row : ""}
                                    </p>
                                </div>
                                <span className="rounded-md border bg-muted px-2.5 py-1 text-xs font-medium">
                                    {reviewLabels[item.review_state] ?? item.review_state}
                                </span>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                <span className="text-muted-foreground">Original:</span>
                                <span className="font-medium">{readableDate(item.original_date)}</span>
                                <span className="text-muted-foreground">→ Replacement:</span>
                                <span className="font-medium">{readableDate(item.replacement_date)}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {item.source_date_type === "year_assumed_2026" && (
                                    <span className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
                                        Original year assumed 2026
                                    </span>
                                )}
                                {item.over_capacity && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
                                        <AlertTriangle className="size-3" aria-hidden="true" />
                                        Source slot exceeds yellow capacity
                                    </span>
                                )}
                                {item.original_booking_id && (
                                    <span className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                                        Candidate original booking found
                                    </span>
                                )}
                                {item.target_class_id && (
                                    <Link href={"/schedule/sessions/" + item.target_class_id}
                                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold text-primary hover:bg-muted">
                                        Target class <ArrowUpRight className="size-3" aria-hidden="true" />
                                    </Link>
                                )}
                            </div>
                            <details className="mt-3 rounded-lg border bg-muted/20 p-3">
                                <summary className="cursor-pointer text-sm font-semibold">
                                    Evidence and admin notes
                                </summary>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                    Check the original attendance/absence, programme, identity and seat approval.
                                    “Evidence received” records progress only; it does not issue a replacement entitlement.
                                </p>
                                <form action={saveLegacyReplacementReview} className="mt-3 grid gap-3">
                                    <input type="hidden" name="id" value={item.id} />
                                    <label className="block">
                                        <span className="mb-1 block text-xs font-semibold">Review state</span>
                                        <select name="state" defaultValue={item.review_state}
                                            className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                                            {Object.entries(reviewLabels).map(([value, label]) => (
                                                <option key={value} value={value}>{label}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className="mb-1 block text-xs font-semibold">Evidence or follow-up note</span>
                                        <textarea name="note" defaultValue={item.review_note} rows={2}
                                            maxLength={2000} placeholder="Who confirmed this and what evidence is still missing?"
                                            className="w-full rounded-lg border bg-background p-3 text-sm" />
                                    </label>
                                    <button type="submit" className="ui-secondary-action w-fit">
                                        Save admin review
                                    </button>
                                </form>
                            </details>
                        </article>
                    ))}
                </div>
            ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                    No records match. Choose a different category or search.
                </div>
            )}
            {shown.length > pageSize && (
                <div className="flex items-center justify-between gap-3 border-t p-4">
                    <button type="button" disabled={currentPage === 0} onClick={() => setPage(Math.max(0, currentPage - 1))}
                        className="ui-secondary-action disabled:opacity-40">Previous</button>
                    <span className="text-xs text-muted-foreground">
                        Page {currentPage + 1} / {maxPage + 1}
                    </span>
                    <button type="button" disabled={currentPage >= maxPage}
                        onClick={() => setPage(Math.min(maxPage, currentPage + 1))}
                        className="ui-secondary-action disabled:opacity-40">Next</button>
                </div>
            )}
        </section>
    )
}
