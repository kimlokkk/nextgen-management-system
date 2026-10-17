import { LogoutButton } from "@/components/logout-button"
import { ThemeSwitcher } from "@/components/theme-switcher"

type AppHeaderProps = {
    email: string
    name?: string | null
    role: string
}

export function AppHeader({
    email,
    name,
    role,
}: AppHeaderProps) {
    const displayRole = role
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())

    return (
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-background/95 px-4 pl-16 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-6 sm:pl-16 md:px-8 md:pl-8">
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold sm:text-base">
                    {name || email}
                </p>

                <p className="truncate text-xs text-muted-foreground">
                    {displayRole}
                </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <ThemeSwitcher />
                <LogoutButton />
            </div>
        </header>
    )
}