"use client"

import { useMemo, useRef, useState } from "react"

export type ParentOption = { id: string; label: string; search: string }
export type MissingStudent = { id: string; name: string; rosterPhone: string | null }
type Action = (formData: FormData) => void | Promise<void>

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()

function ParentPicker({ parents, value, onChange, id }: { parents: ParentOption[]; value: ParentOption | null; onChange: (p: ParentOption | null) => void; id: string }) {
    const [query, setQuery] = useState("")
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(0)
    const box = useRef<HTMLDivElement>(null)
    const matches = useMemo(() => {
        const tokens = norm(query).split(" ").filter(Boolean)
        const digits = query.replace(/\D/g, "")
        const list = parents.filter((p) => tokens.every((t) => p.search.includes(t)) || (digits.length >= 4 && p.search.includes(digits)))
        return list.slice(0, 40)
    }, [parents, query])
    const pick = (p: ParentOption) => { onChange(p); setQuery(""); setOpen(false) }
    return (
        <div ref={box} className="relative" onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
            <input type="hidden" name="parent_id" value={value?.id ?? ""} />
            {value ? (
                <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                    <span className="min-w-0 break-words">{value.label}</span>
                    <button type="button" className="shrink-0 text-xs font-semibold text-primary underline" onClick={() => onChange(null)}>Change</button>
                </div>
            ) : (
                <>
                    <input id={id} type="text" role="combobox" aria-expanded={open} aria-controls={id + "-list"} aria-autocomplete="list" autoComplete="off"
                        placeholder="Type a parent name or phone number…" value={query}
                        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0) }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={(e) => {
                            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, matches.length - 1)) }
                            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
                            else if (e.key === "Enter" && open && matches[active]) { e.preventDefault(); pick(matches[active]) }
                            else if (e.key === "Escape") setOpen(false)
                        }}
                        className="h-10 w-full rounded-lg border bg-background px-3 text-sm" />
                    {open && (
                        <ul id={id + "-list"} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
                            {matches.length === 0 && <li className="px-3 py-2 text-muted-foreground">No parent matches. Use “Parent not in the system” below.</li>}
                            {matches.map((p, i) => (
                                <li key={p.id} role="option" aria-selected={i === active} tabIndex={-1}
                                    onMouseDown={(e) => { e.preventDefault(); pick(p) }}
                                    className={"cursor-pointer rounded-md px-3 py-2 " + (i === active ? "bg-primary/10" : "hover:bg-muted")}>{p.label}</li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </div>
    )
}

function StudentCard({ student, parents, linkAction, newParentAction }: { student: MissingStudent; parents: ParentOption[]; linkAction: Action; newParentAction: Action }) {
    const [mode, setMode] = useState<"existing" | "new">("existing")
    const [parent, setParent] = useState<ParentOption | null>(null)
    const [error, setError] = useState<string | null>(null)
    return (
        <section className="mt-4 rounded-xl border p-4">
            <h3 className="font-semibold">{student.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
                Active student · No guardian association in NextGen
                {student.rosterPhone ? ` · phone on October roster: ${student.rosterPhone}` : ""}
            </p>
            <form action={mode === "existing" ? linkAction : newParentAction} className="mt-4 grid gap-3"
                onSubmit={(e) => { if (mode === "existing" && !parent) { e.preventDefault(); setError("Search and choose a parent first, or switch to “Parent not in the system”.") } else setError(null) }}>
                <input type="hidden" name="student_id" value={student.id} />
                <div className="flex flex-wrap gap-2 text-xs font-semibold" role="group" aria-label="Parent source">
                    <button type="button" aria-pressed={mode === "existing"} onClick={() => setMode("existing")}
                        className={"rounded-lg border px-3 py-2 " + (mode === "existing" ? "bg-primary text-primary-foreground" : "bg-background")}>Parent already in the system</button>
                    <button type="button" aria-pressed={mode === "new"} onClick={() => setMode("new")}
                        className={"rounded-lg border px-3 py-2 " + (mode === "new" ? "bg-primary text-primary-foreground" : "bg-background")}>Parent not in the system</button>
                </div>
                {mode === "existing" ? (
                    <label className="block">
                        <span className="mb-1 block text-xs font-semibold">Verified parent or guardian *</span>
                        <ParentPicker id={"parent-" + student.id} parents={parents} value={parent} onChange={setParent} />
                    </label>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block sm:col-span-2">
                            <span className="mb-1 block text-xs font-semibold">New parent full name *</span>
                            <input name="new_parent_name" type="text" required minLength={3} maxLength={160} autoComplete="off"
                                className="h-10 w-full rounded-lg border bg-background px-3 text-sm" />
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-xs font-semibold">Phone / WhatsApp</span>
                            <input name="new_parent_phone" type="tel" maxLength={30} inputMode="tel" defaultValue={student.rosterPhone ?? ""}
                                className="h-10 w-full rounded-lg border bg-background px-3 text-sm" />
                        </label>
                    </div>
                )}
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold">Confirmed relationship *</span>
                    <select name="relationship" required defaultValue="" className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                        <option value="" disabled>Select relationship</option>
                        <option value="father">Father</option>
                        <option value="mother">Mother</option>
                        <option value="guardian">Other legal guardian</option>
                    </select>
                </label>
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold">Evidence reference *</span>
                    <input name="evidence_reference" type="text" required minLength={10} maxLength={500}
                        placeholder="E.g. client directory sheet, CYBER tab row 12, checked by Kim"
                        className="h-10 w-full rounded-lg border bg-background px-3 text-sm" />
                </label>
                <label className="flex items-start gap-2 text-xs leading-5">
                    <input type="checkbox" name="confirmed" value="yes" required className="mt-1 size-4 accent-primary" />
                    I personally confirmed this adult is the parent/guardian named in the cited source.
                </label>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <button type="submit" className="ui-secondary-action w-fit">{mode === "existing" ? "Link verified guardian" : "Create parent and link"}</button>
            </form>
        </section>
    )
}

export function GuardianLinkList({ students, parents, linkAction, newParentAction }: { students: MissingStudent[]; parents: ParentOption[]; linkAction: Action; newParentAction: Action }) {
    const [filter, setFilter] = useState("")
    const shown = useMemo(() => {
        const t = norm(filter).split(" ").filter(Boolean)
        return students.filter((s) => t.every((x) => norm(s.name).includes(x)))
    }, [students, filter])
    return (
        <div>
            <label className="mt-4 block">
                <span className="sr-only">Search students without a guardian</span>
                <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search student name…"
                    className="h-10 w-full rounded-lg border bg-background px-3 text-sm" />
            </label>
            {shown.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No student matches.</p>}
            {shown.map((s) => <StudentCard key={s.id} student={s} parents={parents} linkAction={linkAction} newParentAction={newParentAction} />)}
        </div>
    )
}
