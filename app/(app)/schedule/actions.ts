"use server"

import { createClient } from "@/lib/supabase/server"
import {
    generateClassSessions,
    type SessionTemplate,
} from "@/lib/scheduling"
import { redirect } from "next/navigation"
import { z } from "zod"
import { getScheduleBatchValidation } from "@/lib/schedule-validation"
import { validateScheduleTransition } from "@/lib/schedule-transition-policy"

const generateSchema = z.object({
    branch_id: z.string().uuid(),
    month: z.string().regex(/^\d{4}-\d{2}$/),
})

export async function generateSchedule(
    formData: FormData
) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }
    const { data: profile, error: profileError } = await supabase.from("profiles")
        .select("role,is_active").eq("id",user.id).single()
    if (profileError || !profile?.is_active || !["admin","super_admin"].includes(profile.role)) {
        throw new Error("Only active admins may generate a schedule")
    }

    const parsed = generateSchema.safeParse({
        branch_id: formData.get("branch_id"),
        month: formData.get("month"),
    })

    if (!parsed.success) {
        throw new Error("Invalid schedule request")
    }

    const {
        branch_id,
        month,
    } = parsed.data

    const [yearString, monthString] =
        month.split("-")

    const year = Number(yearString)
    const monthNumber = Number(monthString)

    const scheduleMonth = `${month}-01`

    /*
     * --------------------------------------------------
     * Check existing batch
     * --------------------------------------------------
     */

    const {
        data: existingBatch,
        error: existingBatchError,
    } = await supabase
        .from("schedule_batches")
        .select("id, status")
        .eq("branch_id", branch_id)
        .eq("schedule_month", scheduleMonth)
        .maybeSingle()

    // Hard fail closed: no schedule with existing class IDs is ever regenerated.
    if (existingBatchError) throw new Error(existingBatchError.message)
    if (existingBatch) {
        throw new Error("A monthly schedule already exists for this branch. Open it instead. Regeneration is disabled to preserve class IDs and bookings.")
    }
    const { data: branch, error: branchError } = await supabase.from("branches")
        .select("id,is_active").eq("id",branch_id).single()
    if (branchError || !branch?.is_active) {
        throw new Error("Selected branch is inactive or unavailable")
    }

    /*
     * --------------------------------------------------
     * Load session templates
     * --------------------------------------------------
     */

    const {
        data: sessionTemplates,
        error: sessionError,
    } = await supabase
        .from("session_templates")
        .select(`
      id,
      branch_id,
      programme_id,
      day_of_week,
      start_time,
      end_time,
      regular_capacity,
      replacement_capacity
    `)
        .eq("branch_id", branch_id)
        .eq("is_active", true)

    if (sessionError) {
        throw new Error(sessionError.message)
    }

    if (!sessionTemplates?.length) {
        throw new Error(
            "No active session templates found for this branch"
        )
    }

    /*
     * Calendar V1: admin decisions are resolved BEFORE any draft is deleted.
     * A pending closure blocks generation; a move retains its W number.
     */
    const monthEnd = `${month}-${new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()}`
    const { data: calendarRows, error: calendarError } = await supabase
        .from("academic_calendar_exceptions")
        .select("closed_on, decision, target_on")
        .eq("branch_id", branch_id)
        .gte("closed_on", scheduleMonth)
        .lte("closed_on", monthEnd)

    if (calendarError) {
        throw new Error(`Could not load Academic Calendar. Apply migration 016 if needed: ${calendarError.message}`)
    }

    const generatedSessions = generateClassSessions(
        sessionTemplates as SessionTemplate[],
        year,
        monthNumber,
        (calendarRows ?? []).map((row) => ({
            closed_on: row.closed_on,
            decision: row.decision as "pending" | "move" | "skip" | "withdrawn",
            target_on: row.target_on,
        }))
    )

    if (generatedSessions.length === 0) {
        throw new Error("No classes remain after calendar decisions. Review your Academic Calendar.")
    }

    // IMPORTANT: Never delete/recreate a draft in the generation path.
    // A new batch is the only supported safe operation until an atomic
    // in-database generation transaction and versioned regeneration are built.

    /*
     * --------------------------------------------------
     * Create schedule batch
     * --------------------------------------------------
     */

    const {
        data: batch,
        error: batchError,
    } = await supabase
        .from("schedule_batches")
        .insert({
            branch_id,
            schedule_month: scheduleMonth,
            status: "draft",
            generated_by: user.id,
        })
        .select("id")
        .single()

    if (batchError) {
        throw new Error(batchError.message)
    }

    try {
        /*
         * ------------------------------------------------
         * Insert actual classes
         * ------------------------------------------------
         */

        const classRows = generatedSessions.map(
            (session) => ({
                schedule_batch_id: batch.id,
                ...session,
            })
        )

        const {
            data: createdClasses,
            error: classError,
        } = await supabase
            .from("class_sessions")
            .insert(classRows)
            .select(`
        id,
        session_template_id,
        class_date,
        week_number,
        regular_capacity
      `)

        if (classError) {
            throw classError
        }

        /*
         * ------------------------------------------------
         * Load active enrollments
         * ------------------------------------------------
         */

        const {
            data: enrollments,
            error: enrollmentError,
        } = await supabase
            .from("enrollments")
            .select(`
        id,
        student_id,
        default_session_id,
        frequency_type,
        preferred_weeks,
        start_date,
        end_date,
        status
      `)
            .eq("branch_id", branch_id)
            .eq("status", "active")

        if (enrollmentError) {
            throw enrollmentError
        }

        /*
         * ------------------------------------------------
         * Generate regular student bookings
         * ------------------------------------------------
         */

        const bookings: {
            class_session_id: string
            student_id: string
            enrollment_id: string
            booking_type: "regular"
            attendance_status: "upcoming"
        }[] = []

        for (const classSession of createdClasses ?? []) {
            const eligibleEnrollments =
                enrollments?.filter(
                    (enrollment) => {
                        if (
                            enrollment.default_session_id !==
                            classSession.session_template_id
                        ) {
                            return false
                        }

                        /*
                         * Enrollment belum start
                         */

                        if (
                            enrollment.start_date >
                            classSession.class_date
                        ) {
                            return false
                        }

                        /*
                         * Enrollment dah tamat
                         */

                        if (
                            enrollment.end_date &&
                            enrollment.end_date <
                            classSession.class_date
                        ) {
                            return false
                        }

                        /*
                         * Weekly
                         */

                        if (
                            enrollment.frequency_type ===
                            "weekly"
                        ) {
                            return true
                        }

                        /*
                         * Twice monthly / Custom
                         */

                        const preferredWeeks =
                            enrollment.preferred_weeks ?? []

                        return preferredWeeks.includes(
                            classSession.week_number
                        )
                    }
                ) ?? []

            for (const enrollment of eligibleEnrollments) {
                bookings.push({
                    class_session_id: classSession.id,
                    student_id: enrollment.student_id,
                    enrollment_id: enrollment.id,
                    booking_type: "regular",
                    attendance_status: "upcoming",
                })
            }
        }

        if (bookings.length > 0) {
            const { error: bookingError } =
                await supabase
                    .from("student_bookings")
                    .insert(bookings)

            if (bookingError) {
                throw bookingError
            }
        }
    } catch (error) {
        /*
         * Kalau generation separuh jalan gagal,
         * cleanup batch supaya DB tak tinggal
         * half-generated schedule.
         */

        const { error: cleanupError } = await supabase
            .from("schedule_batches")
            .delete()
            .eq("id", batch.id)
            .eq("status", "draft")
        if (cleanupError) {
            throw new Error("New draft creation failed and cleanup failed. Do not retry: ask a developer to inspect batch " +
                batch.id + ". Original error: " + (error instanceof Error ? error.message : String(error)) +
                ". Cleanup error: " + cleanupError.message)
        }
        throw error
    }

    redirect(`/schedule?batch=${batch.id}`)
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