"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const programmeSchema = z.object({
    name: z.string().trim().min(2),
    code: z.string().trim().min(2),
})

export async function createProgramme(formData: FormData) {
    const supabase = await createClient()

    const result = programmeSchema.safeParse({
        name: formData.get("name"),
        code: formData.get("code"),
    })

    if (!result.success) {
        throw new Error("Invalid programme data")
    }

    const { error } = await supabase
        .from("programmes")
        .insert({
            name: result.data.name,
            code: result.data.code.toUpperCase(),
        })

    if (error) {
        throw new Error(error.message)
    }

    revalidatePath("/housekeeping/programmes")
}

export async function toggleProgramme(formData: FormData) {
    const supabase = await createClient()

    const id = String(formData.get("id"))
    const isActive = String(formData.get("is_active")) === "true"

    const { error } = await supabase
        .from("programmes")
        .update({
            is_active: !isActive,
            updated_at: new Date().toISOString(),
        })
        .eq("id", id)

    if (error) {
        throw new Error(error.message)
    }

    revalidatePath("/housekeeping/programmes")
}