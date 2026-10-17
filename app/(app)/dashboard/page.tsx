import Link from "next/link"
import {
    ArrowRight,
    CalendarDays,
    CheckCircle2,
    ClipboardCheck,
    Clock3,
    GraduationCap,
    RefreshCw,
    UsersRound,
} from "lucide-react"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type ClassSession = {
    id: string
    schedule_batch_id: string
    branch_id: string
    programme_id: string
    class_date: string
    start_time: string
    end_time: string
}

type AttendanceBooking = {
    id: string
    class_session_id: string
    attendance_status: string
}

function malaysiaClock(now: Date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kuala_Lumpur",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now)
    const part = (key: string) => parts.find((item) => item.type === key)?.value ?? "00"

    return {
        date: `${part("year")}-${part("month")}-${part("day")}`,
        time: `${part("hour")}:${part("minute")}:${part("second")}`,
    }
}

function addDays(date: string, days: number) {
    const value = new Date(`${date}T00:00:00Z`)
    value.setUTCDate(value.getUTCDate() + days)
    return value.toISOString().slice(0, 10)
}

function displayDate(date: string) {
    return new Intl.DateTimeFormat("en-MY", {
        timeZone: "UTC",
        weekday: "short",
        day: "numeric",
        month: "short",
    }).format(new Date(`${date}T00:00:00Z`))
}

function monthTitle(date: string) {
    return new Intl.DateTimeFormat("en-MY", {
        timeZone: "UTC",
        month: "long",
        year: "numeric",
    }).format(new Date(`${date.slice(0, 7)}-01T00:00:00Z`))
}

function isEnded(session: Pick<ClassSession, "class_date" | "end_time">, today: string, time: string) {
    return session.class_date < today
        || (session.class_date === today && session.end_time <= time)
}

function number(value: number | null) {
    return (value ?? 0).toLocaleString("en-MY")
}

