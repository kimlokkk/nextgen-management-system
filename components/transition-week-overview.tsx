import Link from "next/link"
import { ArrowRight, CalendarClock } from "lucide-react"
import { getMonthlyTeachingCycle } from "@/lib/scheduling"

type Props = {
    year: number
    month: number
    dayOfWeeks: number[]
    branchId: string
}

function readableDate(date: string) {
    return new Intl.DateTimeFormat("en-MY", {
        timeZone: "UTC", weekday: "long", day: "numeric", month: "short",
    }).format(new Date(`${date}T00:00:00Z`))
}

function readableMonth(month: string) {
    return new Intl.DateTimeFormat("en-MY", {
        timeZone: "UTC", month: "long", year: "numeric",
    }).format(new Date(`${month}-01T00:00:00Z`))
}

/**
 * Administrative planning is independent of regular lesson entitlements.
 * A four-week month has W4 + transition; a five-week month has W5
 * transition-only by default. Explicit calendar moves can use those dates.
 */
export function TransitionWeekOverview({ year, month, dayOfWeeks, branchId }: Props) {
    const cycles = [...new Set(dayOfWeeks)].map((weekday) =>
        getMonthlyTeachingCycle(year, month, weekday)
    ).sort((a, b) => a.transitionDate.localeCompare(b.transitionDate))
    if (!cycles.length) return null

    const nextMonth = cycles[0].nextMonth

    return (
        <section className="rounded-xl border bg-card p-4 sm:p-5" aria-label="Monthly transition and next-month planning">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <CalendarClock className="size-5 shrink-0 text-primary" aria-hidden="true" />
                        <h2 className="font-semibold">Transition week · next-month planning</h2>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                        The last occurrence of each class weekday is the transition week.
                        W5 is for preparing next month, not an automatic fifth regular lesson.
                        When a month has only four occurrences, W4 can be both a regular
                        class week and the planning week.
                    </p>
                </div>
                <Link href={`/schedule?prepare_month=${nextMonth}&branch=${encodeURIComponent(branchId)}`}
                    className="ui-secondary-action inline-flex shrink-0 items-center gap-2">
                    Prepare {readableMonth(nextMonth)} draft
                    <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
                {cycles.map((cycle) => (
                    <span key={cycle.transitionDate}
                        className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                        <span className="font-semibold">W{cycle.transitionWeek}</span>
                        <span className="ml-2 text-muted-foreground">{readableDate(cycle.transitionDate)}</span>
                        {cycle.transitionOnly && (
                            <span className="ml-2 text-xs text-muted-foreground">Planning only by default</span>
                        )}
                        {!cycle.transitionOnly && (
                            <span className="ml-2 text-xs text-muted-foreground">Regular + planning</span>
                        )}
                    </span>
                ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Preparing a draft does not approve, lock or send it.
                An explicitly moved W4 lesson keeps its W4 number even when held on a W5 date.
            </p>
        </section>
    )
}
