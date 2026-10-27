"use server"

import { z } from "zod"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

const schema = z.object({
    studentId: z.string().uuid(),
    parentId: z.string().uuid(),
    relationship: z.enum(["father","mother","guardian"]),
    evidenceReference: z.string().trim().min(10).max(500),
    confirmed: z.literal("yes"),
})

const newParentSchema = z.object({
    studentId: z.string().uuid(),
    parentName: z.string().trim().min(3, "Parent full name must be at least 3 characters").max(160),
    parentPhone: z.string().trim().max(30).regex(/^[0-9+() -]*$/, "Phone may contain only digits, spaces, + ( ) and -"),
    relationship: z.enum(["father","mother","guardian"]),
    evidenceReference: z.string().trim().min(10).max(500),
    confirmed: z.literal("yes"),
})

function reject(message: string): never {
    redirect("/readiness/guardians?error=" + encodeURIComponent(message))
}

export async function resolveGuardianLink(formData: FormData) {
    const parsed = schema.safeParse({
        studentId: formData.get("student_id"),
        parentId: formData.get("parent_id"),
        relationship: formData.get("relationship"),
        evidenceReference: formData.get("evidence_reference"),
        confirmed: formData.get("confirmed"),
    })
    if (!parsed.success) reject(parsed.error.issues[0]?.message ?? "Verify the guardian relationship first.")
    const supabase = await createClient()
    const {data:{user},error:authError}=await supabase.auth.getUser()
    if (!user || authError) redirect("/auth/login")
    const {data:profile}=await supabase.from("profiles").select("role,is_active")
        .eq("id",user.id).single()
    if (!profile?.is_active || !["admin","super_admin"].includes(profile.role)) {
        reject("Only active admins can resolve guardian links.")
    }
    const {error}=await supabase.rpc("resolve_missing_student_guardian",{
        p_student_id:parsed.data.studentId,
        p_parent_id:parsed.data.parentId,
        p_relationship:parsed.data.relationship,
        p_evidence_reference:parsed.data.evidenceReference,
    })
    if (error) reject("Guardian link not saved: " + error.message)
    revalidatePath("/readiness")
    revalidatePath("/readiness/guardians")
    revalidatePath("/students")
    redirect("/readiness/guardians?saved=1")
}

export async function resolveGuardianLinkNewParent(formData: FormData) {
    const parsed = newParentSchema.safeParse({
        studentId: formData.get("student_id"),
        parentName: formData.get("new_parent_name"),
        parentPhone: formData.get("new_parent_phone") ?? "",
        relationship: formData.get("relationship"),
        evidenceReference: formData.get("evidence_reference"),
        confirmed: formData.get("confirmed"),
    })
    if (!parsed.success) reject(parsed.error.issues[0]?.message ?? "Verify the new parent details first.")
    const supabase = await createClient()
    const {data:{user},error:authError}=await supabase.auth.getUser()
    if (!user || authError) redirect("/auth/login")
    const {data:profile}=await supabase.from("profiles").select("role,is_active")
        .eq("id",user.id).single()
    if (!profile?.is_active || !["admin","super_admin"].includes(profile.role)) {
        reject("Only active admins can resolve guardian links.")
    }
    // One transaction in the database: the new parent exists only if the audited link succeeds.
    const {error}=await supabase.rpc("resolve_missing_student_guardian_new_parent",{
        p_student_id:parsed.data.studentId,
        p_parent_name:parsed.data.parentName,
        p_parent_phone:parsed.data.parentPhone,
        p_relationship:parsed.data.relationship,
        p_evidence_reference:parsed.data.evidenceReference,
    })
    if (error) reject("Guardian link not saved: " + error.message)
    revalidatePath("/readiness")
    revalidatePath("/readiness/guardians")
    revalidatePath("/students")
    revalidatePath("/parents")
    redirect("/readiness/guardians?saved=1")
}
