export type CapacityBooking = {
    booking_type: string
    attendance_status: string
}

export function countsTowardsRegularCapacity(
    booking: CapacityBooking
) {
    if (
        booking.booking_type !== "regular" &&
        booking.booking_type !== "reschedule"
    ) {
        return false
    }

    return ![
        "rescheduled",
        "cancelled",
        "not_scheduled",
    ].includes(booking.attendance_status)
}

export function countsTowardsReplacementCapacity(
    booking: CapacityBooking
) {
    if (booking.booking_type !== "replacement") {
        return false
    }

    return ![
        "cancelled",
        "not_scheduled",
    ].includes(booking.attendance_status)
}