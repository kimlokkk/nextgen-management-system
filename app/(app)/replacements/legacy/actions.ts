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
