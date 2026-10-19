import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
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
            source_booking_candidates, target_class_candidates`)
        .eq("source_batch", "mtdc-2026-10")
        .order("replacement_date", { ascending: true })
        .order("start_time", { ascending: true })
        .order("source_ref", { ascending: true })

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
            ) : (
                <LegacyReplacementReviewQueue rows={(data ?? []) as LegacyReplacementReview[]} />
            )}
        </div>
    )
}
