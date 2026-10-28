"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

// Move seats between regular and replacement inside one class. The class total
// never changes: the new replacement figure is derived from the total, and the
// SECURITY DEFINER RPC from migration 030 enforces every rule (admin only, total
// fixed, floors for booked/reserved seats, source for approved/locked months, audit).
const schema = z.object({
    id: z.string().uuid(),
    expectedRegular: z.coerce.number().int().min(0).max(50),
    expectedReplacement: z.coerce.number().int().min(0).max(50),
    newRegular: z.coerce.number().int().min(0).max(50),
    reason: z.string().trim().min(10, "Explain the change in at least 10 characters").max(500),
    sourceRef: z.string().trim().max(200),
})

export async function reallocateClassSeats(formData: FormData) {
    const parsed = schema.safeParse({
        id: formData.get("session_id"),
        expectedRegular: formData.get("expected_regular"),
        expectedReplacement: formData.get("expected_replacement"),
        newRegular: formData.get("new_regular"),
        reason: formData.get("reason"),
        sourceRef: formData.get("source_ref") ?? "",
    })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid seat change")
    const data = parsed.data
    const total = data.expectedRegular + data.expectedReplacement

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/auth/login")
    const { error } = await supabase.rpc("reallocate_class_seats", {
        p_class_session_id: data.id,
        p_expected_regular: data.expectedRegular,
        p_expected_replacement: data.expectedReplacement,
        p_new_regular: data.newRegular,
        p_new_replacement: total - data.newRegular,
        p_reason: data.reason,
        p_source_ref: data.sourceRef || null,
    })
    if (error) throw new Error(error.message)
    revalidatePath(`/schedule/sessions/${data.id}`)
    revalidatePath("/schedule")
    revalidatePath("/replacements/legacy")
    redirect(`/schedule/sessions/${data.id}?seats=1`)
}
