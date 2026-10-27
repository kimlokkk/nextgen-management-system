"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowUpRight, ClipboardList, Search } from "lucide-react"
import { saveLegacyReplacementReview, recordLegacyReconciliationDecision } from "@/app/(app)/replacements/legacy/actions"
import { compareLegacyOriginalCandidate, type OriginalBookingCandidate, type CandidateFieldComparison } from "@/lib/legacy-source-comparison"
import { SeptemberEvidencePanel } from "@/components/september-evidence-panel"
import type { SeptemberComparison } from "@/lib/september-reconciliation"

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

const evidenceComparisonText: Record<CandidateFieldComparison, string> = {
    same_text: "Text matches (not verification)",
    different_text: "Different — investigate",
    unavailable: "Cannot compare",
}

type SourceDecision = {
    review_id: string
    disposition: "needs_investigation" | "source_correlated" | "source_checked"
    evidence_reference: string
    decision_note: string
    identity_confirmed: boolean
    original_date_confirmed: boolean
    decided_at: string
}

const reconciliationLabels: Record<string,string> = {
    needs_investigation: "Needs further investigation",
    source_correlated: "Source reference located — not verified",
    source_checked: "Identity and original date checked — no entitlement approved",
}

const reviewLabels: Record<string,string> = {
    pending: "Not reviewed",
    evidence_requested: "Evidence requested",
    evidence_received: "Evidence received (not approved)",
    excluded: "Not applicable / excluded",
}

