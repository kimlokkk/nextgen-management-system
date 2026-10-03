"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const updateSessionSchema = z.object({
    id: z.string().uuid(),
    regular_capacity: z.coerce.number().int().min(0),
    replacement_capacity: z.coerce.number().int().min(0),
})

export async function updateSessionCapacity(formData: FormData) {
    const supabase = await createClient()

    const result = updateSessionSchema.safeParse({
        id: formData.get("id"),
        regular_capacity: formData.get("regular_capacity"),
        replacement_capacity: formData.get("replacement_capacity"),
    })

    if (!result.success) {
        throw new Error("Invalid session configuration")
    }

    const { id, regular_capacity, replacement_capacity } = result.data

    const { error } = await supabase
        .from("session_templates")
        .update({
            regular_capacity,
            replacement_capacity,
            updated_at: new Date().toISOString(),
        })
        .eq("id", id)

    if (error) {
        throw new Error(error.message)
    }

    revalidatePath("/housekeeping/sessions")
}