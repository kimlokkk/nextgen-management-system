"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const parentSchema = z.object({
    full_name: z.string().trim().min(2, "Parent name is required"),
    whatsapp_phone: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    email: z
        .string()
        .trim()
        .refine(
            (value) => value === "" || z.email().safeParse(value).success,
            "Invalid email"
        ),
    notes: z.string().trim().optional(),
})

export async function createParent(formData: FormData) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    const result = parentSchema.safeParse({
        full_name: formData.get("full_name"),
        whatsapp_phone: formData.get("whatsapp_phone"),
        phone: formData.get("phone"),
        email: formData.get("email"),
        notes: formData.get("notes"),
    })

    if (!result.success) {
        throw new Error(result.error.issues[0]?.message ?? "Invalid form")
    }

    const data = result.data

    const { error } = await supabase
        .from("parents")
        .insert({
            full_name: data.full_name,
            whatsapp_phone: data.whatsapp_phone || null,
            phone: data.phone || null,
            email: data.email || null,
            notes: data.notes || null,
        })

    if (error) {
        throw new Error(error.message)
    }

    revalidatePath("/parents")
}