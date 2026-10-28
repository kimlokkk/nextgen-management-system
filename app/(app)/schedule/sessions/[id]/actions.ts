"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { z } from "zod"

const rescheduleSchema = z.object({
    booking_id: z.string().uuid(),
    session_id: z.string().uuid(),
})

const replacementSchema = z.object({
    booking_id: z.string().uuid(),
    session_id: z.string().uuid(),
    mode: z.enum(["planned", "absent"]),
})

// =====================================================
// ATOMIC RESCHEDULE INITIATION (migration 025)
// The database RPC checks admin permission, booking/class/batch state and any
// existing obligation, then creates (or reopens) the reschedule obligation AND
// marks the booking rescheduled in ONE transaction, serialised per booking.
// There is deliberately no multi-step write or best-effort cleanup here.
// =====================================================

export async function markForReschedule(
    formData: FormData
) {
    const parsed = rescheduleSchema.safeParse({
        booking_id: formData.get("booking_id"),
        session_id: formData.get("session_id"),
    })

    if (!parsed.success) {
        throw new Error("Invalid reschedule request")
    }

    const { booking_id, session_id } = parsed.data
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    const { error } = await supabase.rpc(
        "initiate_reschedule_obligation",
        {
            p_booking_id: booking_id,
            p_session_id: session_id,
        }
    )

    if (error) {
        throw new Error(error.message)
    }

    redirect(`/schedule/sessions/${session_id}`)
}

// =====================================================
// REPLACEMENT ENGINE V1: CREATE / CONFIRM OBLIGATION
// The database RPC handles permission, concurrency and
// atomic updates. Never release the source regular seat.
// =====================================================

export async function initiateReplacement(formData: FormData) {
    const parsed = replacementSchema.safeParse({
        booking_id: formData.get("booking_id"),
        session_id: formData.get("session_id"),
        mode: formData.get("mode"),
    })

    if (!parsed.success) {
        throw new Error("Invalid replacement request")
    }

    const { booking_id, session_id, mode } = parsed.data
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        throw new Error("Unauthorized")
    }

    const { error } = await supabase.rpc(
        "initiate_replacement_obligation",
        {
            p_booking_id: booking_id,
            p_session_id: session_id,
            p_mode: mode,
        }
    )

    if (error) {
        throw new Error(error.message)
    }

    redirect(`/schedule/sessions/${session_id}`)
}

const attendanceSchema = z.object({
    booking_id: z.string().uuid(),
    session_id: z.string().uuid(),
    attendance: z.enum(["present", "absent"]),
})

export async function recordAttendance(formData: FormData) {
    const parsed = attendanceSchema.safeParse({
        booking_id: formData.get("booking_id"),
        session_id: formData.get("session_id"),
        attendance: formData.get("attendance"),
    })

    if (!parsed.success) {
        throw new Error("Invalid attendance request")
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        throw new Error("Unauthorized")
    }

    // Atomic SQL RPC enforces admin role, class-end time, booking type
    // and the linked makeup obligation before updating attendance.
    const { error } = await supabase.rpc("record_class_attendance", {
        p_booking_id: parsed.data.booking_id,
        p_class_session_id: parsed.data.session_id,
        p_attendance: parsed.data.attendance,
    })

    if (error) {
        throw new Error(error.message)
    }

    redirect(`/schedule/sessions/${parsed.data.session_id}`)
}
