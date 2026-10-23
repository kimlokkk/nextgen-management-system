"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const reviewSchema = z.object({
    id: z.string().uuid(),
    state: z.enum(["pending", "evidence_requested", "evidence_received", "excluded"]),
    note: z.string().trim().max(2000),
}).refine((value) => value.state === "pending" || value.note.length >= 10, {
    path: ["note"], message: "Give a reason or evidence note (at least 10 characters).",
})

export async function saveLegacyReplacementReview(formData: FormData) {
    const parsed = reviewSchema.safeParse({
        id: formData.get("id"),
        state: formData.get("state"),
        note: formData.get("note"),
    })

    if (!parsed.success) {
        redirect("/replacements/legacy?error=" + encodeURIComponent(
            parsed.error.issues[0]?.message ?? "Invalid review entry."
        ))
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/auth/login")

    const { data: profile, error: profileError } = await supabase.from("profiles")
        .select("role, is_active").eq("id", user.id).single()
    if (profileError || !profile?.is_active || !["admin", "super_admin"].includes(profile.role)) {
        redirect("/replacements/legacy?error=" + encodeURIComponent("Only active admins can review historical records."))
    }

    const { error } = await supabase.rpc("record_legacy_replacement_review", {
        p_review_id: parsed.data.id,
        p_state: parsed.data.state,
        p_note: parsed.data.note,
    })
    if (error) {
        redirect("/replacements/legacy?error=" + encodeURIComponent("Review could not be saved: " + error.message))
    }

    revalidatePath("/replacements/legacy")
    redirect("/replacements/legacy?saved=1")
}

const reconciliationSchema = z.object({
    id: z.string().uuid(),
    expected: z.enum(["needs_investigation", "source_correlated", "source_checked"]).nullable(),
    disposition: z.enum(["needs_investigation", "source_correlated", "source_checked"]),
    identityConfirmed: z.boolean(),
    dateConfirmed: z.boolean(),
    reference: z.string().trim().max(500),
    note: z.string().trim().min(10).max(2000),
}).superRefine((value, context) => {
    if (value.disposition !== "needs_investigation" && value.reference.length < 8) {
        context.addIssue({
            code: "custom", message: "Provide a specific evidence reference (at least 8 characters).",
        })
    }
    if (value.disposition === "source_checked" &&
        (!value.identityConfirmed || !value.dateConfirmed || value.reference.length < 8)) {
        context.addIssue({
            code: "custom", message: "To check source evidence, confirm identity, original date and a specific evidence reference.",
        })
    }
})

function returnToReview(view: string, status: "saved" | "error", message: string) {
    const allowed = new Set([
        "all", "september", "SOURCE_LINK_CANDIDATE_ADMIN_REVIEW",
        "ORIGINAL_BOOKING_MISSING", "ORIGINAL_DATE_NOT_BEFORE_TARGET",
        "MISSING_OCTOBER_ROSTER_IDENTITY",
    ])
    const safe = allowed.has(view) ? view : "all"
    const qs = new URLSearchParams({ view: safe, [status]: message })
    redirect("/replacements/legacy?" + qs.toString())
}

export async function recordLegacyReconciliationDecision(formData: FormData) {
    const view = String(formData.get("view") ?? "all")
    if (formData.get("confirm_decision") !== "yes") {
        returnToReview(view, "error", "Explicit source-review acknowledgement required.")
    }
    const result = reconciliationSchema.safeParse({
        id: formData.get("id"),
        expected: formData.get("expected") || null,
        disposition: formData.get("disposition"),
        identityConfirmed: formData.get("identity_confirmed") === "yes",
        dateConfirmed: formData.get("original_date_confirmed") === "yes",
        reference: formData.get("evidence_reference") ?? "",
        note: formData.get("decision_note") ?? "",
    })
    if (!result.success) {
        returnToReview(view, "error", result.error.issues[0]?.message ?? "Invalid reconciliation review.")
    }
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/auth/login")

    const { error } = await supabase.rpc("record_legacy_reconciliation_decision", {
        p_review_id: result.data.id,
        p_expected_disposition: result.data.expected,
        p_disposition: result.data.disposition,
        p_identity_confirmed: result.data.identityConfirmed,
        p_original_date_confirmed: result.data.dateConfirmed,
        p_evidence_reference: result.data.reference,
        p_note: result.data.note,
    })
    if (error) {
        returnToReview(view, "error", "Evidence decision not saved: " + error.message)
    }
    revalidatePath("/replacements/legacy")
    revalidatePath("/readiness")
    returnToReview(view, "saved", "reconciliation")
}
