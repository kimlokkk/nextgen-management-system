"use client"

import { useState, type ReactNode } from "react"
import { CalendarSearch, ChevronDown, Plus, X } from "lucide-react"

type Panel = "browse" | "generate" | null

type ScheduleActionsProps = {
    selectedLabel?: string
    selectedBranch?: string
    scheduleCount: number
    initialPanel?: Panel
    library: ReactNode
    generator: ReactNode
}

/**
 * Keep secondary workflows one click from the schedule heading without
 * permanently pushing the current month's classes below the fold.
 * Exactly one panel is visible at a time.
 */
export function ScheduleActions({
    selectedLabel,
    selectedBranch,
    scheduleCount,
    initialPanel = null,
    library,
    generator,
}: ScheduleActionsProps) {
    const [panel, setPanel] = useState<Panel>(initialPanel)

    const toggle = (next: Exclude<Panel, null>) => {
        setPanel((current) => current === next ? null : next)
    }

    return (
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card" aria-label="Schedule navigation and creation">
            <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4">
                <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                        {selectedLabel ? "Currently viewing" : "Schedule workspace"}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold">
                        {selectedLabel
                            ? `${selectedLabel}${selectedBranch ? ` · ${selectedBranch}` : ""}`
                            : scheduleCount > 0 ? "Choose a month to review" : "Create your first schedule"}
                    </p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:items-center">
                    <button
                        type="button"
                        aria-expanded={panel === "browse"}
                        aria-controls="schedule-actions-panel"
                        onClick={() => toggle("browse")}
                        className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors sm:px-4 ${panel === "browse"
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-background text-foreground hover:bg-accent"}`}
                    >
                        <CalendarSearch className="size-4 shrink-0" aria-hidden="true" />
                        <span>Browse months</span>
                        {panel === "browse"
                            ? <X className="hidden size-3.5 sm:block" aria-hidden="true" />
                            : <ChevronDown className="hidden size-3.5 sm:block" aria-hidden="true" />}
                    </button>
                    <button
                        type="button"
                        aria-expanded={panel === "generate"}
                        aria-controls="schedule-actions-panel"
                        onClick={() => toggle("generate")}
                        className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors sm:px-4 ${panel === "generate"
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-primary bg-primary text-primary-foreground hover:opacity-90"}`}
                    >
                        <Plus className="size-4 shrink-0" aria-hidden="true" />
                        <span>Generate draft</span>
                        {panel === "generate"
                            ? <X className="hidden size-3.5 sm:block" aria-hidden="true" />
                            : <ChevronDown className="hidden size-3.5 sm:block" aria-hidden="true" />}
                    </button>
                </div>
            </div>

            <div id="schedule-actions-panel" role={panel ? "region" : undefined}
                aria-label={panel === "browse" ? "Browse monthly schedules" : panel === "generate" ? "Generate monthly schedule" : undefined}>
                {panel && (
                    <div className="min-w-0 border-t bg-muted/15 p-3 sm:p-4">
                        {panel === "browse" ? library : generator}
                    </div>
                )}
            </div>
        </section>
    )
}
