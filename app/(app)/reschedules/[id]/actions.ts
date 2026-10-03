"use server"

import { createClient } from "@/lib/supabase/server"
import {
    countsTowardsRegularCapacity,
} from "@/lib/reschedule-policy"
import { redirect } from "next/navigation"
import { z } from "zod"

const assignSchema = z.object({
    obligation_id: z.string().uuid(),
    target_session_id: z.string().uuid(),
})

function getMalaysiaDate() {
    const parts =
        new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Kuala_Lumpur",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(new Date())

    const year =
        parts.find(
            (part) => part.type === "year"
        )?.value ?? ""

    const month =
        parts.find(
            (part) => part.type === "month"
        )?.value ?? ""

    const day =
        parts.find(
            (part) => part.type === "day"
        )?.value ?? ""

    return `${year}-${month}-${day}`
}

export async function assignRescheduleSlot(
    formData: FormData
) {
    const supabase = await createClient()

    // =====================================================
    // AUTH
    // =====================================================

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    const { data: profile } =
        await supabase
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
            "You do not have permission to assign reschedules"
        )
    }

    // =====================================================
    // INPUT
    // =====================================================

    const parsed = assignSchema.safeParse({
        obligation_id:
            formData.get("obligation_id"),
        target_session_id:
            formData.get("target_session_id"),
    })

    if (!parsed.success) {
        throw new Error(
            "Invalid reschedule assignment"
        )
    }

    const {
        obligation_id,
        target_session_id,
    } = parsed.data

    // =====================================================
    // OBLIGATION
    // =====================================================

    const {
        data: obligation,
        error: obligationError,
    } = await supabase
        .from("makeup_obligations")
        .select(`
      id,
      student_id,
      enrollment_id,
      source_booking_id,
      obligation_type,
      status,
      target_booking_id
    `)
        .eq("id", obligation_id)
        .single()

    if (
        obligationError ||
        !obligation
    ) {
        throw new Error(
            "Reschedule obligation not found"
        )
    }

    if (
        obligation.obligation_type !==
        "reschedule"
    ) {
        throw new Error(
            "This obligation is not a reschedule"
        )
    }

    if (obligation.status !== "open") {
        throw new Error(
            "Only open reschedules can be assigned"
        )
    }

    if (obligation.target_booking_id) {
        throw new Error(
            "This reschedule already has a target booking"
        )
    }

    // =====================================================
    // ORIGINAL BOOKING + CLASS
    // =====================================================

    const { data: sourceBooking } =
        await supabase
            .from("student_bookings")
            .select(`
        id,
        class_session_id,
        attendance_status
      `)
            .eq(
                "id",
                obligation.source_booking_id
            )
            .single()

    if (!sourceBooking) {
        throw new Error(
            "Original booking not found"
        )
    }

    if (
        sourceBooking.attendance_status !==
        "rescheduled"
    ) {
        throw new Error(
            "Original booking is not marked as rescheduled"
        )
    }

    const { data: originalClass } =
        await supabase
            .from("class_sessions")
            .select(`
        id,
        branch_id,
        programme_id
      `)
            .eq(
                "id",
                sourceBooking.class_session_id
            )
            .single()

    if (!originalClass) {
        throw new Error(
            "Original class not found"
        )
    }

    // =====================================================
    // TARGET CLASS
    // =====================================================

    const {
        data: targetClass,
        error: targetError,
    } = await supabase
        .from("class_sessions")
        .select(`
      id,
      schedule_batch_id,
      branch_id,
      programme_id,
      class_date,
      regular_capacity,
      status
    `)
        .eq("id", target_session_id)
        .single()

    if (
        targetError ||
        !targetClass
    ) {
        throw new Error(
            "Target class not found"
        )
    }

    if (
        targetClass.id ===
        originalClass.id
    ) {
        throw new Error(
            "Student cannot be rescheduled into the original class"
        )
    }

    if (
        targetClass.branch_id !==
        originalClass.branch_id
    ) {
        throw new Error(
            "Reschedule must remain in the same branch"
        )
    }

    if (
        targetClass.programme_id !==
        originalClass.programme_id
    ) {
        throw new Error(
            "Reschedule must remain in the same programme"
        )
    }

    if (
        targetClass.status !== "scheduled"
    ) {
        throw new Error(
            "Target class is not scheduled"
        )
    }

    if (
        targetClass.class_date <
        getMalaysiaDate()
    ) {
        throw new Error(
            "Cannot assign a reschedule to a past class"
        )
    }

    // =====================================================
    // TARGET BATCH MUST BE LOCKED
    // =====================================================

    const { data: targetBatch } =
        await supabase
            .from("schedule_batches")
            .select("status")
            .eq(
                "id",
                targetClass.schedule_batch_id
            )
            .single()

    if (
        !targetBatch ||
        targetBatch.status !== "locked"
    ) {
        throw new Error(
            "Target schedule must be locked"
        )
    }

    // =====================================================
    // STUDENT CANNOT ALREADY BE IN TARGET
    // =====================================================

    const { data: existingBooking } =
        await supabase
            .from("student_bookings")
            .select("id")
            .eq(
                "class_session_id",
                targetClass.id
            )
            .eq(
                "student_id",
                obligation.student_id
            )
            .maybeSingle()

    if (existingBooking) {
        throw new Error(
            "Student already has a booking in this class"
        )
    }

    // =====================================================
    // REGULAR CAPACITY
    // Provisional V1 policy:
    // reschedule uses vacant regular capacity.
    // =====================================================

    const { data: targetBookings } =
        await supabase
            .from("student_bookings")
            .select(`
        booking_type,
        attendance_status
      `)
            .eq(
                "class_session_id",
                targetClass.id
            )

    const occupiedRegular =
        targetBookings?.filter(
            (booking) =>
                countsTowardsRegularCapacity(
                    booking
                )
        ).length ?? 0

    if (
        occupiedRegular >=
        targetClass.regular_capacity
    ) {
        throw new Error(
            "Target class has no vacant regular capacity"
        )
    }

    // =====================================================
    // CREATE TARGET BOOKING
    // =====================================================

    const {
        data: targetBooking,
        error: bookingError,
    } = await supabase
        .from("student_bookings")
        .insert({
            class_session_id:
                targetClass.id,

            student_id:
                obligation.student_id,

            enrollment_id:
                obligation.enrollment_id,

            booking_type:
                "reschedule",

            attendance_status:
                "upcoming",
        })
        .select("id")
        .single()

    if (
        bookingError ||
        !targetBooking
    ) {
        throw new Error(
            bookingError?.message ??
            "Unable to create reschedule booking"
        )
    }

    // =====================================================
    // COMPLETE OBLIGATION ASSIGNMENT
    // =====================================================

    const {
        data: updatedObligation,
        error: updateError,
    } = await supabase
        .from("makeup_obligations")
        .update({
            status: "scheduled",
            target_booking_id:
                targetBooking.id,
            updated_at:
                new Date().toISOString(),
        })
        .eq("id", obligation.id)
        .eq("status", "open")
        .select("id")
        .maybeSingle()

    if (
        updateError ||
        !updatedObligation
    ) {
        /*
         * Rollback target booking jika
         * obligation gagal update.
         */

        await supabase
            .from("student_bookings")
            .delete()
            .eq("id", targetBooking.id)

        throw new Error(
            updateError?.message ??
            "Reschedule status changed before assignment completed"
        )
    }

    redirect("/reschedules")
}