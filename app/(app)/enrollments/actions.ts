"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

// Every enrollment write goes through the audited RPCs from migration 031. They check that the slot belongs
// to the branch, the frequency and weeks fit together, and that the student has no overlapping class; this
// file only validates the form input.
const id = z.string().uuid()
const frequency = z.enum(["weekly", "twice_monthly", "custom"])
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
const reason = z.string().trim().min(10, "Explain the change in at least 10 characters").max(500)
const weeksFrom = (formData: FormData) => formData.getAll("preferred_weeks").map((value) => Number(value))
const weeksSchema = z.array(z.number().int().min(1).max(4))

async function requireUser() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/auth/login")
    return supabase
}

export async function createEnrollment(formData: FormData) {
    const parsed = z.object({
        studentId: id, sessionId: id, frequency, weeks: weeksSchema, startDate: date,
    }).safeParse({
        studentId: formData.get("student_id"),
        sessionId: formData.get("default_session_id"),
        frequency: formData.get("frequency_type"),
        weeks: weeksFrom(formData),
        startDate: formData.get("start_date"),
    })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid enrollment data")

    const supabase = await requireUser()
    const { error } = await supabase.rpc("create_enrollment", {
        p_student_id: parsed.data.studentId,
        p_default_session_id: parsed.data.sessionId,
        p_frequency_type: parsed.data.frequency,
        p_preferred_weeks: parsed.data.frequency === "weekly" ? null : parsed.data.weeks,
        p_start_date: parsed.data.startDate,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/enrollments")
    redirect("/enrollments?saved=added")
}

export async function changeEnrollment(formData: FormData) {
    const parsed = z.object({
        enrollmentId: id, effectiveFrom: date, sessionId: id, frequency, weeks: weeksSchema, reason,
    }).safeParse({
        enrollmentId: formData.get("enrollment_id"),
        effectiveFrom: formData.get("effective_from"),
        sessionId: formData.get("default_session_id"),
        frequency: formData.get("frequency_type"),
        weeks: weeksFrom(formData),
        reason: formData.get("reason"),
    })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid change")

    const supabase = await requireUser()
    const { data, error } = await supabase.rpc("change_enrollment", {
        p_enrollment_id: parsed.data.enrollmentId,
        p_effective_from: parsed.data.effectiveFrom,
        p_default_session_id: parsed.data.sessionId,
        p_frequency_type: parsed.data.frequency,
        p_preferred_weeks: parsed.data.frequency === "weekly" ? null : parsed.data.weeks,
        p_reason: parsed.data.reason,
    })
    if (error) throw new Error(error.message)
    const result = (data ?? {}) as { mode?: string; bookings_on_or_after_date?: number }
    revalidatePath("/enrollments")
    redirect(`/enrollments?saved=changed&later=${Number(result.bookings_on_or_after_date ?? 0)}`)
}

export async function setEnrollmentStatus(formData: FormData) {
    const parsed = z.object({
        enrollmentId: id,
        status: z.enum(["paused", "active", "stopped"]),
        endDate: date.nullable(),
        reason,
    }).safeParse({
        enrollmentId: formData.get("enrollment_id"),
        status: formData.get("new_status"),
        endDate: formData.get("end_date") || null,
        reason: formData.get("reason"),
    })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid change")
    if (parsed.data.status === "stopped" && (!parsed.data.endDate || formData.get("confirm_stop") !== "yes")) {
        throw new Error("Give the last class date and confirm that you want to stop this enrollment")
    }

    const supabase = await requireUser()
    const { error } = await supabase.rpc("set_enrollment_status", {
        p_enrollment_id: parsed.data.enrollmentId,
        p_new_status: parsed.data.status,
        p_end_date: parsed.data.status === "stopped" ? parsed.data.endDate : null,
        p_reason: parsed.data.reason,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/enrollments")
    redirect(`/enrollments?saved=${parsed.data.status === "active" ? "resumed" : parsed.data.status}`)
}
