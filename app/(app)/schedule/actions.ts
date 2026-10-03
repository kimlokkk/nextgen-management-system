"use server"

import { createClient } from "@/lib/supabase/server"
import {
    generateClassSessions,
    type SessionTemplate,
} from "@/lib/scheduling"
import { redirect } from "next/navigation"
import { z } from "zod"

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
    } = await supabase
        .from("schedule_batches")
        .select("id, status")
        .eq("branch_id", branch_id)
        .eq("schedule_month", scheduleMonth)
        .maybeSingle()

    if (
        existingBatch &&
        existingBatch.status !== "draft"
    ) {
        throw new Error(
            "Schedule already approved or locked"
        )
    }

    /*
     * Kalau draft lama ada,
     * delete dulu dan regenerate clean.
     *
     * class_sessions + bookings cascade delete.
     */

    if (existingBatch) {
        const { error } = await supabase
            .from("schedule_batches")
            .delete()
            .eq("id", existingBatch.id)

        if (error) {
            throw new Error(error.message)
        }
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
     * --------------------------------------------------
     * Generate W1-W4 class sessions
     * --------------------------------------------------
     */

    const generatedSessions =
        generateClassSessions(
            sessionTemplates as SessionTemplate[],
            year,
            monthNumber
        )

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

        await supabase
            .from("schedule_batches")
            .delete()
            .eq("id", batch.id)

        throw error
    }

    redirect(`/schedule?batch=${batch.id}`)
}