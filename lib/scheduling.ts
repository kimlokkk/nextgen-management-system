export type SessionTemplate = {
    id: string
    branch_id: string
    programme_id: string
    day_of_week: number
    start_time: string
    end_time: string
    regular_capacity: number
    replacement_capacity: number
}

export type CalendarException = {
    closed_on: string
    decision: "pending" | "move" | "skip" | "withdrawn"
    target_on: string | null
}

export type GeneratedClassSession = {
    session_template_id: string
    branch_id: string
    programme_id: string
    class_date: string
    week_number: number
    start_time: string
    end_time: string
    regular_capacity: number
    replacement_capacity: number
}

function formatDate(year: number, month: number, day: number) {
    const yyyy = String(year)
    const mm = String(month).padStart(2, "0")
    const dd = String(day).padStart(2, "0")

    return `${yyyy}-${mm}-${dd}`
}

export function getMonthlyDatesForDay(
    year: number,
    month: number,
    dayOfWeek: number
) {
    const dates: string[] = []

    const daysInMonth = new Date(
        Date.UTC(year, month, 0)
    ).getUTCDate()

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(
            Date.UTC(year, month - 1, day)
        )

        if (date.getUTCDay() === dayOfWeek) {
            dates.push(
                formatDate(year, month, day)
            )
        }
    }

    return dates
}

/**
 * A monthly teaching cycle has at most four default regular lessons.
 * The FINAL occurrence of a weekday is the administrative transition week:
 * W5 when there are five occurrences (not a fifth paid lesson by default),
 * otherwise W4, which can also be a normal teaching week.
 *
 * Transition week is for preparing/reviewing next month's draft.
 * It must never change a student's entitlement without an explicit policy.
 */
export function getMonthlyTeachingCycle(
    year: number,
    month: number,
    dayOfWeek: number
) {
    const dates = getMonthlyDatesForDay(year, month, dayOfWeek)
    if (dates.length === 0) throw new Error("No dates for this weekday")
    const regularDates = dates.slice(0, 4)
    const transitionWeek = dates.length
    const transitionDate = dates[dates.length - 1]
    const nextMonthDate = new Date(Date.UTC(year, month, 1))
    const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}`
    return {
        regularDates,
        transitionDate,
        transitionWeek,
        transitionOnly: transitionWeek > regularDates.length,
        nextMonth,
    }
}

export function generateClassSessions(
    sessions: SessionTemplate[],
    year: number,
    month: number,
    calendarExceptions: CalendarException[] = []
): GeneratedClassSession[] {
    const generated: GeneratedClassSession[] = []
    const exceptions = new Map(calendarExceptions.map((item) => [item.closed_on, item]))
    const monthKey = `${year}-${String(month).padStart(2, "0")}`

    for (const session of sessions) {
        const { regularDates } = getMonthlyTeachingCycle(
            year, month, session.day_of_week
        )

        const usedDates = new Set<string>()
        regularDates.forEach((originalDate, index) => {
            const closure = exceptions.get(originalDate)
            if (closure?.decision === "pending") {
                throw new Error(`Calendar decision pending for ${originalDate}; resolve it before generating schedules.`)
            }

            if (closure?.decision === "skip") return

            let classDate = originalDate
            if (closure?.decision === "move") {
                const target = closure.target_on
                if (!target || target.slice(0, 7) !== monthKey || target <= originalDate
                    || new Date(`${target}T00:00:00Z`).getUTCDay() !== session.day_of_week) {
                    throw new Error(`Invalid move date for ${originalDate}. Choose a later date on the same weekday and in the same month.`)
                }
                const destinationClosure = exceptions.get(target)
                if (destinationClosure && !["withdrawn"].includes(destinationClosure.decision)) {
                    throw new Error(`Cannot move class from ${originalDate} to ${target}: the destination has a calendar event.`)
                }
                classDate = target
            }

            if (usedDates.has(classDate)) {
                throw new Error(`Calendar conflict for session ${session.id}: class date ${classDate} is already used. Choose another move date.`)
            }
            usedDates.add(classDate)

            generated.push({
                session_template_id: session.id,
                branch_id: session.branch_id,
                programme_id: session.programme_id,
                class_date: classDate,
                week_number: index + 1,
                start_time: session.start_time,
                end_time: session.end_time,
                regular_capacity: session.regular_capacity,
                replacement_capacity: session.replacement_capacity,
            })
        })
    }

    return generated
}