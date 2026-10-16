"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { z } from "zod"

const assignmentSchema = z.object({
    obligation_id: z.string().uuid(),
    target_session_id: z.string().uuid(),
})

export async function assignReplacementSlot(formData: FormData) {
    const parsed = assignmentSchema.safeParse({
        obligation_id: formData.get("obligation_id"),
        target_session_id: formData.get("target_session_id"),
    })

    if (!parsed.success) {
        throw new Error("Invalid replacement assignment")
    }

    const { obligation_id, target_session_id } = parsed.data
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    // SQL RPC enforces role, yellow-seat capacity, timing and atomic writes.
    const { error } = await supabase.rpc(
        "assign_replacement_obligation",
        {
            p_obligation_id: obligation_id,
            p_target_session_id: target_session_id,
        }
    )

    if (error) {
        throw new Error(error.message)
    }

    redirect(`/replacements/${obligation_id}`)
}
