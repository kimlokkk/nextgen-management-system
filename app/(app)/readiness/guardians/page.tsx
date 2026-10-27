import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { resolveGuardianLink, resolveGuardianLinkNewParent } from "./actions"
import { GuardianLinkList } from "@/components/guardian-link-list"

export const dynamic="force-dynamic"
type Props={searchParams:Promise<{saved?:string;error?:string}>}

export default async function MissingGuardiansPage({searchParams}:Props){
 const params=await searchParams
 const supabase=await createClient()
 const {data:{user}}=await supabase.auth.getUser()
 if(!user)redirect("/auth/login")
 const {data:profile}=await supabase.from("profiles").select("role,is_active").eq("id",user.id).single()
 if(!profile?.is_active||!["admin","super_admin"].includes(profile.role)){
  return <section className="rounded-xl border bg-card p-6">
   <h1 className="text-xl font-semibold">Guardian link review</h1>
   <p className="mt-2 text-sm text-muted-foreground">Only active admins can review student relationships.</p>
  </section>
 }

 const [studentsResult,guardiansResult,parentsResult]=await Promise.all([
  supabase.from("students").select("id,full_name,status,notes").eq("status","active").order("full_name"),
  supabase.from("student_guardians").select("student_id,parent_id"),
  supabase.from("parents").select("id,full_name,whatsapp_phone,phone").order("full_name").limit(5000),
 ])
 const failure=[studentsResult.error,guardiansResult.error,parentsResult.error].find(Boolean)
 if(failure)return <section className="rounded-xl border border-destructive/25 bg-card p-6">
  <h1 className="text-xl font-semibold">Guardian review unavailable</h1>
  <p role="alert" className="mt-2 text-sm text-destructive">
   Could not verify all records: {failure.message}. No data changed.
  </p>
 </section>
 const linked=new Set((guardiansResult.data??[]).map(g=>g.student_id))
 const missing=(studentsResult.data??[]).filter(s=>!linked.has(s.id))
 const norm=(v:string)=>v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()
 const parents=(parentsResult.data??[]).map(p=>{
  const digits=(p.whatsapp_phone||p.phone||"").replace(/\D/g,"")
  return {id:p.id,label:p.full_name+(digits?" · contact ending "+digits.slice(-4):" · no contact number"),
   search:norm(p.full_name)+" "+digits}
 })
 const rosterPhone=(notes:string|null)=>/Roster phone:\s*([0-9+ -]{6,30})/.exec(notes??"")?.[1]?.trim()??null
 const missingStudents=missing.map(s=>({id:s.id,name:s.full_name,rosterPhone:rosterPhone(s.notes)}))
 return <div className="mx-auto max-w-4xl space-y-5">
  <header>
   <Link href="/readiness" className="text-sm font-semibold text-primary hover:underline">← Go-live readiness</Link>
   <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-primary">People · Data verification</p>
   <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Missing guardian links</h1>
   <p className="mt-2 text-sm leading-6 text-muted-foreground">
    Verify the adult–student relationship against an original enrollment record.
    Do not infer a guardian from matching names or contact numbers. This correction cannot change class bookings or attendance.
   </p>
  </header>
  {params.saved==="1"&&<p role="status" className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
   Guardian link saved with an audit record. Refresh Go-live readiness to verify the updated count.
  </p>}
  {params.error&&<p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
   {params.error}
  </p>}
  <section className="rounded-xl border bg-card p-4 sm:p-5">
   <h2 className="font-semibold">{missing.length} active student{missing.length===1?"":"s"} without a guardian link</h2>
   <p className="mt-1 text-xs text-muted-foreground">Only authenticated admins can view names here. No one is linked automatically.</p>
   {!missing.length?<p className="mt-4 rounded-lg border bg-primary/5 p-4 text-sm">
    Every active student currently has at least one guardian link. This is a structural check, not independent identity verification.
   </p>:<GuardianLinkList students={missingStudents} parents={parents}
    linkAction={resolveGuardianLink} newParentAction={resolveGuardianLinkNewParent}/>}
  </section>
  <p className="text-xs text-muted-foreground">
   This is an audited correction, not an import. Never choose an unrelated parent just to clear the warning.
  </p>
 </div>
}
