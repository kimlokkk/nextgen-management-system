"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { z } from "zod"

// =====================================================
// ATOMIC RESCHEDULE LIFECYCLE (migration 027)
//
// Each action delegates to a single database RPC that checks admin permission,
// validates state, takes row locks and performs every write inside ONE
// transaction. There is deliberately no multi-step write and no best-effort
// compensating cleanup here: any failure rolls the whole operation back.
// Capacity is enforced under a lock on the class row, so two admins acting at
// the same moment cannot both take the last seat.
// =====================================================

const assignSchema = z.object({
    obligation_id: z.string().uuid(),
    target_session_id: z.string().uuid(),
})

const reopenSchema = z.object({
    obligation_id: z.string().uuid(),
})

const cancelSchema = z.object({
    obligation_id: z.string().uuid(),
})

export async function assignRescheduleSlot(
    formData: FormData
) {
    const parsed = assignSchema.safeParse({
        obligation_id: formData.get("obligation_id"),
        target_session_id: formData.get("target_session_id"),
    })

    if (!parsed.success) {
        throw new Error("Invalid reschedule assignment")
    }

    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    const { error } = await supabase.rpc(
        "assign_reschedule_slot",
        {
            p_obligation_id: parsed.data.obligation_id,
            p_target_session_id: parsed.data.target_session_id,
        }
    )

    if (error) {
        throw new Error(error.message)
    }

    redirect("/reschedules")
}

export async function reopenRescheduleAssignment(
    formData: FormData
) {
    const parsed = reopenSchema.safeParse({
        obligation_id: formData.get("obligation_id"),
    })

    if (!parsed.success) {
        throw new Error("Invalid reschedule request")
    }

    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    const { error } = await supabase.rpc(
        "reopen_reschedule_assignment",
        {
            p_obligation_id: parsed.data.obligation_id,
        }
    )

    if (error) {
        throw new Error(error.message)
    }

    redirect(`/reschedules/${parsed.data.obligation_id}`)
}

export async function cancelReschedule(
    formData: FormData
) {
    const parsed = cancelSchema.safeParse({
        obligation_id: formData.get("obligation_id"),
    })

    if (!parsed.success) {
        throw new Error("Invalid cancel reschedule request")
    }

    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    const { error } = await supabase.rpc(
        "cancel_reschedule",
        {
            p_obligation_id: parsed.data.obligation_id,
        }
    )

    if (error) {
        throw new Error(error.message)
    }

    redirect("/reschedules")
}
