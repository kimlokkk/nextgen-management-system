"use client"

import type { SeptemberComparison, SeptemberEvidence } from "@/lib/september-reconciliation"

function EvidenceRow({ item }: { item: SeptemberEvidence }) {
    return (
        <div className="min-w-0 rounded-lg border bg-background p-3 text-xs leading-5">
            <p className="font-semibold text-foreground">{item.student_name}</p>
            <p>Excel: {item.source_tab} · row {item.source_row}</p>
            <p>Class: {item.class_date} · {item.start_time.slice(0,5)}–{item.end_time.slice(0,5)}</p>
            <p>{item.space_label ?? "Space unknown"} · {item.course ?? "Course unknown"}</p>
            <p>Module/activity cell: {item.module_raw?.trim() || "Blank (meaning unknown)"}</p>
        </div>
    )
}

export function SeptemberEvidencePanel({
    originalDate, evidence, loaded, unavailable,
}: {
    originalDate: string | null
    evidence?: SeptemberComparison
    loaded: boolean
    unavailable: boolean
}) {
    if (!originalDate?.startsWith("2026-09-")) return null
    return (
        <section className="mt-3 min-w-0 rounded-xl border border-primary/20 bg-primary/5 p-3"
            aria-label="September historical source evidence">
            <h3 className="text-sm font-semibold">September original-class evidence</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                A roster listing is not proof of attendance, absence or an earned replacement.
                Activity/module cells are not interpreted as attendance. All matching is a lead for human review.
            </p>
            {unavailable ? (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                    September evidence table unavailable. Apply migration 021 to LOCAL database only.
                </p>
            ) : !loaded ? (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                    September source records not yet imported into local database.
                </p>
            ) : !evidence ? (
                <p className="mt-2 text-xs">September comparison is not available for this record.</p>
            ) : (
                <div className="mt-3 space-y-3">
                    {evidence.roster.length ? (
                        <>
                            <p className="text-xs font-medium text-primary">
                                {evidence.roster.length} same-date roster candidate(s) with matching name text · not verified
                            </p>
                            {evidence.roster.length > 1 && (
                                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                    Multiple slots recorded. Admin must confirm which original session applies.
                                </p>
                            )}
                            <div className="grid gap-2 sm:grid-cols-2">
                                {evidence.roster.map((entry) => <EvidenceRow key={entry.source_ref} item={entry}/>)}
                            </div>
                        </>
                    ) : evidence.possibleNameVariation.length ? (
                        <>
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                No exact-name roster candidate. Similar shortened name found — identity review required.
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {evidence.possibleNameVariation.map((entry) => <EvidenceRow key={entry.source_ref} item={entry}/>)}
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                            No same-date roster name match. Request source evidence; do not infer eligibility.
                        </p>
                    )}
                    {evidence.sameOriginReplacement.length > 0 && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5">
                            <p className="font-semibold text-amber-900 dark:text-amber-200">
                                Existing September replacement reference(s): {evidence.sameOriginReplacement.length}
                            </p>
                            <p className="mt-1 text-amber-900 dark:text-amber-200">
                                Check whether the same original date was reused. Raw attendance marks remain uninterpreted.
                            </p>
                            {evidence.sameOriginReplacement.map((entry) => (
                                <p key={entry.source_ref} className="mt-1 text-amber-900 dark:text-amber-200">
                                    {entry.source_tab} · row {entry.source_row} · target {entry.class_date}
                                    {" · raw mark: "}{entry.attendance_raw || "(blank)"}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    )
}
