import Link from "next/link"
import { redirect } from "next/navigation"
import { AlertTriangle, CheckCircle2, CircleHelp, ShieldAlert } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { assessReadiness, type Snapshot } from "@/lib/admin-readiness"

export const dynamic = "force-dynamic"

type Item<T> = {data: T[] | null; error: {message:string} | null}
async function allRows<T>(
    query:(start:number,end:number)=>PromiseLike<Item<T>>,
):Promise<T[]> {
    const result:T[]=[]
    // Explicit pagination: Supabase defaults to a 1,000-row response limit.
    for(let start=0;start<200000;start+=400){
        const {data,error}=await query(start,start+399)
        if(error) throw new Error(error.message)
        const page=data??[]
        result.push(...page)
        if(page.length<400) return result
    }
    throw new Error("Data exceeds safety bound: audit incomplete")
}

const statusColor:Record<string,string>={
    pass:"text-emerald-700 dark:text-emerald-400",
    review:"text-amber-800 dark:text-amber-300",
    block:"text-destructive",
    manual:"text-muted-foreground",
}
const statusLabel:Record<string,string>={
    pass:"Checked",review:"Review",block:"Blocked",manual:"Unverified",
}

export default async function ReadinessPage(){
    const supabase=await createClient()
    const {data:{user}}=await supabase.auth.getUser()
    if(!user) redirect("/auth/login")
    const {data:profile,error:profileError}=await supabase.from("profiles")
        .select("role,is_active").eq("id",user.id).single()
    if(profileError||!profile?.is_active||!["admin","super_admin"].includes(profile.role)){
        return <section className="rounded-xl border bg-card p-6">
            <h1 className="text-xl font-semibold">Go-live readiness</h1>
            <p className="mt-2 text-sm text-muted-foreground">Only active administrators can access this audit.</p>
        </section>
    }

    let snapshot:Snapshot
    try{
        const [students,parents,guardians,enrollments,templates,branches,batches,sessions,bookings,october,september,reconciliations]=await Promise.all([
            allRows<Snapshot["students"][number]>((a,b)=>supabase.from("students").select("id,full_name,status").order("id").range(a,b)),
            allRows<Snapshot["parents"][number]>((a,b)=>supabase.from("parents").select("id").order("id").range(a,b)),
            allRows<Snapshot["guardians"][number]>((a,b)=>supabase.from("student_guardians").select("student_id,parent_id").order("student_id").order("parent_id").range(a,b)),
            allRows<Snapshot["enrollments"][number]>((a,b)=>supabase.from("enrollments").select("id,student_id,branch_id,programme_id,default_session_id,status").order("id").range(a,b)),
            allRows<Snapshot["templates"][number]>((a,b)=>supabase.from("session_templates").select("id,branch_id,programme_id").order("id").range(a,b)),
            allRows<Snapshot["branches"][number]>((a,b)=>supabase.from("branches").select("id,name,code").order("id").range(a,b)),
            allRows<Snapshot["batches"][number]>((a,b)=>supabase.from("schedule_batches").select("id,branch_id,schedule_month,status").order("id").range(a,b)),
            allRows<Snapshot["sessions"][number]>((a,b)=>supabase.from("class_sessions").select("id,schedule_batch_id,branch_id,programme_id,session_template_id,class_date,status,regular_capacity,replacement_capacity").order("id").range(a,b)),
            allRows<Snapshot["bookings"][number]>((a,b)=>supabase.from("student_bookings").select("id,class_session_id,student_id,enrollment_id,booking_type,attendance_status").order("id").range(a,b)),
            allRows<Snapshot["october"][number]>((a,b)=>supabase.from("legacy_replacement_reviews").select("id,target_class_id,review_state,linked_active_booking_id").eq("source_batch","mtdc-2026-10").order("id").range(a,b)),
            allRows<Snapshot["september"][number]>((a,b)=>supabase.from("legacy_september_evidence").select("id,evidence_kind").eq("source_batch","mtdc-2026-09").order("id").range(a,b)),
            allRows<Snapshot["reconciliations"][number]>((a,b)=>supabase.from("legacy_reconciliation_decisions")
                .select("review_id,disposition").order("review_id").range(a,b)),
        ])
        snapshot={students,parents,guardians,enrollments,templates,branches,batches,sessions,bookings,october,september,reconciliations}
    }catch(e){
        return <section className="rounded-xl border border-destructive/30 bg-card p-6">
            <h1 className="text-xl font-semibold">Go-live readiness · audit unavailable</h1>
            <p role="alert" className="mt-3 text-sm text-destructive">
                Could not verify all data. Go-live remains blocked. {e instanceof Error?e.message:"Unknown query error"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">No data was changed. Check local migrations and admin permissions.</p>
        </section>
    }
    const report=assessReadiness(snapshot)
    return <div className="min-w-0 space-y-5">
        <header>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Operations · read-only</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Go-live readiness audit</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Checks live NextGen records in the connected environment. This does not approve a migration,
                verify historical attendance, change class bookings or certify production.
            </p>
        </header>
        <section className="rounded-xl border bg-card p-4 sm:p-5" aria-label="Readiness summary">
            <div className="flex flex-wrap items-center gap-3">
                <ShieldAlert className="size-5 text-amber-700 dark:text-amber-300" aria-hidden="true"/>
                <h2 className="font-semibold">Not approved for admin go-live</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
                {report.blockers} automated blockers · {report.reviews} items needing review ·
                {" "}{report.manual} manual sign-offs outstanding. A green check means only the named automated test passed.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {report.metrics.map(m=><div key={m.label} className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{m.value.toLocaleString("en-MY")}</p>
                </div>)}
            </div>
        </section>
        <section className="rounded-xl border bg-card p-4 sm:p-5" aria-label="Readiness checks">
            <h2 className="font-semibold">Actionable checks</h2>
            <p className="mt-1 text-sm text-muted-foreground">Fix blockers first, then investigate evidence and complete witnessed production checks.</p>
            <div className="mt-4 divide-y">
                {report.checks.map(c=><div key={c.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:justify-between sm:gap-6">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            {c.status==="pass"?<CheckCircle2 className="size-4 shrink-0 text-emerald-600"/>:
                                c.status==="block"?<AlertTriangle className="size-4 shrink-0 text-destructive"/>:
                                <CircleHelp className="size-4 shrink-0 text-amber-600"/>}
                            <h3 className="text-sm font-semibold">{c.label}</h3>
                        </div>
                        <p className="mt-1 pl-6 text-sm leading-6 text-muted-foreground">{c.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 pl-6 sm:pl-0">
                        <span className={`text-xs font-semibold ${statusColor[c.status]}`}>
                            {statusLabel[c.status]}{typeof c.count==="number"?` · ${c.count}`:""}
                        </span>
                        {c.href&&<Link className="text-xs font-semibold text-primary underline-offset-4 hover:underline" href={c.href}>
                            Review →
                        </Link>}
                    </div>
                </div>)}
            </div>
        </section>
        <p className="text-xs leading-5 text-muted-foreground">
            September/October spreadsheets in local staging must be reconciled and securely transferred to production
            before admin access. No student identity, attendance or entitlement is inferred from an Excel match.
        </p>
    </div>
}
