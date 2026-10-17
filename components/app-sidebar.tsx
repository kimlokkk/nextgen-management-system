"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    CalendarDays,
    ChevronRight,
    CreditCard,
    LayoutDashboard,
    Menu,
    RefreshCw,
    RotateCcw,
    Settings,
    UserRound,
    UsersRound,
    X,
} from "lucide-react"

const navigation = [
    {
        label: "Overview",
        items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
    },
    {
        label: "Management",
        items: [
            { href: "/parents", label: "Parents", icon: UsersRound },
            { href: "/students", label: "Students", icon: UserRound },
            { href: "/enrollments", label: "Enrollments", icon: CalendarDays },
            { href: "/schedule", label: "Schedule", icon: CalendarDays },
            { href: "/reschedules", label: "Reschedules", icon: RefreshCw },
            { href: "/replacements", label: "Replacements", icon: RotateCcw },
            { href: "/housekeeping/sessions", label: "Housekeeping", icon: Settings },
        ],
    },
    {
        label: "System",
        items: [{ href: "/sessions", label: "Sessions", icon: Settings }],
    },
]

export function AppSidebar() {
    const pathname = usePathname()
    const [open, setOpen] = useState(false)
    const closeButton = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (!open) return

        const onEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false)
        }
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        document.addEventListener("keydown", onEscape)
        closeButton.current?.focus()
        return () => {
            document.body.style.overflow = previousOverflow
            document.removeEventListener("keydown", onEscape)
        }
    }, [open])

    return (
        <>
            <button
                type="button"
                aria-label="Open navigation"
                aria-controls="nextgen-sidebar"
                aria-expanded={open}
                onClick={() => setOpen(true)}
                className="fixed left-3 top-3 z-40 flex size-10 items-center justify-center rounded-lg border bg-background shadow-sm transition-colors hover:bg-muted md:hidden"
            >
                <Menu className="size-5" aria-hidden="true" />
            </button>

            {open && (
                <button
                    type="button"
                    aria-label="Close navigation"
                    className="fixed inset-0 z-40 bg-black/55 md:hidden"
                    onClick={() => setOpen(false)}
                />
            )}

            <aside
                id="nextgen-sidebar"
                aria-label="Main navigation"
                className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-background shadow-xl transition-transform duration-200 ease-out md:z-30 md:w-64 md:max-w-none md:translate-x-0 md:shadow-none ${open ? "translate-x-0" : "-translate-x-full"}`}
            >
                <div className="flex h-16 shrink-0 items-center justify-between border-b px-5">
                    <Link href="/dashboard" onClick={() => setOpen(false)}
                        className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="flex size-9 items-center justify-center rounded-xl bg-foreground text-sm font-bold text-background" aria-hidden="true">
                            N
                        </span>
                        <span className="min-w-0">
                            <span className="block text-sm font-semibold tracking-tight">NextGen</span>
                            <span className="block text-xs text-muted-foreground">Management System</span>
                        </span>
                    </Link>
                    <button
                        ref={closeButton}
                        type="button"
                        aria-label="Close navigation"
                        onClick={() => setOpen(false)}
                        className="flex size-9 items-center justify-center rounded-lg hover:bg-muted md:hidden"
                    >
                        <X className="size-5" aria-hidden="true" />
                    </button>
                </div>

                <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 py-5" aria-label="Sections">
                    {navigation.map((group) => (
                        <div key={group.label}>
                            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                {group.label}
                            </p>
                            <div className="space-y-1">
                                {group.items.map((item) => {
                                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            aria-current={active ? "page" : undefined}
                                            onClick={() => setOpen(false)}
                                            className={`group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active
                                                ? "bg-foreground/[0.07] text-foreground ring-1 ring-foreground/10 dark:bg-foreground/10"
                                                : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                                        >
                                            <item.icon aria-hidden="true"
                                                className={`size-4 shrink-0 ${active ? "text-foreground" : "group-hover:text-foreground"}`} />
                                            <span className="flex-1">{item.label}</span>
                                            {active && <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
                                        </Link>
                                    )
                                })}
                                {group.label === "Management" && (
                                    <span
                                        aria-disabled="true"
                                        title="Billing is coming soon"
                                        className="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/60"
                                    >
                                        <CreditCard className="size-4 shrink-0" aria-hidden="true" />
                                        <span className="flex-1">Billing</span>
                                        <span className="text-[10px]">Soon</span>
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </nav>

                <div className="shrink-0 border-t p-4">
                    <p className="text-xs text-muted-foreground">NextGen · Admin Workspace</p>
                </div>
            </aside>
        </>
    )
}