export function LegacyReplacementReviewQueue({
    rows, originalEvidenceByReview, originalBookingLookupError,
    septemberComparisonByReview, septemberLoaded, septemberError,
    reconciliationByReview, reconciliationUnavailable, initialView,
}: {
    rows: LegacyReplacementReview[]
    originalEvidenceByReview: Record<string, OriginalBookingCandidate | null>
    originalBookingLookupError: string | null
    septemberComparisonByReview: Record<string, SeptemberComparison>
    septemberLoaded: boolean
    septemberError: boolean
    reconciliationByReview: Record<string, SourceDecision>
    reconciliationUnavailable: boolean
    initialView: string
}) {
    const [category, setCategory] = useState(
        ["september", "all", ...categories.map(x => x.value)].includes(initialView)
            ? initialView : "SOURCE_LINK_CANDIDATE_ADMIN_REVIEW"
    )
    const [search, setSearch] = useState("")
    const [reviewFilter, setReviewFilter] = useState("all")
    const [showSettled, setShowSettled] = useState(false)
    const [page, setPage] = useState(0)
    const [selectedReferences, setSelectedReferences] = useState<Record<string, string>>({})
    const [justSelected, setJustSelected] = useState<string | null>(null)
    const selectReference = (reviewId: string, reference: string) => {
        setSelectedReferences(current => ({...current, [reviewId]: reference}))
        setJustSelected(reviewId)
    }

    // Rows an admin already settled (source checked) are hidden by default so the queue only shows what still needs action.
    const settledCount = rows.filter((item) => reconciliationByReview[item.id]?.disposition === "source_checked").length
    const pool = useMemo(() => showSettled ? rows
        : rows.filter((item) => reconciliationByReview[item.id]?.disposition !== "source_checked"), [rows, showSettled, reconciliationByReview])
    const shown = useMemo(() => pool.filter((item) =>
        (category === "all" || (category === "september"
            ? item.original_date?.startsWith("2026-09-")
            : item.technical_status === category))
        && (reviewFilter === "all" || item.review_state === reviewFilter)
        && (!search.trim() || [
            item.student_name, item.source_ref, item.programme_code,
            item.replacement_date, item.original_date ?? "",
        ].some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
    ), [pool, category, search, reviewFilter])

    const pageSize = 10
    const maxPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1)
    const currentPage = Math.min(page, maxPage)
    const visible = shown.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

    const choose = (value: string) => { setCategory(value); setPage(0) }
    const flagged = rows.filter((item) => item.over_capacity).length
    const checkedSources = rows.filter(item => reconciliationByReview[item.id]?.disposition === "source_checked").length
    const investigationCount = rows.filter(item => reconciliationByReview[item.id]?.disposition === "needs_investigation").length
    const unreviewedSources = rows.filter(item => !reconciliationByReview[item.id]).length
    const septemberOctoberRows = rows.filter((item) => item.original_date?.startsWith("2026-09-"))
    const rosterMatches = septemberOctoberRows.filter((item) =>
        (septemberComparisonByReview[item.id]?.roster.length ?? 0) > 0).length
    const nameReviews = septemberOctoberRows.filter((item) =>
        !septemberComparisonByReview[item.id]?.roster.length
        && (septemberComparisonByReview[item.id]?.possibleNameVariation.length ?? 0) > 0).length

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
                            The MTDC October Excel is an operations-confirmed record of legacy replacement reservations.
                            These entries are not active attendance records or newly issued entitlements.
                            Technical source-booking gaps do not invalidate the legacy Excel reservation.
                        </p>
                    </div>
                    <span className="rounded-lg bg-muted px-3 py-2 text-xs font-semibold">
                        {rows.length} source rows
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {[
                        { label: "Source link candidates", value: rows.filter((r) => r.technical_status === "SOURCE_LINK_CANDIDATE_ADMIN_REVIEW").length },
                        { label: "History unavailable", value: rows.filter((r) => r.technical_status === "ORIGINAL_BOOKING_MISSING").length },
                        { label: "Excel reservations", value: rows.filter((r) => r.review_state !== "excluded").length },
                        { label: "Overcapacity flagged", value: flagged },
                    ].map((item) => (
                        <div key={item.label} className="rounded-lg border bg-muted/30 p-3">
                            <p className="text-xs text-muted-foreground">{item.label}</p>
                            <p className="mt-1 text-xl font-semibold tabular-nums">{item.value}</p>
                        </div>
                    ))}
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                    <p className="font-semibold">Reconciliation decisions · separate from seat reservations</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {reconciliationUnavailable
                            ? "Decision store unavailable. Apply local migration 022; source decisions cannot be recorded."
                            : `${checkedSources} sources checked · ${investigationCount} investigating · ${unreviewedSources} not yet reviewed.`}
                        {" "}Source checked means identity and original date evidence were reviewed by an admin; it does not prove absence or approve a replacement.
                    </p>
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    <p className="font-semibold">September source reconciliation · {septemberOctoberRows.length} October records</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {septemberLoaded
                            ? `${rosterMatches} same-date name matches · ${nameReviews} possible name variation(s).`
                            : septemberError
                                ? "September staging table unavailable (migration 021 required locally)."
                                : "September historical dataset has not been imported into local staging."}
                        {" "}Candidate matches are not validated original bookings or replacement entitlements.
                    </p>
                </div>
                <nav className="flex flex-wrap gap-2" aria-label="Evidence categories">
                    {categories.map((item) => (
                        <button key={item.value} type="button" title={item.help}
                            onClick={() => choose(item.value)}
                            aria-pressed={category === item.value}
                            className={category === item.value
                                ? "min-h-10 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                                : "min-h-10 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"}>
                            {item.label} · {pool.filter((r) => r.technical_status === item.value).length}
                        </button>
                    ))}
                    <button type="button" onClick={() => choose("september")}
                        aria-pressed={category === "september"}
                        className={category === "september"
                            ? "min-h-10 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                            : "min-h-10 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"}>
                        September originals · {pool.filter((r) => r.original_date?.startsWith("2026-09-")).length}
                    </button>
                    <button type="button" onClick={() => choose("all")} aria-pressed={category === "all"}
                        className={category === "all"
                            ? "min-h-10 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                            : "min-h-10 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"}>
                        All · {pool.length}
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
                <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={showSettled} onChange={(e) => { setShowSettled(e.target.checked); setPage(0) }}
                        className="size-4 accent-primary" />
                    Also show records already settled (source checked) · {settledCount}
                </label>
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
                            {item.original_booking_id && (
                                <section className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3"
                                    aria-label="Potential original booking evidence">
                                    <p className="text-sm font-semibold">Potential original booking · read-only comparison</p>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                        An imported candidate ID is a lead for admin investigation, not confirmation
                                        that this student earned a replacement or attended the original class.
                                    </p>
                                    {item.source_booking_candidates > 1 && (
                                        <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300">
                                            {item.source_booking_candidates} source candidates were found. Do not assume the selected candidate is the correct one.
                                        </p>
                                    )}
                                    {originalBookingLookupError ? (
                                        <p className="mt-2 text-xs text-destructive">
                                            Original booking evidence cannot be loaded. Try refreshing later.
                                            Do not record a reconciliation decision from incomplete evidence.
                                        </p>
                                    ) : originalEvidenceByReview[item.id] ? (() => {
                                        const evidence = originalEvidenceByReview[item.id]!
                                        const compared = compareLegacyOriginalCandidate(
                                            item.student_name, item.original_date, evidence
                                        )
                                        return (
                                            <div className="mt-3 space-y-2 text-xs leading-5">
                                                <div className="grid gap-2 sm:grid-cols-2">
                                                    <div className="rounded-md border bg-background p-3">
                                                        <p className="font-semibold text-foreground">Excel source</p>
                                                        <p>Name: {item.student_name}</p>
                                                        <p>Original date: {item.original_date ?? "Unavailable"}</p>
                                                        {item.source_date_type === "year_assumed_2026" && (
                                                            <p className="text-amber-800 dark:text-amber-300">Original year is assumed, not verified</p>
                                                        )}
                                                    </div>
                                                    <div className="rounded-md border bg-background p-3">
                                                        <p className="font-semibold text-foreground">NextGen candidate</p>
                                                        <p>Name: {evidence.studentName ?? "Unavailable"}</p>
                                                        <p>Class date: {evidence.classDate ?? "Unavailable"}</p>
                                                        <p>Class time: {evidence.startTime?.slice(0, 5) ?? "?"}–{evidence.endTime?.slice(0, 5) ?? "?"}</p>
                                                        <p>Booking type: {evidence.bookingType}</p>
                                                        <p>Recorded source attendance: {evidence.attendanceStatus}</p>
                                                    </div>
                                                </div>
                                                <p>Name: {evidenceComparisonText[compared.name]} · Date: {evidenceComparisonText[compared.date]}</p>
                                                {compared.originalMarkedPresent && (
                                                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-200">
                                                        Original booking is marked Present. Ask operations to verify why a replacement was reserved.
                                                        No attendance or entitlement has been changed.
                                                    </p>
                                                )}
                                                <p className="text-muted-foreground">
                                                    This panel is informational only. Use the separate admin notes below to document findings.
                                                </p>
                                            </div>
                                        )
                                    })() : (
                                        <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                                            The referenced original booking is unavailable in the current dataset.
                                            Request historical evidence; do not infer identity or eligibility.
                                        </p>
                                    )}
                                </section>
                            )}
                            <SeptemberEvidencePanel
                                originalDate={item.original_date}
                                evidence={septemberComparisonByReview[item.id]}
                                loaded={septemberLoaded}
                                unavailable={septemberError}
                                onUseReference={(reference) => selectReference(item.id, reference)}
                                selectedReference={justSelected === item.id ? selectedReferences[item.id] : undefined}
                            />
                            <details className="mt-3 rounded-lg border bg-muted/20 p-3">
                                <summary className="cursor-pointer text-sm font-semibold">
                                    Reconciliation decision {reconciliationByReview[item.id]
                                        ? "· " + reconciliationLabels[reconciliationByReview[item.id].disposition]
                                        : "· Not reviewed"}
                                </summary>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                    Correlation means the roster/source was located; checking a source requires separate
                                    identity and original-date verification. Neither action creates attendance or an entitlement.
                                    Seat reservations remain unchanged even if the source is checked.
                                </p>
                                {reconciliationUnavailable ? (
                                    <p className="mt-2 text-sm text-destructive">
                                        Decisions disabled until local migration 022 is applied.
                                    </p>
                                ) : (
                                    <form action={recordLegacyReconciliationDecision} className="mt-3 grid gap-3">
                                        <input type="hidden" name="id" value={item.id}/>
                                        <input type="hidden" name="view" value={category}/>
                                        <input type="hidden" name="expected"
                                            value={reconciliationByReview[item.id]?.disposition ?? ""}/>
                                        <label className="block">
                                            <span className="mb-1 block text-xs font-semibold">Source evidence decision</span>
                                            <select name="disposition"
                                                defaultValue={reconciliationByReview[item.id]?.disposition ?? "needs_investigation"}
                                                className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                                                <option value="needs_investigation">Needs investigation</option>
                                                <option value="source_correlated">Source reference located (unverified)</option>
                                                <option value="source_checked" disabled={
                                                    item.review_state === "excluded" ||
                                                    !item.original_date ||
                                                    item.original_date >= item.replacement_date
                                                }>Identity and original date checked (NOT entitlement)</option>
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="mb-1 block text-xs font-semibold">Evidence reference</span>
                                            <input name="evidence_reference" type="text" maxLength={500}
                                                value={selectedReferences[item.id] ?? reconciliationByReview[item.id]?.evidence_reference ?? ""}
                                                onChange={(event) => {
                                                    setSelectedReferences(current => ({...current, [item.id]: event.target.value}))
                                                    setJustSelected(null)
                                                }}
                                                placeholder="Select a September row above or cite another source"
                                                className="h-10 w-full rounded-lg border bg-background px-3 text-sm"/>
                                            {justSelected === item.id && (
                                                <p role="status" className="mt-1 text-xs text-primary">
                                                    Reference filled from the selected spreadsheet row. Verify it before saving.
                                                </p>
                                            )}
                                        </label>
                                        <label className="flex items-start gap-2 text-xs">
                                            <input name="identity_confirmed" type="checkbox" value="yes"
                                                defaultChecked={reconciliationByReview[item.id]?.identity_confirmed ?? false}
                                                className="mt-0.5 size-4 accent-primary"/>
                                            I personally verified the student identity against source evidence.
                                        </label>
                                        <label className="flex items-start gap-2 text-xs">
                                            <input name="original_date_confirmed" type="checkbox" value="yes"
                                                defaultChecked={reconciliationByReview[item.id]?.original_date_confirmed ?? false}
                                                className="mt-0.5 size-4 accent-primary"/>
                                            I personally verified the original date, including any assumed year.
                                        </label>
                                        <label className="block">
                                            <span className="mb-1 block text-xs font-semibold">Decision / follow-up note</span>
                                            <textarea name="decision_note" rows={3} required minLength={10} maxLength={2000}
                                                defaultValue={reconciliationByReview[item.id]?.decision_note ?? ""}
                                                placeholder="Describe the evidence reviewed, gaps, and next responsible action."
                                                className="w-full rounded-lg border bg-background p-3 text-sm"/>
                                        </label>
                                        <label className="flex items-start gap-2 text-xs">
                                            <input name="confirm_decision" type="checkbox" value="yes" required
                                                className="mt-0.5 size-4 accent-primary"/>
                                            Save an audited evidence decision only. I am not approving a replacement or attendance.
                                        </label>
                                        <button type="submit" className="ui-secondary-action w-fit">
                                            Record reconciliation decision
                                        </button>
                                    </form>
                                )}
                                {reconciliationByReview[item.id] && (
                                    <p className="mt-3 text-xs text-muted-foreground">
                                        Last decided: {new Date(reconciliationByReview[item.id].decided_at)
                                            .toLocaleString("en-MY",{ timeZone:"Asia/Kuala_Lumpur" })}.
                                        Previous decisions remain in the audit trail.
                                    </p>
                                )}
                            </details>
                            <details className="mt-3 rounded-lg border bg-muted/20 p-3">
                                <summary className="cursor-pointer text-sm font-semibold">
                                    Evidence and admin notes
                                </summary>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                    Excel lists this as a confirmed legacy booking. Use notes to reconcile the old source
                                    attendance, identity, date order and seat exceptions. “Evidence received”
                                    does not record attendance or issue a new entitlement.
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
