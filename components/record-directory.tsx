"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowRight, Plus, Search, X } from "lucide-react"
import { TableScrollArea } from "@/components/table-scroll-area"

export type DirectoryRow = {
    id: string
    title: string
    subtitle?: string
    status?: string
    fields: { label: string; value: string }[]
    searchText: string
}

type DirectoryProps = {
    title: string
    description: string
    eyebrow?: string
    rows: DirectoryRow[]
    columns: string[]
    createLabel: string
    createForm: ReactNode
    emptyTitle: string
    emptyDescription: string
    searchPlaceholder?: string
    prerequisites?: ReactNode
}

function StatusTag({ value }: { value: string }) {
    const status = value.toLowerCase()
    const classes = status === "active"
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
        : status === "inactive" || status === "cancelled" || status === "stopped"
            ? "border-border bg-muted text-muted-foreground"
            : "border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-300"
    return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${classes}`}>{value.replaceAll("_", " ")}</span>
}

export function RecordDirectory({
    title, description, eyebrow = "People", rows, columns, createLabel,
    createForm, emptyTitle, emptyDescription, searchPlaceholder, prerequisites,
}: DirectoryProps) {
    const [query, setQuery] = useState("")
    const [filter, setFilter] = useState("all")
    const [formOpen, setFormOpen] = useState(false)
    const formArea = useRef<HTMLDivElement>(null)

    const statuses = useMemo(() => [...new Set(rows.map((r) => r.status).filter((v): v is string => !!v))], [rows])
    const visible = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase()
        return rows.filter((row) => {
            const matchesSearch = !normalized || row.searchText.toLocaleLowerCase().includes(normalized)
            return matchesSearch && (filter === "all" || row.status === filter)
        })
    }, [rows, query, filter])

    useEffect(() => {
        if (!formOpen) return
        formArea.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus()
    }, [formOpen])

    return (
        <div className="min-w-0 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-sm font-medium text-primary">{eyebrow}</p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
                <button
                    type="button"
                    aria-expanded={formOpen}
                    aria-controls="directory-create-form"
                    onClick={() => setFormOpen((value) => !value)}
                    className={`${formOpen ? "ui-secondary-action" : "ui-primary-action"} min-w-0 shrink-0`}
                >
                    {formOpen ? <X className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                    {formOpen ? "Close form" : createLabel}
                </button>
            </div>

            {formOpen && (
                <section id="directory-create-form" ref={formArea} aria-label={createLabel}
                    className="rounded-xl border border-primary/20 bg-card p-4 shadow-sm sm:p-6">
                    <div className="border-b pb-4">
                        <h2 className="text-lg font-semibold">{createLabel}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Fill in the required fields, then save the record.
                        </p>
                    </div>
                    <div className="mt-4">
                        {prerequisites}
                        {createForm}
                    </div>
                </section>
            )}

            <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
                <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div>
                        <h2 className="text-base font-semibold">{title} directory</h2>
                        <p className="mt-1 text-xs text-muted-foreground">{visible.length} shown · {rows.length} total</p>
                    </div>
                    <label className="relative block w-full sm:max-w-xs">
                        <span className="sr-only">Search {title.toLowerCase()}</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <input
                            type="search"
                            placeholder={searchPlaceholder ?? `Search ${title.toLowerCase()}`}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground"
                        />
                    </label>
                </div>
                {statuses.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-b px-4 py-3 sm:px-5" role="group" aria-label="Filter by status">
                        {["all", ...statuses].map((value) => (
                            <button key={value} type="button"
                                aria-pressed={filter === value}
                                onClick={() => setFilter(value)}
                                className={`min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${filter === value
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                                {value === "all" ? "All" : value.replaceAll("_", " ")}
                            </button>
                        ))}
                    </div>
                )}

                {visible.length === 0 ? (
                    <div className="px-5 py-12 text-center">
                        <p className="font-medium">{rows.length ? "No matching records" : emptyTitle}</p>
                        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                            {rows.length ? "Try another search or status filter." : emptyDescription}
                        </p>
                        {rows.length > 0 && (
                            <button type="button" onClick={() => { setQuery(""); setFilter("all") }}
                                className="ui-secondary-action mt-4">Clear filters</button>
                        )}
                        {rows.length === 0 && !formOpen && (
                            <button type="button" onClick={() => setFormOpen(true)}
                                className="ui-primary-action mt-4">{createLabel}<ArrowRight className="size-4" aria-hidden="true" /></button>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="divide-y lg:hidden">
                            {visible.map((row) => (
                                <article key={row.id} className="space-y-3 p-4 sm:p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="break-words text-base font-semibold">{row.title}</h3>
                                            {row.subtitle && <p className="mt-1 text-sm text-muted-foreground">{row.subtitle}</p>}
                                        </div>
                                        {row.status && <StatusTag value={row.status} />}
                                    </div>
                                    <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                                        {row.fields.map((field) => (
                                            <div key={field.label} className="min-w-0">
                                                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                                                <dd className="mt-1 break-words font-medium">{field.value || "—"}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                </article>
                            ))}
                        </div>
                        <div className="hidden min-w-0 lg:block">
                            <TableScrollArea label={title + " directory"}>
                                <table className="w-full min-w-[48rem] text-sm">
                                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                                        <tr className="border-b">
                                            <th scope="col" className="px-5 py-3 text-left font-medium">{columns[0]}</th>
                                            {columns.slice(1).map((column) => (
                                                <th key={column} scope="col" className="px-5 py-3 text-left font-medium">{column}</th>
                                            ))}
                                            {statuses.length > 0 && <th scope="col" className="px-5 py-3 text-left font-medium">Status</th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visible.map((row) => (
                                            <tr key={row.id} className="border-b last:border-0">
                                                <td className="px-5 py-4">
                                                    <p className="font-semibold">{row.title}</p>
                                                    {row.subtitle && <p className="mt-1 text-xs text-muted-foreground">{row.subtitle}</p>}
                                                </td>
                                                {row.fields.map((field) => (
                                                    <td key={field.label} className="px-5 py-4">{field.value || "—"}</td>
                                                ))}
                                                {statuses.length > 0 && <td className="px-5 py-4">{row.status && <StatusTag value={row.status} />}</td>}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScrollArea>
                        </div>
                    </>
                )}
            </section>
        </div>
    )
}
