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

const changeSchema = assignmentSchema

const cancelSchema = z.object({
    obligation_id: z.string().uuid(),
    mode: z.enum(["release", "cancel"]),
    reason: z.string().trim().max(300).optional(),
})

const completeSchema = z.object({
    obligation_id: z.string().uuid(),
})

async function replacementClient() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Unauthorized")
    return supabase
}

export async function changeReplacementSlot(formData: FormData) {
    const parsed = changeSchema.safeParse({
        obligation_id: formData.get("obligation_id"),
        target_session_id: formData.get("target_session_id"),
    })
    if (!parsed.success) throw new Error("Invalid change-slot request")

    const supabase = await replacementClient()
    const { obligation_id, target_session_id } = parsed.data
    const { error } = await supabase.rpc("change_replacement_slot", {
        p_obligation_id: obligation_id,
        p_target_session_id: target_session_id,
    })
    if (error) throw new Error(error.message)
    redirect(`/replacements/${obligation_id}`)
}

export async function cancelReplacement(formData: FormData) {
    const parsed = cancelSchema.safeParse({
        obligation_id: formData.get("obligation_id"),
        mode: formData.get("mode"),
        reason: formData.get("reason") ?? "",
    })
    if (!parsed.success) throw new Error("Invalid cancellation request")
    if (parsed.data.mode === "cancel" && formData.get("confirm_cancel") !== "on") {
        throw new Error("Please confirm cancellation")
    }
    if (parsed.data.mode === "release" && formData.get("confirm_release") !== "on") {
        throw new Error("Please confirm release of this yellow slot")
    }
    const supabase = await replacementClient()
    const { obligation_id, mode, reason } = parsed.data
    const { error } = await supabase.rpc("cancel_replacement", {
        p_obligation_id: obligation_id,
        p_mode: mode,
        p_reason: reason || null,
    })
    if (error) throw new Error(error.message)
    redirect(mode === "cancel" ? "/replacements" : `/replacements/${obligation_id}`)
}

export async function completeReplacement(formData: FormData) {
    const parsed = completeSchema.safeParse({
        obligation_id: formData.get("obligation_id"),
    })
    if (!parsed.success) throw new Error("Invalid attendance request")
    if (formData.get("confirm_attendance") !== "on") {
        throw new Error("Please confirm the student attended")
    }
    const supabase = await replacementClient()
    const { error } = await supabase.rpc("complete_replacement", {
        p_obligation_id: parsed.data.obligation_id,
    })
    if (error) throw new Error(error.message)
    redirect(`/replacements/${parsed.data.obligation_id}`)
}
