"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

// Draft-only, audited schedule edits. All rules (draft only, same programme,
// capacity, no overlap, enrollment window, audit) are enforced inside the
// SECURITY DEFINER RPCs from migration 029; this file only validates input.
const reason = z.string().trim().min(10, "Explain the change in at least 10 characters").max(500)
const id = z.string().uuid()

async function requireUser() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/auth/login")
    return supabase
}

function done(sessionId: string, flag: string) {
    revalidatePath(`/schedule/sessions/${sessionId}`)
    revalidatePath("/schedule")
    redirect(`/schedule/sessions/${sessionId}?edited=${flag}`)
}

export async function moveStudentInDraft(formData: FormData) {
    const parsed = z.object({
        sessionId: id, bookingId: id, targetClassId: id, reason,
    }).safeParse({
        sessionId: formData.get("session_id"),
        bookingId: formData.get("booking_id"),
        targetClassId: formData.get("target_class_id"),
        reason: formData.get("reason"),
    })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid move")
    const supabase = await requireUser()
    const { error } = await supabase.rpc("move_student_in_draft", {
        p_booking_id: parsed.data.bookingId,
        p_target_class_id: parsed.data.targetClassId,
        p_reason: parsed.data.reason,
    })
    if (error) throw new Error(error.message)
    done(parsed.data.sessionId, "moved")
}

export async function removeStudentFromDraft(formData: FormData) {
    if (formData.get("confirm_remove") !== "yes") throw new Error("Confirm the removal")
    const parsed = z.object({ sessionId: id, bookingId: id, reason }).safeParse({
        sessionId: formData.get("session_id"),
        bookingId: formData.get("booking_id"),
        reason: formData.get("reason"),
    })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid removal")
    const supabase = await requireUser()
    const { error } = await supabase.rpc("remove_student_from_draft_class", {
        p_booking_id: parsed.data.bookingId,
        p_reason: parsed.data.reason,
    })
    if (error) throw new Error(error.message)
    done(parsed.data.sessionId, "removed")
}

export async function addStudentToDraft(formData: FormData) {
    const parsed = z.object({ sessionId: id, studentId: id, reason }).safeParse({
        sessionId: formData.get("session_id"),
        studentId: formData.get("student_id"),
        reason: formData.get("reason"),
    })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid addition")
    const supabase = await requireUser()
    const { error } = await supabase.rpc("add_student_to_draft_class", {
        p_student_id: parsed.data.studentId,
        p_class_id: parsed.data.sessionId,
        p_reason: parsed.data.reason,
    })
    if (error) throw new Error(error.message)
    done(parsed.data.sessionId, "added")
}
