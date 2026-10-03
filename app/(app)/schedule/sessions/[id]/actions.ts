"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { z } from "zod"

const rescheduleSchema = z.object({
    booking_id: z.string().uuid(),
    session_id: z.string().uuid(),
})

export async function markForReschedule(
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
     * Admin permission
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
            "You do not have permission to reschedule students"
        )
    }

    /*
     * Validate input
     */

    const parsed = rescheduleSchema.safeParse({
        booking_id: formData.get("booking_id"),
        session_id: formData.get("session_id"),
    })

    if (!parsed.success) {
        throw new Error(
            "Invalid reschedule request"
        )
    }

    const {
        booking_id,
        session_id,
    } = parsed.data

    /*
     * Get original booking
     */

    const {
        data: booking,
        error: bookingError,
    } = await supabase
        .from("student_bookings")
        .select(`
      id,
      class_session_id,
      student_id,
      enrollment_id,
      booking_type,
      attendance_status
    `)
        .eq("id", booking_id)
        .single()

    if (bookingError || !booking) {
        throw new Error(
            "Student booking not found"
        )
    }

    if (
        booking.class_session_id !==
        session_id
    ) {
        throw new Error(
            "Booking does not belong to this class"
        )
    }

    /*
     * For now, only normal regular bookings
     * can initiate a reschedule.
     */

    if (booking.booking_type !== "regular") {
        throw new Error(
            "Only regular bookings can be rescheduled"
        )
    }

    if (
        booking.attendance_status !==
        "upcoming"
    ) {
        throw new Error(
            "Only upcoming bookings can be rescheduled"
        )
    }

    /*
     * Class must belong to LOCKED schedule
     */

    const {
        data: classSession,
        error: classError,
    } = await supabase
        .from("class_sessions")
        .select(`
        schedule_batch_id,
        class_date,
        status
    `)
        .eq("id", session_id)
        .single()

    if (classError || !classSession) {
        throw new Error(
            "Class session not found"
        )
    }

    if (classSession.status !== "scheduled") {
        throw new Error(
            "Only scheduled classes can be rescheduled"
        )
    }

    const {
        data: batch,
        error: batchError,
    } = await supabase
        .from("schedule_batches")
        .select("status")
        .eq(
            "id",
            classSession.schedule_batch_id
        )
        .single()

    if (batchError || !batch) {
        throw new Error(
            "Schedule batch not found"
        )
    }

    if (batch.status !== "locked") {
        throw new Error(
            "Schedule must be locked before rescheduling students"
        )
    }

    /*
 * Existing obligation
 *
 * If previously cancelled, reuse it.
 * Otherwise prevent duplicate active obligation.
 */

    const {
        data: existing,
        error: existingError,
    } = await supabase
        .from("makeup_obligations")
        .select(`
        id,
        status,
        obligation_type
    `)
        .eq(
            "source_booking_id",
            booking.id
        )
        .maybeSingle()

    if (existingError) {
        throw new Error(
            existingError.message
        )
    }

    let obligation: {
        id: string
    } | null = null

    let reusedCancelledObligation = false

    if (existing) {
        if (
            existing.obligation_type !==
            "reschedule"
        ) {
            throw new Error(
                "This booking already has another makeup obligation"
            )
        }

        if (
            existing.status !==
            "cancelled"
        ) {
            throw new Error(
                "This booking already has a makeup obligation"
            )
        }

        const {
            data: reopenedObligation,
            error: reopenError,
        } = await supabase
            .from("makeup_obligations")
            .update({
                status: "open",
                target_booking_id: null,
                reason: null,
                created_by: user.id,
                updated_at:
                    new Date().toISOString(),
            })
            .eq("id", existing.id)
            .eq("status", "cancelled")
            .select("id")
            .maybeSingle()

        if (
            reopenError ||
            !reopenedObligation
        ) {
            throw new Error(
                reopenError?.message ??
                "Unable to reopen cancelled reschedule"
            )
        }

        obligation =
            reopenedObligation

        reusedCancelledObligation = true
    } else {
        const {
            data: newObligation,
            error: obligationError,
        } = await supabase
            .from("makeup_obligations")
            .insert({
                student_id:
                    booking.student_id,
                enrollment_id:
                    booking.enrollment_id,
                source_booking_id:
                    booking.id,
                obligation_type:
                    "reschedule",
                status: "open",
                created_by: user.id,
            })
            .select("id")
            .single()

        if (
            obligationError ||
            !newObligation
        ) {
            throw new Error(
                obligationError?.message ??
                "Unable to create reschedule obligation"
            )
        }

        obligation =
            newObligation
    }

    /*
     * Mark original class as rescheduled.
     *
     * NOT absent.
     */

    const {
        data: updatedBooking,
        error: updateError,
    } = await supabase
        .from("student_bookings")
        .update({
            attendance_status:
                "rescheduled",
            updated_at:
                new Date().toISOString(),
        })
        .eq("id", booking.id)
        .eq(
            "attendance_status",
            "upcoming"
        )
        .select("id")
        .maybeSingle()

    /*
     * Cleanup if second operation failed
     */

    if (
        updateError ||
        !updatedBooking
    ) {
        if (obligation) {
            if (reusedCancelledObligation) {
                await supabase
                    .from("makeup_obligations")
                    .update({
                        status: "cancelled",
                        updated_at:
                            new Date().toISOString(),
                    })
                    .eq(
                        "id",
                        obligation.id
                    )
            } else {
                await supabase
                    .from("makeup_obligations")
                    .delete()
                    .eq(
                        "id",
                        obligation.id
                    )
            }
        }

        throw new Error(
            updateError?.message ??
            "Booking status changed before reschedule could be completed"
        )
    }

    redirect(
        `/schedule/sessions/${session_id}`
    )
}