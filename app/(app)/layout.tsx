import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"

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
        <div className="nextgen-app min-h-screen min-w-0 bg-muted/25">
            <AppSidebar />

            <div className="min-w-0 md:pl-64">
                <AppHeader
                    email={user.email ?? ""}
                    name={profile?.full_name}
                    role={profile?.role ?? ""}
                />

                <main id="main-content" className="mx-auto w-full max-w-[1600px] min-w-0 px-4 py-6 sm:px-6 sm:py-7 xl:px-9 xl:py-8">
                    {children}
                </main>
            </div>
        </div>
    )
}