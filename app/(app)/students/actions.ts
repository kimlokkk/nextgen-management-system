"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const studentSchema = z.object({
    full_name: z.string().trim().min(2, "Student name is required"),

    date_of_birth: z.string().optional(),

    parent_id: z.string().uuid("Parent is required"),

    relationship: z.string().trim().optional(),

    laptop_type: z.enum(["own", "academy"]).optional(),

    notes: z.string().trim().optional(),
})

export async function createStudent(formData: FormData) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    const result = studentSchema.safeParse({
        full_name: formData.get("full_name"),
        date_of_birth: formData.get("date_of_birth"),
        parent_id: formData.get("parent_id"),
        relationship: formData.get("relationship"),
        laptop_type: formData.get("laptop_type") || undefined,
        notes: formData.get("notes"),
    })

    if (!result.success) {
        throw new Error(
            result.error.issues[0]?.message ?? "Invalid student data"
        )
    }

    const data = result.data

    const { data: student, error: studentError } = await supabase
        .from("students")
        .insert({
            full_name: data.full_name,
            date_of_birth: data.date_of_birth || null,
            laptop_type: data.laptop_type || null,
            notes: data.notes || null,
            status: "active",
        })
        .select("id")
        .single()

    if (studentError) {
        throw new Error(studentError.message)
    }

    const { error: guardianError } = await supabase
        .from("student_guardians")
        .insert({
            student_id: student.id,
            parent_id: data.parent_id,
            relationship: data.relationship || null,
            is_primary: true,
        })

    if (guardianError) {
        throw new Error(guardianError.message)
    }

    revalidatePath("/students")
}