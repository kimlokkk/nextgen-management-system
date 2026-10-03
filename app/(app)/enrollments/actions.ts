"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const enrollmentSchema = z.object({
    student_id: z.string().uuid(),
    branch_id: z.string().uuid(),
    programme_id: z.string().uuid(),
    default_session_id: z.string().uuid(),
    frequency_type: z.enum(["weekly", "twice_monthly", "custom"]),
    start_date: z.string().min(1),
})

export async function createEnrollment(formData: FormData) {
    const supabase = await createClient()

    const result = enrollmentSchema.safeParse({
        student_id: formData.get("student_id"),
        branch_id: formData.get("branch_id"),
        programme_id: formData.get("programme_id"),
        default_session_id: formData.get("default_session_id"),
        frequency_type: formData.get("frequency_type"),
        start_date: formData.get("start_date"),
    })

    if (!result.success) {
        throw new Error("Invalid enrollment data")
    }

    const data = result.data

    // Important:
    // pastikan session yang dipilih memang belong kepada
    // branch + programme yang dipilih.
    const { data: session } = await supabase
        .from("session_templates")
        .select("id")
        .eq("id", data.default_session_id)
        .eq("branch_id", data.branch_id)
        .eq("programme_id", data.programme_id)
        .single()

    if (!session) {
        throw new Error("Selected session does not match branch/programme")
    }

    const { error } = await supabase
        .from("enrollments")
        .insert({
            student_id: data.student_id,
            branch_id: data.branch_id,
            programme_id: data.programme_id,
            default_session_id: data.default_session_id,
            frequency_type: data.frequency_type,
            start_date: data.start_date,
            status: "active",
        })

    if (error) {
        throw new Error(error.message)
    }

    revalidatePath("/enrollments")
}