import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getYellowSeatUsage } from "@/lib/yellow-seat-usage"
import { compareSeptemberEvidence, type SeptemberEvidence, type SeptemberComparison } from "@/lib/september-reconciliation"
import type { OriginalBookingCandidate } from "@/lib/legacy-source-comparison"
import {
    LegacyReplacementReviewQueue,
    type LegacyReplacementReview,
} from "@/components/legacy-replacement-review-queue"

type Props = { searchParams: Promise<{ error?: string; saved?: string }> }

export default async function HistoricalReplacementReviewPage({ searchParams }: Props) {
    const params = await searchParams
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/auth/login")

    const { data: profile, error: profileError } = await supabase.from("profiles")
        .select("role, is_active").eq("id", user.id).single()

    if (profileError || !profile?.is_active || !["admin", "super_admin"].includes(profile.role)) {
        return (
            <section className="rounded-xl border bg-card p-6">
                <h1 className="text-lg font-semibold">Historical replacement review</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    This evidence queue is available only to active NextGen administrators.
                </p>
            </section>
        )
    }

    const { data, error } = await supabase.from("legacy_replacement_reviews")
        .select(`id, source_ref, student_name, source_tab, source_row, original_date,
            replacement_date, programme_code, space_number, start_time, end_time,
            technical_status, review_state, review_note, source_date_type,
            over_capacity, original_booking_id, target_class_id,
            source_booking_candidates, target_class_candidates, linked_active_booking_id`)
        .eq("source_batch", "mtdc-2026-10")
        .order("replacement_date", { ascending: true })
        .order("start_time", { ascending: true })
        .order("source_ref", { ascending: true })

    const rows = data ?? []

    // Historical workbook rows are private and are loaded only by the local
    // admin importer. No data here creates entitlement, attendance or bookings.
    const { data: septemberData, error: septemberError } = await supabase
        .from("legacy_september_evidence")
        .select("source_ref, source_tab, source_row, evidence_kind, student_name, class_date, start_time, end_time, space_label, course, module_raw, attendance_raw, original_date")
        .eq("source_batch", "mtdc-2026-09")
        .limit(1000)
    const septemberRows = (septemberData ?? []) as SeptemberEvidence[]
    const septemberLoaded = !septemberError && septemberRows.length > 0
    const septemberComparisonByReview: Record<string, SeptemberComparison> = {}
    if (septemberLoaded) {
        for (const row of rows) {
            if (row.original_date?.startsWith("2026-09-")) {
                septemberComparisonByReview[row.id] = compareSeptemberEvidence(
                    row.student_name, row.original_date, septemberRows
                )
            }
        }
    }

    // Only the explicit candidate original booking IDs (7 in the baseline MTDC
    // import) are read. Never infer a missing source or match by student name.
    // This is a READ-ONLY evidence preview, not conversion to an entitlement.
    const originalCandidateIds = [...new Set(rows
        .map((row) => row.original_booking_id)
        .filter((id): id is string => !!id))]
    const originalBookingResult = originalCandidateIds.length > 0
        ? await supabase.from("student_bookings")
            .select("id, student_id, class_session_id, booking_type, attendance_status")
            .in("id", originalCandidateIds)
        : { data: [], error: null }
    const originalBookings = originalBookingResult.data ?? []
    const sourceStudentIds = [...new Set(originalBookings.map((b) => b.student_id))]
    const sourceClassIds = [...new Set(originalBookings.map((b) => b.class_session_id))]
    const [originalStudentsResult, originalClassesResult] = await Promise.all([
        sourceStudentIds.length
            ? supabase.from("students")
                .select("id, full_name").in("id", sourceStudentIds)
            : Promise.resolve({ data: [], error: null }),
        sourceClassIds.length
            ? supabase.from("class_sessions")
                .select("id, class_date, start_time, end_time")
                .in("id", sourceClassIds)
            : Promise.resolve({ data: [], error: null }),
    ])
    const originalBookingLookupError = [
        originalBookingResult.error, originalStudentsResult.error,
        originalClassesResult.error,
    ].find(Boolean)?.message ?? null

    const bookingById = new Map(originalBookings.map((b) => [b.id, b]))
    const studentById = new Map((originalStudentsResult.data ?? []).map((s) => [s.id, s]))
    const classById = new Map((originalClassesResult.data ?? []).map((c) => [c.id, c]))
    const originalEvidenceByReview: Record<string, OriginalBookingCandidate | null> = {}
    for (const row of rows) {
        if (!row.original_booking_id) continue
        const booking = bookingById.get(row.original_booking_id)
        if (!booking) {
            originalEvidenceByReview[row.id] = null
            continue
        }
        const candidateStudent = studentById.get(booking.student_id)
        const candidateClass = classById.get(booking.class_session_id)
        originalEvidenceByReview[row.id] = {
            studentName: candidateStudent?.full_name ?? null,
            classDate: candidateClass?.class_date ?? null,
            startTime: candidateClass?.start_time ?? null,
            endTime: candidateClass?.end_time ?? null,
            bookingType: booking.booking_type,
            attendanceStatus: booking.attendance_status,
        }
    }
    const sessionIds = [...new Set(rows
        .map((row) => row.target_class_id)
        .filter((id): id is string => !!id))]
    const [classResult, bookingResult, decisionResult] = await Promise.all([
        sessionIds.length
            ? supabase.from("class_sessions")
                .select("id, class_date, start_time, replacement_capacity")
                .in("id", sessionIds)
            : Promise.resolve({ data: [], error: null }),
        sessionIds.length
            ? supabase.from("student_bookings")
                .select("id, class_session_id, booking_type, attendance_status")
                .in("class_session_id", sessionIds)
            : Promise.resolve({ data: [], error: null }),
        sessionIds.length
            ? supabase.from("class_replacement_capacity_reviews")
                .select("class_session_id, decision, decided_at")
                .in("class_session_id", sessionIds)
                .order("decided_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
    ])
    const lastDecisionByClass = new Map<string, string>()
    for (const decision of decisionResult.data ?? []) {
        if (decision.class_session_id && !lastDecisionByClass.has(decision.class_session_id)) {
            lastDecisionByClass.set(decision.class_session_id, decision.decision)
        }
    }
    const seatDataError = classResult.error ?? bookingResult.error
    const exceptions = (classResult.data ?? []).map((item) => ({
        ...item,
        usage: getYellowSeatUsage(
            item.id, item.replacement_capacity,
            bookingResult.data ?? [], rows
        ),
    })).filter((item) => item.usage.overBy > 0)
        .sort((a, b) => a.class_date.localeCompare(b.class_date)
            || a.start_time.localeCompare(b.start_time))
    const extraSeats = exceptions.reduce((total, item) => total + item.usage.overBy, 0)

    return (
        <div className="min-w-0 space-y-5">
            <header>
                <Link href="/replacements" className="ui-action-link -ml-2 text-muted-foreground">
                    ← Replacement operations
                </Link>
                <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    Local staging · MTDC · October 2026
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                    Historical replacement review
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    Match legacy spreadsheet evidence before any active replacement entitlement
                    is created. This page cannot change class attendance, capacity or bookings.
                </p>
            </header>
            {params.saved === "1" && (
                <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    Admin review note saved. No student booking was created or changed.
                </p>
            )}
            {params.error && (
                <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
                    {params.error}
                </p>
            )}
            {error ? (
                <section className="rounded-xl border bg-card p-5">
                    <h2 className="font-semibold">Evidence review queue not ready</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        The local review table could not be read. Apply migration 018 to
                        Supabase Local, then run the private MTDC review-queue loader.
                        Neither step should run on cloud production.
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                        Database message: {error.message}
                    </p>
                </section>
            ) : (data ?? []).length === 0 ? (
                <section className="rounded-xl border bg-card p-5">
                    <h2 className="font-semibold">No historical MTDC records loaded</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        The review schema exists, but the October MTDC source rows have not
                        been loaded into it. Run the private local-only loader once.
                    </p>
                </section>
            ) : seatDataError ? (
                <section className="rounded-xl border bg-card p-5">
                    <h2 className="font-semibold">Cannot verify yellow seat capacity</h2>
                    <p className="mt-2 text-sm text-destructive">{seatDataError.message}</p>
                </section>
            ) : (
                <>
                    <section aria-label="Historical yellow seat exceptions"
                        className="rounded-xl border bg-card p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <h2 className="font-semibold">Capacity decisions needed</h2>
                                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                    Total yellow bookings include Excel legacy and active replacements.
                                    Do not approve additional seats unless the actual space and facilitator are confirmed.
                                </p>
                            </div>
                            <span className="rounded-lg border bg-muted px-3 py-2 text-sm font-semibold tabular-nums">
                                {exceptions.length} classes · {extraSeats} extra seats
                            </span>
                        </div>
                        {decisionResult.error && (
                            <p className="mt-3 text-sm text-amber-800 dark:text-amber-300">
                                Decision status unavailable. Apply local migration 020 to enable capacity reviews.
                            </p>
                        )}
                        {exceptions.length === 0 ? (
                            <p className="mt-3 text-sm text-primary">
                                No over-capacity classes in the currently mapped legacy records.
                            </p>
                        ) : (
                            <div className="mt-4 grid gap-2 md:grid-cols-2">
                                {exceptions.map((item) => (
                                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                                        <div>
                                            <p className="text-sm font-semibold">
                                                {item.class_date} · {item.start_time.slice(0, 5)}
                                            </p>
                                            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                                                {item.usage.occupied}/{item.usage.capacity} yellow seats
                                                {" · "}{item.usage.legacy} Excel legacy + {item.usage.active} active
                                            </p>
                                            {lastDecisionByClass.get(item.id) === "retain" && (
                                                <p className="mt-1 text-xs font-medium text-primary">
                                                    Keep-capacity decision recorded · excess still unresolved
                                                </p>
                                            )}
                                        </div>
                                        <Link href={"/schedule/sessions/" + item.id}
                                            className="ui-secondary-action">
                                            Review capacity →
                                        </Link>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                    <LegacyReplacementReviewQueue
                        rows={rows as LegacyReplacementReview[]}
                        originalEvidenceByReview={originalEvidenceByReview}
                        originalBookingLookupError={originalBookingLookupError}
                        septemberComparisonByReview={septemberComparisonByReview}
                        septemberLoaded={septemberLoaded}
                        septemberError={!!septemberError}
                    />
                </>
            )}
        </div>
    )
}
