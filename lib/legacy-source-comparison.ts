/**
 * Read-only evidence comparison for imported historical replacement records.
 * Matching names/dates are merely textual similarities, NEVER entitlement
 * confirmation, identity verification or grounds to update attendance.
 */
export type CandidateFieldComparison = "same_text" | "different_text" | "unavailable"

export type OriginalBookingCandidate = {
    studentName: string | null
    classDate: string | null
    startTime: string | null
    endTime: string | null
    bookingType: string
    attendanceStatus: string
}

function normalizedName(value: string) {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en")
}

export function compareLegacyOriginalCandidate(
    importedName: string,
    importedOriginalDate: string | null,
    candidate: OriginalBookingCandidate,
): {
    name: CandidateFieldComparison
    date: CandidateFieldComparison
    originalMarkedPresent: boolean
} {
    const name: CandidateFieldComparison = candidate.studentName
        ? normalizedName(importedName) === normalizedName(candidate.studentName) ? "same_text" : "different_text"
        : "unavailable"
    const date: CandidateFieldComparison = candidate.classDate && importedOriginalDate
        ? candidate.classDate === importedOriginalDate ? "same_text" : "different_text"
        : "unavailable"
    return {
        name,
        date,
        originalMarkedPresent: candidate.attendanceStatus === "present",
    }
}
