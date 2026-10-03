import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"

export const instant = false

export default async function AppLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect("/auth/login")
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single()

    return (
        <div className="min-h-screen bg-muted/30">
            <AppSidebar />

            <div className="md:pl-64">
                <AppHeader
                    email={user.email ?? ""}
                    name={profile?.full_name}
                    role={profile?.role ?? ""}
                />

                <main className="p-6 md:p-8">
                    {children}
                </main>
            </div>
        </div>
    )
}