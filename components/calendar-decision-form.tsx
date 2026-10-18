"use client"

import { useState } from "react"
import { FormSubmit } from "@/components/form-submit"
import { setCalendarDecision } from "@/app/(app)/housekeeping/calendar/actions"

export type CalendarDecision = "pending" | "move" | "skip" | "withdrawn"

export function CalendarDecisionForm({
    eventId, initialDecision, initialTarget, disabled,
}: {
    eventId: string
    initialDecision: CalendarDecision
    initialTarget: string | null
    disabled?: boolean
}) {
    const [decision, setDecision] = useState<CalendarDecision>(initialDecision)
    const [target, setTarget] = useState(initialTarget ?? "")

    return (
        <form action={setCalendarDecision} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <input type="hidden" name="id" value={eventId} />
            <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Admin decision</span>
                <select name="decision" value={decision} disabled={disabled}
                    onChange={(event) => setDecision(event.target.value as CalendarDecision)}
                    className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm">
                    <option value="pending">Pending decision</option>
                    <option value="move">Move class to date</option>
                    <option value="skip">Skip class · no auto-makeup</option>
                    <option value="withdrawn">Withdraw event · classes as normal</option>
                </select>
            </label>
            <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">New date (move only)</span>
                <input type="date" name="target_on" value={decision === "move" ? target : ""}
                    onChange={(event) => setTarget(event.target.value)}
                    required={decision === "move"} disabled={disabled || decision !== "move"}
                    className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm disabled:opacity-50" />
            </label>
            <div className="sm:justify-self-end">
                <button type="submit" disabled={disabled || (decision === "move" && !target)
                    || (decision === initialDecision && (decision !== "move" || target === (initialTarget ?? "")))}
                    className="ui-primary-action w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                    Save decision
                </button>
            </div>
            {decision === "skip" && (
                <label className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-900 dark:text-amber-200 sm:col-span-3">
                    <input type="checkbox" name="confirm_skip" value="yes" required disabled={disabled}
                        className="mt-1 size-4 shrink-0 accent-primary" />
                    I understand this date will have no regular class and NextGen will not automatically
                    create replacement bookings or adjust billing. Any credit/refund policy must be handled separately.
                </label>
            )}
            {decision === "move" && (
                <p className="text-xs leading-5 text-muted-foreground sm:col-span-3">
                    Choose a later date on the same weekday and in the same month.
                    This moves the class for the whole group, not an individual replacement.
                </p>
            )}
        </form>
    )
}