export default async function DashboardPage() {
    const supabase = await createClient()
    const { date: today, time: localTime } = malaysiaClock(new Date())
    const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay()
    const weekStart = addDays(today, -((dayOfWeek + 6) % 7))
    const weekEnd = addDays(weekStart, 6)
    const monthStart = `${today.slice(0, 7)}-01`
    const [year, month] = today.slice(0, 7).split("-").map(Number)
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
    const windowStart = weekStart < monthStart ? weekStart : monthStart
    const windowEnd = weekEnd > monthEnd ? weekEnd : monthEnd

    // Keep the server-side data queries user-scoped via Supabase Auth/RLS.
    // Never use a service-role client to render dashboard statistics.
    const [
        studentsResult,
        enrollmentsResult,
        replacementCountResult,
        rescheduleCountResult,
        openObligationsResult,
        branchesResult,
        programmesResult,
    ] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("enrollments").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("makeup_obligations").select("id", { count: "exact", head: true })
            .eq("obligation_type", "replacement").eq("status", "open"),
        supabase.from("makeup_obligations").select("id", { count: "exact", head: true })
            .eq("obligation_type", "reschedule").eq("status", "open"),
        supabase.from("makeup_obligations")
            .select("id, student_id, source_booking_id, obligation_type, created_at")
            .eq("status", "open")
            .order("created_at", { ascending: true })
            .limit(12),
        supabase.from("branches").select("id, name"),
        supabase.from("programmes").select("id, name"),
    ])

    const firstError = [
        studentsResult.error, enrollmentsResult.error, replacementCountResult.error,
        rescheduleCountResult.error, openObligationsResult.error,
        branchesResult.error, programmesResult.error,
    ].find(Boolean)

    if (firstError) {
        console.error("Dashboard failed to load:", firstError.message)
        return (
            <div className="rounded-xl border bg-background p-6">
                <h1 className="text-2xl font-bold">Dashboard unavailable</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Could not read dashboard data. Please try refreshing or check your account permissions.
                </p>
                <Link className="mt-4 inline-block text-sm font-medium underline" href="/dashboard">
                    Retry dashboard
                </Link>
            </div>
        )
    }

    const branchMap = new Map((branchesResult.data ?? []).map((branch) => [branch.id, branch.name]))
    const programmeMap = new Map((programmesResult.data ?? []).map((programme) => [programme.id, programme.name]))

    // Paginate sessions; Supabase projects can cap result sizes to 1,000 rows.
    // The date window covers the entire month and the current Monday-Sunday week,
    // even when the week crosses a month boundary.
    const allSessions: ClassSession[] = []
    let sessionError: string | null = null
    for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("class_sessions")
            .select("id, schedule_batch_id, branch_id, programme_id, class_date, start_time, end_time")
            .eq("status", "scheduled")
            .gte("class_date", windowStart)
            .lte("class_date", windowEnd)
            .order("class_date")
            .order("start_time")
            .order("id")
            .range(offset, offset + 499)

        if (error) {
            sessionError = error.message
            break
        }
        const rows = (data ?? []) as ClassSession[]
        allSessions.push(...rows)
        if (rows.length < 500) break
    }

    if (sessionError) {
        console.error("Dashboard sessions unavailable:", sessionError)
        return <p className="text-destructive">Could not load classes for this month. Please refresh.</p>
    }

    const batchIds = [...new Set(allSessions.map((session) => session.schedule_batch_id))]
    const { data: batches, error: batchesError } = batchIds.length
        ? await supabase.from("schedule_batches").select("id, status").in("id", batchIds)
        : { data: [], error: null }

    if (batchesError) {
        console.error("Dashboard batch status unavailable:", batchesError.message)
        return <p className="text-destructive">Could not load schedule status. Please refresh.</p>
    }

    const lockedBatches = new Set((batches ?? [])
        .filter((batch) => batch.status === "locked").map((batch) => batch.id))
    const lockedSessions = allSessions.filter((session) => lockedBatches.has(session.schedule_batch_id))
    const weekSessions = lockedSessions.filter((session) =>
        session.class_date >= weekStart && session.class_date <= weekEnd
    )
    const endedMonthSessions = lockedSessions.filter((session) =>
        session.class_date >= monthStart && session.class_date <= monthEnd
        && isEnded(session, today, localTime)
    )

    const bookings: AttendanceBooking[] = []
    const endedSessionIds = endedMonthSessions.map((session) => session.id)

    for (let index = 0; index < endedSessionIds.length; index += 40) {
        const chunk = endedSessionIds.slice(index, index + 40)
        for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabase.from("student_bookings")
                .select("id, class_session_id, attendance_status")
                .in("class_session_id", chunk)
                .in("attendance_status", ["upcoming", "present", "absent"])
                .order("id")
                .range(offset, offset + 499)

            if (error) {
                console.error("Dashboard attendance unavailable:", error.message)
                return <p className="text-destructive">Could not load attendance totals. Please refresh.</p>
            }

            const rows = (data ?? []) as AttendanceBooking[]
            bookings.push(...rows)
            if (rows.length < 500) break
        }
    }

    const totalPresent = bookings.filter((booking) => booking.attendance_status === "present").length
    const totalAbsent = bookings.filter((booking) => booking.attendance_status === "absent").length
    const totalUnmarked = bookings.filter((booking) => booking.attendance_status === "upcoming").length
    const recorded = totalPresent + totalAbsent
    const attendanceRate = recorded ? Math.round((totalPresent / recorded) * 100) : 0

    const waitingBySession = new Map<string, number>()
    for (const booking of bookings) {
        if (booking.attendance_status !== "upcoming") continue
        waitingBySession.set(booking.class_session_id,
            (waitingBySession.get(booking.class_session_id) ?? 0) + 1)
    }

    const openObligations = openObligationsResult.data ?? []
    const studentIds = [...new Set(openObligations.map((item) => item.student_id))]
    const { data: obligationStudents, error: obligationStudentsError } = studentIds.length
        ? await supabase.from("students").select("id, full_name").in("id", studentIds)
        : { data: [], error: null }

    if (obligationStudentsError) {
        console.error("Dashboard obligation names unavailable:", obligationStudentsError.message)
        return <p className="text-destructive">Could not load admin actions. Please refresh.</p>
    }

    const sourceIds = [...new Set(openObligations.map((item) => item.source_booking_id))]
    const { data: sources, error: sourceError } = sourceIds.length
        ? await supabase.from("student_bookings").select("id, class_session_id").in("id", sourceIds)
        : { data: [], error: null }

    if (sourceError) {
        console.error("Dashboard source bookings unavailable:", sourceError.message)
        return <p className="text-destructive">Could not load makeup class details. Please refresh.</p>
    }

    const sourceMap = new Map((sources ?? []).map((source) => [source.id, source.class_session_id]))
    const makeupSessionIds = [...new Set((sources ?? []).map((source) => source.class_session_id))]
    const { data: originalSessions, error: originalSessionError } = makeupSessionIds.length
        ? await supabase.from("class_sessions")
            .select("id, class_date, start_time, programme_id, branch_id")
            .in("id", makeupSessionIds)
        : { data: [], error: null }

    if (originalSessionError) {
        console.error("Dashboard original classes unavailable:", originalSessionError.message)
        return <p className="text-destructive">Could not load original class details. Please refresh.</p>
    }

    const originalMap = new Map((originalSessions ?? []).map((session) => [session.id, session]))
    const studentMap = new Map((obligationStudents ?? []).map((student) => [student.id, student.full_name]))
    const makeupActions = openObligations.map((obligation) => {
        const sourceSessionId = sourceMap.get(obligation.source_booking_id)
        const original = sourceSessionId ? originalMap.get(sourceSessionId) : undefined
        return {
        id: obligation.id,
        href: obligation.obligation_type === "replacement"
            ? `/replacements/${obligation.id}`
            : `/reschedules/${obligation.id}`,
        title: obligation.obligation_type === "replacement" ? "Assign replacement" : "Assign reschedule",
        detail: studentMap.get(obligation.student_id) ?? "Student record",
        context: original
            ? `Original: ${displayDate(original.class_date)} · ${original.start_time.slice(0, 5)} · ${programmeMap.get(original.programme_id) ?? "Class"}`
            : "Original class unavailable",
        kind: obligation.obligation_type === "replacement" ? "Replacement" : "Reschedule",
        }
    })

    const attendanceActions = endedMonthSessions
        .filter((session) => (waitingBySession.get(session.id) ?? 0) > 0)
        .sort((a, b) => a.class_date.localeCompare(b.class_date) || a.start_time.localeCompare(b.start_time))
        .map((session) => ({
            id: session.id,
            href: `/schedule/sessions/${session.id}`,
            title: "Mark attendance",
            detail: `${programmeMap.get(session.programme_id) ?? "Class"} · ${displayDate(session.class_date)} · ${waitingBySession.get(session.id)} unmarked`,
            context: undefined as string | undefined,
            kind: "Attendance",
        }))

    const attention = [...makeupActions, ...attendanceActions].slice(0, 7)
    const outstanding = (replacementCountResult.count ?? 0) + (rescheduleCountResult.count ?? 0)
        + totalUnmarked

    // Put upcoming sessions first; keep recently ended classes visible below.
    const sortedWeekSessions = [...weekSessions].sort((a, b) => {
        const aUpcoming = !isEnded(a, today, localTime)
        const bUpcoming = !isEnded(b, today, localTime)
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1
        return a.class_date.localeCompare(b.class_date) || a.start_time.localeCompare(b.start_time)
    })

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-sm text-muted-foreground">Operations overview</p>
                    <h1 className="mt-1 text-3xl font-bold tracking-tight">Dashboard</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Live overview of students, schedules, and classes needing attention.
                    </p>
                </div>
                <div className="rounded-xl border bg-background px-4 py-3 text-right">
                    <p className="text-sm font-medium">{displayDate(today)}</p>
                    <p className="text-xs text-muted-foreground">Malaysia time · {localTime.slice(0, 5)} MYT</p>
                </div>
            </div>

            <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                    { label: "Total students", value: number(studentsResult.count), href: "/students", icon: UsersRound, note: "Student profiles" },
                    { label: "Active enrollments", value: number(enrollmentsResult.count), href: "/enrollments", icon: GraduationCap, note: "Currently enrolled" },
                    { label: "Open reschedules", value: number(rescheduleCountResult.count), href: "/reschedules", icon: RefreshCw, note: "Awaiting class assignment" },
                    { label: "Open replacements", value: number(replacementCountResult.count), href: "/replacements", icon: CalendarDays, note: "Awaiting yellow slot" },
                ].map((item) => (
                    <Link key={item.label} href={item.href}
                        className="ui-interactive-card group rounded-xl border bg-background p-5">
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-muted-foreground">{item.label}</p>
                            <item.icon className="size-5 text-muted-foreground" aria-hidden="true" />
                        </div>
                        <p className="mt-3 text-3xl font-semibold tabular-nums">{item.value}</p>
                        <div className="mt-3 flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">{item.note}</p>
                            <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                        </div>
                    </Link>
                ))}
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <section className="min-w-0 overflow-hidden rounded-xl border bg-background">
                    <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
                        <div>
                            <h2 className="font-semibold">Classes this week</h2>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {displayDate(weekStart)} – {displayDate(weekEnd)} · Locked schedules
                            </p>
                        </div>
                        <Link href="/schedule" className="shrink-0 text-sm font-medium underline underline-offset-4">
                            Schedule
                        </Link>
                    </div>
                    {sortedWeekSessions.length ? (
                        <div className="divide-y">
                            {sortedWeekSessions.slice(0, 7).map((session) => {
                                const ended = isEnded(session, today, localTime)
                                return (
                                    <Link key={session.id} href={`/schedule/sessions/${session.id}`}
                                        className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium">
                                                {programmeMap.get(session.programme_id) ?? "Class"}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {branchMap.get(session.branch_id) ?? "Branch"} · {displayDate(session.class_date)}
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-sm font-medium tabular-nums">
                                                {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {ended ? "Ended" : session.class_date === today ? "Today" : "Upcoming"}
                                            </p>
                                        </div>
                                    </Link>
                                )
                            })}
                            {sortedWeekSessions.length > 7 && (
                                <Link href="/schedule"
                                    className="block px-5 py-3 text-center text-sm font-medium hover:bg-muted/30">
                                    View all {sortedWeekSessions.length} classes →
                                </Link>
                            )}
                        </div>
                    ) : (
                        <div className="px-5 py-10 text-center">
                            <CalendarDays className="mx-auto size-7 text-muted-foreground" />
                            <p className="mt-3 text-sm font-medium">No locked classes this week</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Generate and lock a schedule to display classes here.
                            </p>
                        </div>
                    )}
                </section>

                <section className="min-w-0 overflow-hidden rounded-xl border bg-background">
                    <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
                        <div>
                            <h2 className="font-semibold">Needs attention</h2>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Open makeup requests and this month&apos;s unmarked attendance
                            </p>
                        </div>
                        <span className="rounded-full border px-3 py-1 text-xs font-medium tabular-nums">
                            {outstanding} pending
                        </span>
                    </div>
                    {attention.length ? (
                        <div className="divide-y">
                            {attention.map((item) => (
                                <Link key={item.id} href={item.href}
                                    className="group flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium">{item.title}</p>
                                        <p className="mt-1 truncate text-xs text-muted-foreground">{item.detail}</p>
                                        {item.context && (
                                            <p className="mt-1 truncate text-xs text-muted-foreground">
                                                {item.context}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className="hidden rounded-full border px-2 py-1 text-xs sm:inline-flex">
                                            {item.kind}
                                        </span>
                                        <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                                    </div>
                                </Link>
                            ))}
                            {outstanding > attention.length && (
                                <p className="px-5 py-3 text-xs text-muted-foreground">
                                    Showing {attention.length} actions. Open Reschedules, Replacements or Schedule for more.
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="px-5 py-10 text-center">
                            <CheckCircle2 className="mx-auto size-7 text-muted-foreground" />
                            <p className="mt-3 text-sm font-medium">Nothing pending</p>
                            <p className="mt-1 text-xs text-muted-foreground">No open makeup requests or unmarked attendance this month.</p>
                        </div>
                    )}
                </section>
            </div>

            <section className="rounded-xl border bg-background p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <ClipboardCheck className="size-5 text-muted-foreground" aria-hidden="true" />
                            <h2 className="font-semibold">Attendance · {monthTitle(today)}</h2>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                            Locked classes that have already ended. Rescheduled originals and cancelled seats excluded.
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-2xl font-semibold tabular-nums">{attendanceRate}%</p>
                        <p className="text-xs text-muted-foreground">Present of marked bookings</p>
                    </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-foreground transition-all"
                        style={{ width: `${attendanceRate}%` }} />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-muted/40 p-4">
                        <p className="text-xs text-muted-foreground">Present</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">{totalPresent}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-4">
                        <p className="text-xs text-muted-foreground">Absent</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">{totalAbsent}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-4">
                        <p className="text-xs text-muted-foreground">Unmarked</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">{totalUnmarked}</p>
                    </div>
                </div>
                <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 className="size-4" aria-hidden="true" />
                    {endedMonthSessions.length} finished classes this month · Updates when attendance is recorded
                </p>
            </section>
        </div>
    )
}
