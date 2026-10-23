/**
 * A legacy Excel booking and an active NextGen replacement may represent the
 * SAME reservation only when an explicit, validated booking ID link exists.
 * Never deduplicate by student name alone (names need not be unique).
 */
export type OccupyingYellowBooking = {
    id: string
    class_session_id: string
    booking_type: string
    attendance_status: string
}

export type ConfirmedLegacyReservation = {
    target_class_id: string | null
    review_state: string
    linked_active_booking_id: string | null
}

export type YellowSeatUsage = {
    active: number
    legacy: number
    occupied: number
    capacity: number
    available: number
    overBy: number
}

const isActiveYellow = (booking: OccupyingYellowBooking) =>
    booking.booking_type === "replacement"
    && !["cancelled", "not_scheduled"].includes(booking.attendance_status)

export function getYellowSeatUsage(
    classId: string,
    capacity: number,
    bookings: OccupyingYellowBooking[],
    legacyReservations: ConfirmedLegacyReservation[],
): YellowSeatUsage {
    const activeIds = new Set(
        bookings.filter((booking) => booking.class_session_id === classId && isActiveYellow(booking))
            .map((booking) => booking.id)
    )
    const legacy = legacyReservations.filter((reservation) =>
        reservation.target_class_id === classId
        && reservation.review_state !== "excluded"
        && (!reservation.linked_active_booking_id || !activeIds.has(reservation.linked_active_booking_id))
    ).length
    const occupied = activeIds.size + legacy
    return {
        active: activeIds.size,
        legacy,
        occupied,
        capacity,
        available: Math.max(0, capacity - occupied),
        overBy: Math.max(0, occupied - capacity),
    }
}
