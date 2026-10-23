import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { resolveGuardianLink } from "./actions"

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
  supabase.from("students").select("id,full_name,status").eq("status","active").order("full_name"),
  supabase.from("student_guardians").select("student_id,parent_id"),
  supabase.from("parents").select("id,full_name,whatsapp_phone,phone").order("full_name"),
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
 const parents=(parentsResult.data??[]).map(p=>{
  const digits=(p.whatsapp_phone||p.phone||"").replace(/\D/g,"")
  return {id:p.id,label:p.full_name+(digits?" · contact ending "+digits.slice(-4):" · no contact number")}
 })
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
   </p>:missing.map(student=><section className="mt-4 rounded-xl border p-4" key={student.id}>
    <h3 className="font-semibold">{student.full_name}</h3>
    <p className="mt-1 text-xs text-muted-foreground">Active student · No guardian association in NextGen</p>
    <form action={resolveGuardianLink} className="mt-4 grid gap-3">
     <input type="hidden" name="student_id" value={student.id}/>
     <label className="block">
      <span className="mb-1 block text-xs font-semibold">Verified parent or guardian *</span>
      <select name="parent_id" required defaultValue="" className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
       <option value="" disabled>Select after checking the enrollment source</option>
       {parents.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
     </label>
     <label className="block">
      <span className="mb-1 block text-xs font-semibold">Confirmed relationship *</span>
      <select name="relationship" required defaultValue="" className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
       <option value="" disabled>Select relationship</option>
       <option value="father">Father</option>
       <option value="mother">Mother</option>
       <option value="guardian">Other legal guardian</option>
      </select>
     </label>
     <label className="block">
      <span className="mb-1 block text-xs font-semibold">Evidence reference *</span>
      <input name="evidence_reference" type="text" required minLength={10} maxLength={500}
       placeholder="E.g. signed enrollment sheet, tab/row and who verified it"
       className="h-10 w-full rounded-lg border bg-background px-3 text-sm"/>
      <span className="mt-1 block text-xs text-muted-foreground">
       Cite the real enrollment source, avoiding unnecessary personal details.
      </span>
     </label>
     <label className="flex items-start gap-2 text-xs leading-5">
      <input type="checkbox" name="confirmed" value="yes" required className="mt-1 size-4 accent-primary"/>
      I personally confirmed this adult is the parent/guardian named in the cited source.
     </label>
     <button type="submit" disabled={!parents.length}
      className="ui-secondary-action w-fit disabled:opacity-50">Link verified guardian</button>
     {!parents.length&&<p className="text-sm text-destructive">
      No parent records available. <Link href="/parents" className="underline">Create the verified parent first.</Link>
     </p>}
    </form>
   </section>)}
  </section>
  <p className="text-xs text-muted-foreground">
   This is an audited correction, not an import. Never choose an unrelated parent just to clear the warning.
  </p>
 </div>
}
