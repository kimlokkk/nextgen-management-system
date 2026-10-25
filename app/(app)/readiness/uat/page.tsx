import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const checks = [
 {label:"Enrollment → monthly timetable",
  action:"Compare November dates, class slots and student assignments to the verified enrollment records.",
  pass:"Class dates and W1–W4 allocations match the operations-approved schedule."},
 {label:"Draft → Approved → Locked",
  action:"Use an ISOLATED test batch only. Try both actions without acknowledgements and with invalid inputs, then verify permitted transitions.",
  pass:"Unauthorized, unacknowledged, invalid and repeated transitions are rejected. Real November stays Draft."},
 {label:"Attendance and time gates",
  action:"Using fixture classes with past dates, test present, absent, correction, and non-admin access. Never mark future November attendance.",
  pass:"Future attendance blocked; only authorized records in ended, locked classes can be marked."},
 {label:"Reschedules and replacements",
  action:"On fake students, open an obligation, assign yellow seat, test full capacity, change/release/cancel booking.",
  pass:"No double entitlement, no yellow overbooking, no loss of original booking/history."},
 {label:"Legacy data integrity",
  action:"After UAT, recheck MTDC September/October baseline and the five open capacity exceptions.",
  pass:"No old evidence, booking or seat exception silently changed."},
 {label:"Human sign-off and recovery",
  action:"Record named admin's dated acceptance, practical room/facilitator checks and a tested backup/restore plan outside this page.",
  pass:"Operational owner explicitly signs off; deployment/cutover remains a separate approval."}
]

export default async function UatReadinessPage() {
 const supabase=await createClient()
 const {data:{user}}=await supabase.auth.getUser()
 if(!user) redirect("/auth/login")
 const {data:profile,error}=await supabase.from("profiles").select("role,is_active").eq("id",user.id).single()
 if(error||!profile?.is_active||!["admin","super_admin"].includes(profile.role))
  return <section className="rounded-xl border bg-card p-6">
   <h1 className="font-semibold">Admin UAT</h1>
   <p className="mt-2 text-sm text-muted-foreground">Only active admins may access this checklist.</p>
  </section>
 const {data:branches,error:branchError}=await supabase.from("branches").select("id,name,code")
 let status="Not verified"
 if(!branchError){
  const branch=(branches??[]).find(b=>b.name.toLowerCase().includes("mtdc")||b.code?.toLowerCase()==="mtdc")
  if(branch){
   const r=await supabase.from("schedule_batches").select("status")
    .eq("branch_id",branch.id).eq("schedule_month","2026-11-01").maybeSingle()
   status=r.error?"Read failed: "+r.error.message:r.data?.status??"No November batch"
  }
 }
 return <div className="mx-auto max-w-5xl space-y-5">
  <header>
   <Link href="/readiness" className="text-sm font-semibold text-primary hover:underline">← Go-live readiness</Link>
   <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-primary">Admin-Ready V1 · Read-only</p>
   <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">End-to-end operations UAT</h1>
   <p className="mt-2 text-sm leading-6 text-muted-foreground">
    CI SQL fixtures cover portions of attendance and replacement logic, but witnessed admin UAT is still outstanding.
    This page is a reference checklist, not a certification or a writable test environment.
   </p>
  </header>
  <section className="rounded-xl border bg-card p-4 sm:p-5">
   <h2 className="font-semibold">Protected MTDC November 2026</h2>
   <p className="mt-2 text-sm">Current schedule status: <strong>{status}</strong></p>
   <p className="mt-2 text-sm leading-6 text-destructive">
    Do not approve/lock this real batch or enter dummy attendance, reschedules or replacements merely for testing.
    Use a separate disposable database populated with synthetic people and sessions.
   </p>
   <Link href="/readiness/november" className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline">
    Review saved November draft →
   </Link>
  </section>
  <section className="rounded-xl border bg-card p-4 sm:p-5">
   <h2 className="font-semibold">Six acceptance gates</h2>
   <p className="mt-1 text-xs text-muted-foreground">All remain pending until a real admin completes and records results.</p>
   <div className="mt-3 divide-y">
    {checks.map((c,i)=><article key={c.label} className="py-4">
     <div className="flex flex-wrap justify-between gap-2">
      <h3 className="text-sm font-semibold">{i+1}. {c.label}</h3>
      <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">Pending human sign-off</span>
     </div>
     <p className="mt-2 text-sm text-muted-foreground">{c.action}</p>
     <p className="mt-2 text-sm"><strong>Pass criteria:</strong> {c.pass}</p>
    </article>)}
   </div>
  </section>
  <p className="text-xs leading-5 text-muted-foreground">
   No actions on this page change schedule status, attendance, capacity, evidence or student data.
  </p>
 </div>
}
