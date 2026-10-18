"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const capacitySchema = z.object({
    sessionId: z.string().uuid(),
    expectedCapacity: z.coerce.number().int().min(0),
    newCapacity: z.coerce.number().int().min(0).max(50),
    reason: z.string().trim().min(10).max(500),
})

/**
 * No automatic adjustment based on imported spreadsheets.
 * Admin explicitly confirms a single scheduled class in a draft batch.
 * The database RPC owns permission checks, concurrency and audit logging.
 */
export async function adjustClassReplacementCapacity(formData: FormData) {
    if (formData.get("confirm_capacity") !== "yes") {
        throw new Error("Confirm the per-class replacement capacity adjustment")
    }

    const parsed = capacitySchema.safeParse({
        sessionId: formData.get("session_id"),
        expectedCapacity: formData.get("expected_capacity"),
        newCapacity: formData.get("new_capacity"),
        reason: formData.get("reason"),
    })

    if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid class capacity change")
    }

    const supabase = await createClient()
    const { error } = await supabase.rpc("adjust_class_replacement_capacity", {
        p_class_session_id: parsed.data.sessionId,
        p_expected_capacity: parsed.data.expectedCapacity,
        p_new_capacity: parsed.data.newCapacity,
        p_reason: parsed.data.reason,
    })

    if (error) {
        throw new Error(error.message)
    }

    revalidatePath(`/schedule/sessions/${parsed.data.sessionId}`)
    revalidatePath("/schedule")
    redirect(`/schedule/sessions/${parsed.data.sessionId}`)
}
