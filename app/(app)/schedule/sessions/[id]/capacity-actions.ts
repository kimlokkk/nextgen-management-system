"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const schema = z.object({
    id: z.string().uuid(),
    expectedCapacity: z.coerce.number().int().min(0).max(50),
    expectedOccupied: z.coerce.number().int().min(0),
    decision: z.enum(["retain", "expand"]),
    newCapacity: z.coerce.number().int().min(0).max(50).nullable(),
    verifiedBy: z.string().trim().max(120),
    roomVerified: z.boolean(),
    facilitatorVerified: z.boolean(),
    reason: z.string().trim().min(10).max(500),
}).superRefine((value, ctx) => {
    if (value.decision === "expand" && (
        value.newCapacity === null || value.newCapacity <= value.expectedCapacity
        || !value.roomVerified || !value.facilitatorVerified || value.verifiedBy.length < 3
    )) ctx.addIssue({ code: "custom", message: "Verify space, facilitator and confirming person." })
})

export async function decideClassReplacementCapacity(formData: FormData) {
    if (formData.get("confirm_decision") !== "yes") throw new Error("Confirm the class decision")
    const parsed = schema.safeParse({
        id: formData.get("session_id"),
        expectedCapacity: formData.get("expected_capacity"),
        expectedOccupied: formData.get("expected_occupied"),
        decision: formData.get("decision"),
        newCapacity: formData.get("new_capacity") || null,
        verifiedBy: formData.get("verified_by") ?? "",
        roomVerified: formData.get("room_verified") === "yes",
        facilitatorVerified: formData.get("facilitator_verified") === "yes",
        reason: formData.get("reason"),
    })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid capacity decision")

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/auth/login")
    const { error } = await supabase.rpc("decide_class_replacement_capacity", {
        p_class_session_id: parsed.data.id,
        p_expected_capacity: parsed.data.expectedCapacity,
        p_expected_occupied: parsed.data.expectedOccupied,
        p_decision: parsed.data.decision,
        p_new_capacity: parsed.data.newCapacity,
        p_room_verified: parsed.data.roomVerified,
        p_facilitator_verified: parsed.data.facilitatorVerified,
        p_verified_by: parsed.data.verifiedBy,
        p_reason: parsed.data.reason,
    })
    if (error) throw new Error(error.message)
    revalidatePath(`/schedule/sessions/${parsed.data.id}`)
    revalidatePath("/schedule")
    revalidatePath("/replacements/legacy")
    redirect(`/schedule/sessions/${parsed.data.id}?capacity_reviewed=1`)
}
