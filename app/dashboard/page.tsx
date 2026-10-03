import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export const instant = false

export default async function DashboardPage() {
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
        <main className="min-h-screen p-8">
            <div className="mx-auto max-w-6xl">
                <p className="text-sm text-muted-foreground">
                    NextGen Management System
                </p>

                <h1 className="mt-2 text-3xl font-bold">
                    Dashboard
                </h1>

                <div className="mt-8 rounded-xl border p-6">
                    <p>
                        Logged in as: <strong>{user.email}</strong>
                    </p>

                    <p className="mt-2">
                        Role: <strong>{profile?.role ?? "Unknown"}</strong>
                    </p>
                </div>
            </div>
        </main>
    )
}