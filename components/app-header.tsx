import { LogoutButton } from "@/components/logout-button"

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
        <header className="flex h-16 items-center justify-between border-b bg-background px-6">
            <div>
                <p className="font-medium">
                    {name || email}
                </p>

                <p className="text-xs text-muted-foreground">
                    {displayRole}
                </p>
            </div>

            <LogoutButton />
        </header>
    )
}