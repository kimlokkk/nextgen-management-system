"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { z } from "zod"
import { getScheduleBatchValidation } from "@/lib/schedule-validation"
import { validateScheduleTransition } from "@/lib/schedule-transition-policy"

const generateSchema = z.object({
    branch_id: z.string().uuid(),
    month: z.string().regex(/^\\d{4}-(0[1-9]|1[0-2])$/),
})

/**
 * A single authenticated Postgres RPC now creates a batch, all class sessions
 * and every eligible regular booking atomically. No DELETE or regeneration.
 * All calendar/enrollment/capacity verification happens INSIDE the RPC.
 */
export async function generateSchedule(formData: FormData) {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error("Unauthorized")

    const { data: profile, error: profileError } = await supabase
        .from("profiles").select("role,is_active").eq("id",user.id).single()
    if (profileError || !profile?.is_active ||
        !["admin","super_admin"].includes(profile.role)) {
        throw new Error("Only active admins may generate a schedule")
    }

    const parsed = generateSchema.safeParse({
        branch_id: formData.get("branch_id"),
        month: formData.get("month"),
    })
    if (!parsed.success) throw new Error("Invalid schedule request")

    const { data: batchId, error: generationError } = await supabase.rpc(
        "generate_monthly_schedule_atomic", {
            p_branch_id: parsed.data.branch_id,
            p_schedule_month: parsed.data.month + "-01",
        }
    )
    if (generationError) throw new Error("Atomic schedule generation failed: " + generationError.message)
    if (!batchId || !z.string().uuid().safeParse(batchId).success) {
        throw new Error("Atomic generation returned no valid schedule batch")
    }
    redirect(`/schedule?batch=${batchId}`)
}

export async function approveSchedule(
    formData: FormData
) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    /*
     * Only Admin / Super Admin
     */

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .single()

    if (
        !profile ||
        !profile.is_active ||
        !["admin", "super_admin"].includes(
            profile.role
        )
    ) {
        throw new Error(
            "You do not have permission to approve schedules"
        )
    }

    const batchId = z
        .string()
        .uuid()
        .parse(formData.get("batch_id"))

    /*
     * Get current batch
     */

    const {
        data: batch,
        error: batchError,
    } = await supabase
        .from("schedule_batches")
        .select("id, status")
        .eq("id", batchId)
        .single()

    if (batchError || !batch) {
        throw new Error(
            "Schedule batch not found"
        )
    }

    if (batch.status !== "draft") {
        throw new Error(
            "Only draft schedules can be approved"
        )
    }

    /*
     * Server-side validation
     */

    const validation =
        await getScheduleBatchValidation(
            batchId
        )

    if (!validation.valid) {
        throw new Error(
            `Schedule cannot be approved: ${validation.errors.join(
                " "
            )}`
        )
    }

    const decision=validateScheduleTransition(batch.status,"approve",validation.valid,
        formData.get("confirm_operations_review")==="yes")
    if(decision)throw new Error(decision)
    const now = new Date().toISOString()

    const { data: approvedBatch, error: updateError } =
        await supabase
            .from("schedule_batches")
            .update({
                status: "approved",
                approved_at: now,
                updated_at: now,
            })
            .eq("id", batchId)
            .eq("status", "draft")
            .select("id")
            .maybeSingle()

    if (updateError) throw new Error(updateError.message)
    if (!approvedBatch) throw new Error("Schedule status changed before approval. Refresh and retry.")

    redirect(`/schedule?batch=${batchId}`)
}

export async function lockSchedule(
    formData: FormData
) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .single()

    if (
        !profile ||
        !profile.is_active ||
        !["admin", "super_admin"].includes(
            profile.role
        )
    ) {
        throw new Error(
            "You do not have permission to lock schedules"
        )
    }

    const batchId = z
        .string()
        .uuid()
        .parse(formData.get("batch_id"))

    const {
        data: batch,
        error: batchError,
    } = await supabase
        .from("schedule_batches")
        .select("id, status")
        .eq("id", batchId)
        .single()

    if (batchError || !batch) {
        throw new Error(
            "Schedule batch not found"
        )
    }

    if (batch.status !== "approved") {
        throw new Error(
            "Only approved schedules can be locked"
        )
    }

    /*
     * Validate sekali lagi.
     *
     * Contoh:
     * admin approve
     * → data berubah
     * → admin lock
     *
     * Kita tak nak lock schedule
     * yang dah ada conflict.
     */

    const validation =
        await getScheduleBatchValidation(
            batchId
        )

    if (!validation.valid) {
        throw new Error(
            `Schedule cannot be locked: ${validation.errors.join(
                " "
            )}`
        )
    }

    const decision=validateScheduleTransition(batch.status,"lock",validation.valid,
        formData.get("confirm_final_release")==="yes")
    if(decision)throw new Error(decision)
    const now = new Date().toISOString()

    const {
        data: lockedBatch,
        error: updateError,
    } = await supabase
        .from("schedule_batches")
        .update({
            status: "locked",
            locked_at: now,
            updated_at: now,
        })
        .eq("id", batchId)
        .eq("status", "approved")
        .select("id")
        .maybeSingle()

    if (updateError) {
        throw new Error(updateError.message)
    }

    if (!lockedBatch) {
        throw new Error(
            "Schedule status changed before it could be locked"
        )
    }

    redirect(`/schedule?batch=${batchId}`)
}