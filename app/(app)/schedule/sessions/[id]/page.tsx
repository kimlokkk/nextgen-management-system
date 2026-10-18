import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, Clock3, GraduationCap, UsersRound } from "lucide-react"
import { SessionRoster, RosterActionSubmit, type SessionRosterEntry } from "@/components/session-roster"
import { ScheduleStatus } from "@/components/schedule-workspace"
import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { markForReschedule, initiateReplacement, recordAttendance } from "./actions"
import { adjustClassReplacementCapacity } from "./capacity-actions"
import { FormSubmit } from "@/components/form-submit"
import {
    countsTowardsRegularCapacity,
    countsTowardsReplacementCapacity,
} from "@/lib/reschedule-policy"

type PageProps = {
    params: Promise<{
        id: string
    }>
}

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

function getMalaysiaTime() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kuala_Lumpur",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date())

    const getPart = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? "00"

    return `${getPart("hour")}:${getPart("minute")}:${getPart("second")}`
}

export default async function ScheduleSessionPage({
    params,
}: PageProps) {
    const { id } = await params
    const supabase = await createClient()

    // =====================================================
    // CLASS SESSION
    // =====================================================

    const { data: session, error: sessionError } = await supabase
        .from("class_sessions")
        .select(`
      id,
      schedule_batch_id,
      session_template_id,
      branch_id,
      programme_id,
      class_date,
      week_number,
      start_time,
      end_time,
      regular_capacity,
      replacement_capacity,
      status
    `)
        .eq("id", id)
        .single()

    if (sessionError || !session) {
        notFound()
    }

    // =====================================================
    // SUPPORTING DATA
    // =====================================================

    const [
        branchResult,
        programmeResult,
        batchResult,
        bookingResult,
    ] = await Promise.all([
        supabase
            .from("branches")
            .select("id, name")
            .eq("id", session.branch_id)
            .single(),

        supabase
            .from("programmes")
            .select("id, name")
            .eq("id", session.programme_id)
            .single(),

        supabase
            .from("schedule_batches")
            .select("id, schedule_month, status")
            .eq("id", session.schedule_batch_id)
            .single(),

        supabase
            .from("student_bookings")
            .select(`
        id,
        student_id,
        enrollment_id,
        booking_type,
        attendance_status
      `)
            .eq("class_session_id", session.id),
    ])

    const branch = branchResult.data
    const programme = programmeResult.data
    const batch = batchResult.data
    const bookings = bookingResult.data ?? []
    const { data: { user: signedInUser } } = await supabase.auth.getUser()
    const { data: adminProfile } = signedInUser
        ? await supabase.from("profiles").select("role, is_active")
            .eq("id", signedInUser.id).single()
        : { data: null }
    const canAdjustDraftCapacity = batch?.status === "draft"
        && session.status === "scheduled"
        && !!adminProfile?.is_active
        && ["admin", "super_admin"].includes(adminProfile.role)
    const { data: capacityAudit, error: capacityAuditError } = canAdjustDraftCapacity
        ? await supabase.from("class_replacement_capacity_audit")
            .select("id, old_capacity, new_capacity, reason, changed_at")
            .eq("class_session_id", session.id)
            .order("changed_at", { ascending: false })
            .limit(5)
        : { data: [], error: null }
    const today = getMalaysiaDate()
    const sessionEnded =
        session.class_date < today ||
        (session.class_date === today &&
            session.end_time.slice(0, 8) <= getMalaysiaTime())

    // =====================================================
    // STUDENTS
    // =====================================================

    const studentIds = [
        ...new Set(
            bookings.map((booking) => booking.student_id)
        ),
    ]

    const enrollmentIds = [
        ...new Set(
            bookings
                .map((booking) => booking.enrollment_id)
                .filter(Boolean)
        ),
    ] as string[]

    const { data: students } =
        studentIds.length > 0
            ? await supabase
                .from("students")
                .select("id, full_name, status, laptop_type")
                .in("id", studentIds)
            : { data: [] }

    const { data: enrollments } =
        enrollmentIds.length > 0
            ? await supabase
                .from("enrollments")
                .select(`
            id,
            status,
            default_session_id,
            start_date,
            end_date
          `)
                .in("id", enrollmentIds)
            : { data: [] }

    const studentMap = new Map(
        students?.map((student) => [
            student.id,
            student,
        ]) ?? []
    )

    const enrollmentMap = new Map(
        enrollments?.map((enrollment) => [
            enrollment.id,
            enrollment,
        ]) ?? []
    )

    // =====================================================
    // COUNTS
    // =====================================================

    const regularBookings = bookings.filter(
        (booking) =>
            countsTowardsRegularCapacity(
                booking
            )
    )

    const replacementBookings = bookings.filter(
        (booking) =>
            countsTowardsReplacementCapacity(
                booking
            )
    )

    const rescheduleBookings = bookings.filter(
        (booking) =>
            booking.booking_type === "reschedule" &&
            countsTowardsRegularCapacity(booking)
    )

    // =====================================================
    // VALIDATION / WARNINGS
    // =====================================================

    const warnings: string[] = []

    if (
        regularBookings.length >
        session.regular_capacity
    ) {
        warnings.push(
            `Regular capacity exceeded: ${regularBookings.length}/${session.regular_capacity}`
        )
    }

    if (
        replacementBookings.length >
        session.replacement_capacity
    ) {
        warnings.push(
            `Replacement capacity exceeded: ${replacementBookings.length}/${session.replacement_capacity}`
        )
    }

    for (const booking of bookings) {
        const student = studentMap.get(
            booking.student_id
        )

        const enrollment = booking.enrollment_id
            ? enrollmentMap.get(booking.enrollment_id)
            : null

        if (student && student.status !== "active") {
            warnings.push(
                `${student.full_name} is currently ${student.status}`
            )
        }

        if (
            booking.booking_type === "regular" &&
            enrollment &&
            enrollment.status !== "active"
        ) {
            warnings.push(
                `${student?.full_name ?? "Student"} has an inactive enrollment`
            )
        }

        if (
            booking.booking_type === "regular" &&
            enrollment &&
            enrollment.default_session_id !==
            session.session_template_id
        ) {
            warnings.push(
                `${student?.full_name ?? "Student"} regular session no longer matches this class`
            )
        }
    }

    const bookingIds = bookings.map(
        (booking) => booking.id
    )

    const [sourceResult, targetResult] = await Promise.all([
        bookingIds.length > 0
            ? supabase.from("makeup_obligations")
                .select("id, source_booking_id, obligation_type, status")
                .in("source_booking_id", bookingIds)
            : Promise.resolve({ data: [], error: null }),
        bookingIds.length > 0
            ? supabase.from("makeup_obligations")
                .select("id, target_booking_id, obligation_type, status")
                .in("target_booking_id", bookingIds)
            : Promise.resolve({ data: [], error: null }),
    ])

    if (sourceResult.error || targetResult.error) {
        throw new Error(sourceResult.error?.message ?? targetResult.error?.message)
    }

    // A source can now have two historical rows: a cancelled reschedule
    // plus a replacement. Active obligations must take display priority.
    // When both are cancelled, favour replacement for Reopen Replacement.
    const sourceObligations = sourceResult.data ?? []
    const obligationMap = new Map([
        ...sourceObligations.filter((item) =>
            item.status === "cancelled" && item.obligation_type === "reschedule"
        ).map((item) => [item.source_booking_id, item] as const),
        ...sourceObligations.filter((item) =>
            item.status === "cancelled" && item.obligation_type === "replacement"
        ).map((item) => [item.source_booking_id, item] as const),
        ...sourceObligations.filter((item) =>
            item.status !== "cancelled"
        ).map((item) => [item.source_booking_id, item] as const),
    ])
    const cancelledRescheduleSources = new Set(
        sourceObligations.filter((item) =>
            item.obligation_type === "reschedule" && item.status === "cancelled"
        ).map((item) => item.source_booking_id)
    )
    const targetObligationMap = new Map(
        (targetResult.data ?? []).map((item) => [item.target_booking_id, item])
    )

    const attendanceEligible = bookings.filter((booking) =>
        ["upcoming", "present", "absent"].includes(booking.attendance_status)
    )
    const presentCount = attendanceEligible.filter((booking) =>
        booking.attendance_status === "present"
    ).length
    const absentCount = attendanceEligible.filter((booking) =>
        booking.attendance_status === "absent"
    ).length
    const upcomingCount = attendanceEligible.filter((booking) =>
        booking.attendance_status === "upcoming"
    ).length
    const canTakeAttendance = batch?.status === "locked"
        && session.status === "scheduled" && sessionEnded

    const uniqueWarnings = [
        ...new Set(warnings),
    ]

    // All permission and state gates below mirror the original roster forms.
    // Keep actions on the server and pass only rendered slots to the client
    // so mobile and desktop share exactly the same business conditions.
    const rosterEntries: SessionRosterEntry[] = bookings.map((booking) => {
        const student = studentMap.get(booking.student_id)
        const enrollment = booking.enrollment_id ? enrollmentMap.get(booking.enrollment_id) : null
        const obligation = obligationMap.get(booking.id)
        const hasActiveObligation = !!obligation && obligation.status !== "cancelled"
        const targetObligation = targetObligationMap.get(booking.id)
        const isRegular = booking.booking_type === "regular"
        const isMakeup = ["reschedule", "replacement"].includes(booking.booking_type)
        const regularBlocked = isRegular
            && obligation?.obligation_type === "reschedule"
            && obligation.status !== "cancelled"
        const canAttend = canTakeAttendance
            && ["upcoming", "present", "absent"].includes(booking.attendance_status)
            && ((isRegular && !regularBlocked)
                || (isMakeup && targetObligation?.status === "scheduled"))
        const presentBlocked = isRegular
            && obligation?.obligation_type === "replacement"
            && ["open", "scheduled", "completed"].includes(obligation.status)
        const priorRescheduleCancelled = cancelledRescheduleSources.has(booking.id)

        const canConfirmAbsence = hasActiveObligation
            && obligation?.obligation_type === "replacement"
            && ["open", "scheduled", "completed"].includes(obligation.status)
            && isRegular
            && booking.attendance_status === "upcoming"
            && sessionEnded && batch?.status === "locked" && session.status === "scheduled"

        const canManageRegular = !hasActiveObligation
            && isRegular
            && ["upcoming", "absent"].includes(booking.attendance_status)
            && batch?.status === "locked" && session.status === "scheduled"

        const canReschedule = canManageRegular && booking.attendance_status === "upcoming"
            && !sessionEnded
            && (!obligation || obligation.status === "cancelled" || obligation.obligation_type === "reschedule")

        const canReplace = canManageRegular
            && (!obligation || obligation.status === "cancelled" || obligation.obligation_type === "replacement")
            && (sessionEnded || booking.attendance_status === "upcoming")

        const attendanceActions = canAttend ? (
            <>
                {booking.attendance_status !== "present" && !presentBlocked && (
                    <form action={recordAttendance}>
                        <input type="hidden" name="session_id" value={session.id} />
                        <input type="hidden" name="booking_id" value={booking.id} />
                        <input type="hidden" name="attendance" value="present" />
                        <RosterActionSubmit label="Present" tone="present" />
                    </form>
                )}
                {booking.attendance_status !== "absent" && (
                    <form action={recordAttendance}>
                        <input type="hidden" name="session_id" value={session.id} />
                        <input type="hidden" name="booking_id" value={booking.id} />
                        <input type="hidden" name="attendance" value="absent" />
                        <RosterActionSubmit label="Absent" tone="absent" />
                    </form>
                )}
                {presentBlocked && (
                    <span className="text-xs text-muted-foreground">Replacement already initiated</span>
                )}
                {isMakeup && booking.attendance_status === "absent" && (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Needs follow-up</span>
                )}
            </>
        ) : (
            <span className="text-xs text-muted-foreground">
                {booking.attendance_status === "present" ? "Recorded"
                    : booking.attendance_status === "absent" && isMakeup ? "Needs follow-up" : "—"}
            </span>
        )

        const historyNote = priorRescheduleCancelled ? (
            <span className="text-xs leading-5 text-muted-foreground">
                Previous reschedule cancelled · history retained
            </span>
        ) : null

        const followupActions = hasActiveObligation ? (
            <div className="flex flex-col items-start gap-2">
                <span className="text-xs font-semibold capitalize text-foreground">
                    {obligation.obligation_type} · {obligation.status}
                    {obligation.obligation_type === "replacement"
                        && booking.attendance_status === "upcoming" && " · planned"}
                </span>
                {historyNote}
                {canConfirmAbsence && (
                    <form action={initiateReplacement}>
                        <input type="hidden" name="booking_id" value={booking.id} />
                        <input type="hidden" name="session_id" value={session.id} />
                        <input type="hidden" name="mode" value="absent" />
                        <RosterActionSubmit label="Confirm absence" tone="warning" />
                    </form>
                )}
            </div>
        ) : canManageRegular ? (
            <div className="flex flex-wrap items-center gap-2">
                {canReschedule && (
                    <form action={markForReschedule}>
                        <input type="hidden" name="booking_id" value={booking.id} />
                        <input type="hidden" name="session_id" value={session.id} />
                        <RosterActionSubmit label="Mark reschedule" />
                    </form>
                )}
                {canReplace && (
                    <form action={initiateReplacement}>
                        <input type="hidden" name="booking_id" value={booking.id} />
                        <input type="hidden" name="session_id" value={session.id} />
                        <input type="hidden" name="mode" value={sessionEnded ? "absent" : "planned"} />
                        <RosterActionSubmit
                            label={obligation?.obligation_type === "replacement" && obligation.status === "cancelled"
                                ? "Reopen replacement" : sessionEnded
                                    ? "Mark absent / replacement" : "Plan replacement"}
                            tone="secondary"
                        />
                    </form>
                )}
                {historyNote}
            </div>
        ) : null

        return {
            id: booking.id,
            student: student?.full_name ?? "Student unavailable",
            type: booking.booking_type,
            laptop: student?.laptop_type ?? "Not specified",
            enrollment: enrollment?.status ?? "—",
            attendance: booking.attendance_status,
            attendanceActions,
            followupActions,
        }
    })

    const recorded = presentCount + absentCount
    const attendanceRate = recorded > 0 ? Math.round(presentCount / recorded * 100) : 0
    const totalEligible = attendanceEligible.length

    return (
        <div className="min-w-0 space-y-6">
            <header>
                <Link href={`/schedule?batch=${session.schedule_batch_id}`}
                    className="ui-action-link -ml-2 text-muted-foreground">
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Back to monthly schedule
                </Link>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-primary">
                            Week {session.week_number} · {new Intl.DateTimeFormat("en-MY", {
                                timeZone: "UTC", weekday: "long", day: "numeric", month: "short", year: "numeric",
                            }).format(new Date(`${session.class_date}T00:00:00Z`))}
                        </p>
                        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                            {programme?.name ?? "Class Session"}
                        </h1>
                        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                            <GraduationCap className="size-4 text-primary" aria-hidden="true" />
                            {branch?.name ?? "Branch unavailable"}
                            <span aria-hidden="true">·</span>
                            {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <ScheduleStatus status={batch?.status ?? "unknown"} />
                        {session.status !== "scheduled" && (
                            <span className="rounded-full border bg-muted px-2.5 py-1 text-xs font-medium capitalize">
                                Class {session.status}
                            </span>
                        )}
                    </div>
                </div>
            </header>

            <section aria-label="Class capacity" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                    { label: "Regular seats", used: regularBookings.length, max: session.regular_capacity, icon: UsersRound },
                    { label: "Yellow seats", used: replacementBookings.length, max: session.replacement_capacity, icon: CalendarClock },
                ].map((item) => (
                    <div key={item.label} className="min-w-0 rounded-xl border bg-card p-4 shadow-sm shadow-primary/5 sm:p-5">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <item.icon className="size-4.5" aria-hidden="true" />
                        </span>
                        <p className="mt-3 text-xs font-medium text-muted-foreground">{item.label}</p>
                        <p className={`mt-1 text-2xl font-semibold tabular-nums ${item.used > item.max ? "text-destructive" : ""}`}>
                            {item.used} / {item.max}
                        </p>
                    </div>
                ))}
                <div className="col-span-2 min-w-0 rounded-xl border bg-card p-4 sm:col-span-1 sm:p-5">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <CalendarClock className="size-4.5" aria-hidden="true" />
                    </span>
                    <p className="mt-3 text-xs font-medium text-muted-foreground">Rescheduled</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{rescheduleBookings.length}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Included in regular seats</p>
                </div>
            </section>

            {canAdjustDraftCapacity && (
                <section className="rounded-xl border bg-card p-4 sm:p-5" aria-label="Review single-class replacement capacity">
                    <details>
                        <summary className="cursor-pointer font-semibold">
                            Adjust yellow seats for this class only
                        </summary>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                            For a confirmed exception, adjust only this session, not the
                            weekly template or other dates. A replacement roster alone
                            is not proof of entitlement or room capacity. The reason
                            and previous value are saved to an audit log.
                        </p>
                        {capacityAuditError ? (
                            <p className="mt-3 text-sm text-destructive">
                                Capacity audit unavailable. Apply local migration 017 before changing seats.
                            </p>
                        ) : (
                            <form action={adjustClassReplacementCapacity}
                                className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                                <input type="hidden" name="session_id" value={session.id} />
                                <input type="hidden" name="expected_capacity" value={session.replacement_capacity} />
                                <label className="block">
                                    <span className="mb-1.5 block text-sm font-medium">Yellow seat capacity</span>
                                    <input type="number" name="new_capacity" min="0" max="50" required
                                        defaultValue={session.replacement_capacity}
                                        className="h-10 w-full rounded-lg border bg-background px-3" />
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-sm font-medium">Reason (required)</span>
                                    <input type="text" name="reason" required minLength={10} maxLength={500}
                                        placeholder="Confirmed by admin; space/facilitator availability checked"
                                        className="h-10 w-full rounded-lg border bg-background px-3" />
                                </label>
                                <label className="flex items-start gap-2 text-sm leading-6 sm:col-span-2">
                                    <input type="checkbox" name="confirm_capacity" value="yes"
                                        required className="mt-1 size-4 accent-primary" />
                                    I confirm this one-class capacity change is approved by operations.
                                    It does not create or validate historical replacement bookings.
                                </label>
                                <div className="sm:col-span-2">
                                    <FormSubmit>Save capacity decision</FormSubmit>
                                </div>
                            </form>
                        )}
                        {(capacityAudit ?? []).length > 0 && (
                            <div className="mt-5 border-t pt-4">
                                <h3 className="text-sm font-semibold">Recent capacity decisions</h3>
                                <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
                                    {(capacityAudit ?? []).map((row) => (
                                        <li key={row.id}>
                                            {row.old_capacity} → {row.new_capacity} yellow seats
                                            {" · "}{new Date(row.changed_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}
                                            {" · "}{row.reason}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </details>
                </section>
            )}

            {uniqueWarnings.length > 0 && (
                <section className="rounded-xl border border-destructive/35 bg-destructive/5 p-4 sm:p-5" aria-label="Schedule warnings">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
                        <h2 className="font-semibold text-destructive">Schedule warnings</h2>
                    </div>
                    <ul className="mt-3 space-y-2 text-sm leading-6">
                        {uniqueWarnings.map((warning) => <li key={warning}>• {warning}</li>)}
                    </ul>
                </section>
            )}

            <section className="rounded-xl border bg-card p-4 sm:p-5" aria-label="Class attendance overview">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            {canTakeAttendance ? <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
                                : <Clock3 className="size-5 text-muted-foreground" aria-hidden="true" />}
                            <h2 className="font-semibold">Class attendance</h2>
                        </div>
                        <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                            {canTakeAttendance ? "This class has ended. Record each eligible student's attendance below."
                                : "Attendance requires a scheduled class in a locked month and opens after class end (Malaysia time)."}
                        </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-medium ${canTakeAttendance
                        ? "border-primary/25 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}`}>
                        {canTakeAttendance ? "Ready to mark" : "Not yet open"}
                    </span>
                </div>

                <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Attendance recorded</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">{recorded} / {totalEligible}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-muted-foreground">Present of marked</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">{recorded > 0 ? `${attendanceRate}%` : "—"}</p>
                    </div>
                </div>
                <div role="progressbar" aria-label="Attendance recording progress"
                    aria-valuenow={totalEligible ? Math.round(recorded / totalEligible * 100) : 0}
                    aria-valuemin={0} aria-valuemax={100}
                    className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${totalEligible ? Math.round(recorded / totalEligible * 100) : 0}%` }} />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                    {[
                        { label: "Present", count: presentCount, color: "text-emerald-700 dark:text-emerald-300" },
                        { label: "Absent", count: absentCount, color: "text-amber-700 dark:text-amber-300" },
                        { label: "Unmarked", count: upcomingCount, color: "text-sky-700 dark:text-sky-300" },
                    ].map((item) => (
                        <div key={item.label} className="rounded-lg bg-muted/40 p-3 sm:p-4">
                            <p className="text-xs text-muted-foreground">{item.label}</p>
                            <p className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${item.color}`}>{item.count}</p>
                        </div>
                    ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Rescheduled originals and cancelled seats are excluded. Marking a makeup class Present
                    completes its obligation. Absent makeup bookings require admin follow-up.
                </p>
            </section>

            <SessionRoster entries={rosterEntries} />
        </div>
    )
}
