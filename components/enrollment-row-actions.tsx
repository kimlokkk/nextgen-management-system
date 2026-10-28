"use client"

import { useState } from "react"
import { changeEnrollment, setEnrollmentStatus } from "@/app/(app)/enrollments/actions"
import { FormSubmit } from "@/components/form-submit"

export type SlotOption = { id: string; label: string; enrolled: number; capacity: number }

export type RowActionProps = {
    enrollmentId: string
    status: string
    sessionId: string | null
    frequency: string
    weeks: number[]
    startDate: string
    endDate: string | null
    slots: SlotOption[]
    defaultFrom: string
}

const field = "h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm focus-visible:border-ring"

export function WeekPicker({ defaultWeeks }: { defaultWeeks: number[] }) {
    return (
        <fieldset>
            <legend className="mb-2 block text-sm font-medium">Teaching weeks</legend>
            <div className="flex flex-wrap gap-3">
                {[1, 2, 3, 4].map((week) => (
                    <label key={week} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="preferred_weeks" value={week}
                            defaultChecked={defaultWeeks.includes(week)} className="size-4 accent-primary" />
                        Week {week}
                    </label>
                ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Twice monthly needs exactly two weeks.</p>
        </fieldset>
    )
}

export function EnrollmentRowActions({
    enrollmentId, status, sessionId, frequency, weeks, startDate, endDate, slots, defaultFrom,
}: RowActionProps) {
    const [freq, setFreq] = useState(frequency)
    const [next, setNext] = useState("")

    if (status === "stopped" || status === "completed") {
        return <p className="text-xs text-muted-foreground">
            This enrollment is {status}. To bring the student back, add a new enrollment.
        </p>
    }

    const statusChoices = status === "paused"
        ? [["active", "Resume"], ["stopped", "Stop"]]
        : [["paused", "Pause"], ["stopped", "Stop"]]

    return (
        <details className="rounded-lg border bg-background/60 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Change this enrollment</summary>
            <div className="mt-3 space-y-5">
                {status === "active" && (
                    <form action={changeEnrollment} className="grid gap-3 sm:grid-cols-2">
                        <input type="hidden" name="enrollment_id" value={enrollmentId} />
                        <p className="sm:col-span-2 text-xs leading-5 text-muted-foreground">
                            The change starts on the date you choose. Classes before that date keep the old class.
                            Schedules that were already generated are not changed.
                        </p>
                        <label className="block text-sm font-medium">
                            Change starts on
                            <input type="date" name="effective_from" required defaultValue={defaultFrom} className={`${field} mt-1`} />
                        </label>
                        <label className="block text-sm font-medium">
                            Class day and time
                            <select name="default_session_id" required defaultValue={sessionId ?? ""} className={`${field} mt-1`}>
                                {slots.map((slot) => (
                                    <option key={slot.id} value={slot.id}>
                                        {slot.label} · {slot.enrolled} enrolled, {slot.capacity} regular seats
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block text-sm font-medium">
                            How often
                            <select name="frequency_type" value={freq} onChange={(event) => setFreq(event.target.value)} className={`${field} mt-1`}>
                                <option value="weekly">Every week</option>
                                <option value="twice_monthly">Twice a month</option>
                                <option value="custom">Custom weeks</option>
                            </select>
                        </label>
                        {freq !== "weekly" && <WeekPicker defaultWeeks={weeks} />}
                        <label className="block text-sm font-medium sm:col-span-2">
                            Reason
                            <input name="reason" required minLength={10} maxLength={500}
                                placeholder="At least 10 characters. Do not write student names."
                                className={`${field} mt-1`} />
                        </label>
                        <div className="sm:col-span-2"><FormSubmit>Save change</FormSubmit></div>
                    </form>
                )}

                <form action={setEnrollmentStatus} className="grid gap-3 border-t pt-4 sm:grid-cols-2">
                    <input type="hidden" name="enrollment_id" value={enrollmentId} />
                    <p className="sm:col-span-2 text-xs leading-5 text-muted-foreground">
                        Pause or stop removes the student from every month you generate from now on. Months that are
                        already generated are not changed.
                    </p>
                    <label className="block text-sm font-medium">
                        Action
                        <select name="new_status" required value={next} onChange={(event) => setNext(event.target.value)} className={`${field} mt-1`}>
                            <option value="" disabled>Choose</option>
                            {statusChoices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </label>
                    {next === "stopped" && (
                        <label className="block text-sm font-medium">
                            Last class date
                            <input type="date" name="end_date" required min={startDate} defaultValue={endDate ?? ""} className={`${field} mt-1`} />
                        </label>
                    )}
                    <label className="block text-sm font-medium sm:col-span-2">
                        Reason
                        <input name="reason" required minLength={10} maxLength={500}
                            placeholder="At least 10 characters. Do not write student names."
                            className={`${field} mt-1`} />
                    </label>
                    {next === "stopped" && (
                        <label className="flex items-start gap-2 text-sm leading-5 sm:col-span-2">
                            <input type="checkbox" name="confirm_stop" value="yes" required className="mt-0.5 size-4 accent-primary" />
                            I want to stop this enrollment. A stopped enrollment cannot be resumed; a new one must be added.
                        </label>
                    )}
                    <div className="sm:col-span-2"><FormSubmit>Save</FormSubmit></div>
                </form>
            </div>
        </details>
    )
}
