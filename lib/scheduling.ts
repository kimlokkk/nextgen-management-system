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

export function generateClassSessions(
    sessions: SessionTemplate[],
    year: number,
    month: number
): GeneratedClassSession[] {
    const generated: GeneratedClassSession[] = []

    for (const session of sessions) {
        const matchingDates = getMonthlyDatesForDay(
            year,
            month,
            session.day_of_week
        )

        // TEMPORARY RULE:
        // W1 - W4 sahaja.
        // Occurrence ke-5 dianggap transition week
        // sehingga business rule disahkan admin.
        const regularDates = matchingDates.slice(0, 4)

        regularDates.forEach((classDate, index) => {
            generated.push({
                session_template_id: session.id,
                branch_id: session.branch_id,
                programme_id: session.programme_id,
                class_date: classDate,
                week_number: index + 1,
                start_time: session.start_time,
                end_time: session.end_time,
                regular_capacity: session.regular_capacity,
                replacement_capacity:
                    session.replacement_capacity,
            })
        })
    }

    return generated
}