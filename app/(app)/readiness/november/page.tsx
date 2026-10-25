import Link from "next/link"
import { redirect } from "next/navigation"
import { CalendarCheck2, AlertTriangle, CircleHelp, CheckCircle2 } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { buildNovemberPreflight, type PreviewEnrollment, type PreviewStudent } from "@/lib/november-preflight"
import type { SessionTemplate, CalendarException } from "@/lib/scheduling"
import {
 auditNovemberStoredDraft,
 type DraftAuditResult, type StoredNovemberSession, type StoredNovemberBooking,
} from "@/lib/november-draft-audit"

export const dynamic = "force-dynamic"

type Page<T>={data:T[]|null;error:{message:string}|null}
async function fetchAll<T>(query:(a:number,b:number)=>PromiseLike<Page<T>>):Promise<T[]>{
 const rows:T[]=[]
 for(let offset=0;offset<20000;offset+=400){
  const {data,error}=await query(offset,offset+399)
  if(error)throw Error(error.message)
  const page=data??[]
  rows.push(...page)
  if(page.length<400)return rows
 }
 throw Error("Audit safety limit reached; incomplete data")
}

export default async function NovemberReadinessPage(){
 const supabase=await createClient()
 const {data:{user}}=await supabase.auth.getUser()
 if(!user)redirect("/auth/login")
 const {data:profile,error:profileError}=await supabase.from("profiles")
    .select("role,is_active").eq("id",user.id).single()
 if(profileError||!profile?.is_active||!["admin","super_admin"].includes(profile.role)){
  return <section className="rounded-xl border bg-card p-6">Only active administrators can view November preflight.</section>
 }

 const {data:branches,error:branchError}=await supabase.from("branches")
  .select("id,name,code").order("name")
 if(branchError)return <p role="alert" className="text-destructive">Could not load branches: {branchError.message}</p>
 const mtdc=(branches??[]).find(b=>b.name.toLowerCase().includes("mtdc") || b.code?.toLowerCase()==="mtdc")
 if(!mtdc)return <section className="rounded-xl border bg-card p-6">
  <h1 className="text-xl font-semibold">MTDC November preview unavailable</h1>
  <p className="mt-2 text-sm text-destructive">Cannot identify the MTDC branch safely. No schedule was generated.</p>
 </section>

 const lastDay="2026-11-30"
 let templates:SessionTemplate[],enrollments:PreviewEnrollment[],students:PreviewStudent[],calendar:CalendarException[]
 let existingBatch:{id:string;status:string}|null=null
 try{
  const [t,e,s,c,b]=await Promise.all([
   fetchAll<SessionTemplate>((a,z)=>supabase.from("session_templates")
    .select("id,branch_id,programme_id,day_of_week,start_time,end_time,regular_capacity,replacement_capacity")
    .eq("branch_id",mtdc.id).eq("is_active",true).order("id").range(a,z)),
   fetchAll<PreviewEnrollment>((a,z)=>supabase.from("enrollments")
    .select("id,student_id,branch_id,programme_id,default_session_id,frequency_type,preferred_weeks,start_date,end_date,status")
    .eq("branch_id",mtdc.id).eq("status","active").order("id").range(a,z)),
   fetchAll<PreviewStudent>((a,z)=>supabase.from("students").select("id,status").order("id").range(a,z)),
   fetchAll<CalendarException>((a,z)=>supabase.from("academic_calendar_exceptions")
    .select("closed_on,decision,target_on").eq("branch_id",mtdc.id)
    .gte("closed_on","2026-11-01").lte("closed_on",lastDay).order("closed_on").range(a,z)),
   supabase.from("schedule_batches").select("id,status")
    .eq("branch_id",mtdc.id).eq("schedule_month","2026-11-01").maybeSingle(),
  ])
  if(b.error)throw Error(b.error.message)
  templates=t;enrollments=e;students=s;calendar=c;existingBatch=b.data
 }catch(error){
  return <section className="rounded-xl border border-destructive/30 bg-card p-6">
   <h1 className="text-xl font-semibold">November preflight unavailable</h1>
   <p role="alert" className="mt-2 text-sm text-destructive">
    {error instanceof Error?error.message:"Data read error"}. Nothing was changed.
   </p>
  </section>
 }
 const report=buildNovemberPreflight({templates,enrollments,students,calendar,existingBatch:null})
 const blockers=report.issues.filter(i=>i.level==="blocker")
 const reviews=report.issues.filter(i=>i.level==="review")
 let storedAudit:DraftAuditResult|null=null
 let storedAuditError:string|null=null
 if(existingBatch){
  try{
   const sessions=await fetchAll<StoredNovemberSession>((a,z)=>supabase.from("class_sessions")
    .select("id,session_template_id,class_date,week_number,start_time,end_time,regular_capacity,replacement_capacity,status")
    .eq("schedule_batch_id",existingBatch.id).order("id").range(a,z))
   const ids=sessions.map(s=>s.id)
   const bookings=ids.length?await fetchAll<StoredNovemberBooking>((a,z)=>supabase.from("student_bookings")
    .select("id,class_session_id,student_id,enrollment_id,booking_type,attendance_status")
    .in("class_session_id",ids).order("id").range(a,z)):[]
   storedAudit=auditNovemberStoredDraft(report.classes,enrollments,sessions,bookings)
  }catch(err){
   storedAuditError=err instanceof Error?err.message:"Unable to load all stored November records"
  }
 }
 const snapshotReady=blockers.length===0 && storedAudit?.matching===true
 const expectedTemplateNames=new Map<string,string>()
 const {data:templateNames,error:namesError}=await supabase.from("session_templates")
  .select("id,name").eq("branch_id",mtdc.id)
 if(!namesError)for(const item of templateNames??[])expectedTemplateNames.set(item.id,item.name||"Unnamed session")

 return <div className="min-w-0 space-y-5">
  <header>
   <Link href="/readiness" className="text-sm font-semibold text-primary hover:underline">← Go-live readiness</Link>
   <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-primary">MTDC · Read-only · November 2026</p>
   <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">November schedule preflight</h1>
   <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
    Forecast from active session templates, enrollments and Academic Calendar; if a November draft exists,
    compare its stored sessions and individual bookings with that forecast. Read-only: no approval, changes to
    attendance or new seat reservations.
   </p>
  </header>
  <section className="rounded-xl border bg-card p-4 sm:p-5">
   <div className="flex flex-wrap items-center gap-2">
    {blockers.length?<AlertTriangle className="size-5 text-destructive"/>:<CalendarCheck2 className="size-5 text-primary"/>}
    <h2 className="font-semibold">{blockers.length?"November projection has blockers":existingBatch?"November draft exists · projection checked":"November projection completed"}</h2>
   </div>
   <p className="mt-1 text-sm text-muted-foreground">
    {blockers.length} structural blockers · {reviews.length} reviews.
    {existingBatch?" Existing batch: "+existingBatch.status+". Regeneration remains disabled.":" Draft has not been generated yet."}
   </p>
   <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
    {[
     ["Active MTDC enrollments",report.activeEnrollments],
     ["Planned class sessions",report.classCount],
     ["Expected regular bookings",report.expectedBookings],
     ["Overfull regular sessions",report.overloadedClasses],
    ].map(([name,count])=><div key={name} className="rounded-lg border bg-muted/20 p-3">
     <p className="text-xs text-muted-foreground">{name}</p>
     <p className="mt-1 text-xl font-semibold tabular-nums">{count}</p>
    </div>)}
   </div>
  </section>
  <section className="rounded-xl border bg-card p-4 sm:p-5">
   <h2 className="font-semibold">Preflight findings</h2>
   {report.issues.length?<div className="mt-3 divide-y">
    {report.issues.map((i,index)=><div key={i.code+index} className="flex items-start gap-2 py-3">
     {i.level==="blocker"?<AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive"/>:<CircleHelp className="mt-0.5 size-4 shrink-0 text-amber-600"/>}
     <p className="text-sm">{i.detail}</p>
    </div>)}
   </div>:<div className="mt-3 flex gap-2 text-sm text-primary">
    <CheckCircle2 className="size-4 shrink-0"/> No blocking structural issues in this projection.
   </div>}
   <p className="mt-3 text-xs leading-5 text-muted-foreground">
    Destructive regeneration is disabled at the server. Existing class and booking IDs cannot be overwritten
    using Generate. Audit any existing draft against the expected student allocations before approval.
   </p>
  </section>
  {existingBatch && <section className="rounded-xl border bg-card p-4 sm:p-5">
   <h2 className="font-semibold">November stored draft audit</h2>
   <p className="mt-1 text-xs leading-5 text-muted-foreground">
    Compares saved sessions, class times, each student and their enrollment IDs against the current projection.
    This does not approve or lock the draft. Changes to enrollments since generation can cause a mismatch.
   </p>
   {storedAuditError ? <p role="alert" className="mt-3 text-sm text-destructive">
    Audit unavailable: {storedAuditError}. Do not approve the draft.
   </p> : storedAudit ? <>
    <p className={"mt-3 flex items-center gap-2 text-sm font-semibold "+(snapshotReady?"text-primary":"text-destructive")}>
      {snapshotReady?<CheckCircle2 className="size-4"/>:<AlertTriangle className="size-4"/>}
      {snapshotReady?"Stored draft matches the current November projection":"Stored draft needs correction before approval"}
    </p>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
     {[
      ["Expected sessions",storedAudit.expectedClasses],
      ["Saved sessions",storedAudit.actualClasses],
      ["Expected bookings",storedAudit.expectedBookings],
      ["Saved bookings",storedAudit.actualBookings],
     ].map(([label,n])=><div key={label} className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{n}</p>
     </div>)}
    </div>
    {storedAudit.issues.length>0&&<div className="mt-3 space-y-2">
     {storedAudit.issues.slice(0,30).map((item,i)=><p key={item.code+i} className="text-sm text-destructive">
       {item.code}: {item.description}
     </p>)}
     {storedAudit.issues.length>30&&<p className="text-xs text-muted-foreground">
      {storedAudit.issues.length-30} more issues omitted; developer review required.
     </p>}
    </div>}
    {snapshotReady&&<p className="mt-3 text-xs leading-5 text-muted-foreground">
     UAT comparison passed for this snapshot only. Admin still needs to verify actual class dates,
     facilitators, closures and communication before any approval. Do not lock yet.
    </p>}
   </> : null}
  </section>}
  <section className="rounded-xl border bg-card p-4 sm:p-5">
   <h2 className="font-semibold">Projected sessions ({report.classCount})</h2>
   <p className="mt-1 text-xs text-muted-foreground">
    Regular seats only. Replacement entitlement, future yellow-seat demand and facilitator availability require separate approval.
   </p>
   <div className="mt-3 max-h-[36rem] overflow-auto rounded-lg border">
    <table className="w-full min-w-[40rem] text-left text-sm">
     <thead className="sticky top-0 bg-muted">
      <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Class</th>
       <th className="px-3 py-2">Week</th><th className="px-3 py-2">Time</th>
       <th className="px-3 py-2 text-right">Regular seats</th></tr>
     </thead>
     <tbody>
      {report.classes.map((c,i)=><tr key={c.templateId+c.date+c.start+i} className="border-t">
       <td className="px-3 py-2">{c.date}</td>
       <td className="px-3 py-2">{expectedTemplateNames.get(c.templateId)??c.templateId}</td>
       <td className="px-3 py-2">W{c.week}</td>
       <td className="px-3 py-2">{c.start.slice(0,5)}–{c.end.slice(0,5)}</td>
       <td className={"px-3 py-2 text-right font-medium "+(c.expectedRegular>c.regularCapacity?"text-destructive":"")}>
        {c.expectedRegular} / {c.regularCapacity}
       </td>
      </tr>)}
     </tbody>
    </table>
   </div>
   <div className="mt-4 flex flex-wrap items-center gap-3">
    <Link href={"/schedule?prepare_month=2026-11&branch="+mtdc.id}
     className="ui-secondary-action">Open schedule workspace →</Link>
    <span className="text-xs text-muted-foreground">
     Opening the schedule page will not generate automatically. Keep November as Draft until UAT is signed off.
    </span>
   </div>
  </section>
 </div>
}
