import Link from "next/link"
import {
    CalendarDays,
    CreditCard,
    LayoutDashboard,
    Settings,
    UserRound,
    UsersRound,
} from "lucide-react"

export function AppSidebar() {
    return (
        <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-background md:block">
            <div className="flex h-16 items-center border-b px-6">
                <div>
                    <p className="font-bold">
                        NextGen
                    </p>

                    <p className="text-xs text-muted-foreground">
                        Management System
                    </p>
                </div>
            </div>

            <nav className="space-y-1 p-4">
                <Link
                    href="/dashboard"
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted"
                >
                    <LayoutDashboard className="size-4" />
                    Dashboard
                </Link>

                <div className="pt-4">
                    <p className="px-3 pb-2 text-xs font-medium uppercase text-muted-foreground">
                        Management
                    </p>

                    <div className="space-y-1">
                        <Link
                            href="/parents"
                            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted"
                        >
                            <UsersRound className="size-4" />
                            Parents
                        </Link>

                        <Link
                            href="/students"
                            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted"
                        >
                            <UserRound className="size-4" />
                            Students
                        </Link>

                        <span className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                            <CalendarDays className="size-4" />
                            Schedule
                        </span>

                        <span className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                            <CreditCard className="size-4" />
                            Billing
                        </span>
                    </div>
                </div>

                <div className="pt-4">
                    <p className="px-3 pb-2 text-xs font-medium uppercase text-muted-foreground">
                        System
                    </p>

                    <Link
                        href="/sessions"
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted"
                    >
                        <Settings className="size-4" />
                        Sessions
                    </Link>
                </div>
            </nav>
        </aside>
    )
}