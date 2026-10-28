import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export const dynamic="force-dynamic"
const checklist = [
 {title:"Local backup snapshot",detail:"Take a fresh dump of Supabase Local staging and verify its SHA-256 checksum. Never upload private backup files to GitHub."},
 {title:"Isolated restore verification",detail:"Restore into a separate EMPTY nextgen_restore_drill_* database and compare the baseline JSON. This has not been performed on real MTDC data."},
 {title:"Confirm all data sources",detail:"Cross-check September 622 source rows, October 81 source rows and November 48 classes/356 bookings with the actual local source. Counts alone do not prove identity."},
 {title:"Prepare cloud database and identities",detail:"Create a separate hosted environment, preserve linked UUIDs and Auth users, test RLS. No automatic local-to-cloud synchronization exists yet."},
 {title:"Files, messaging and credentials",detail:"Back up Cloudflare R2/Supabase Storage objects separately. Keep Merpati/invoice notifications disabled until approval."},
 {title:"Admin & recovery sign-off",detail:"Complete human UAT, five capacity exceptions, Hadi guardian source, documented rollback and an approved release window."},
]

export default async function RecoveryReadinessPage(){
 const supabase=await createClient()
 const {data:{user}}=await supabase.auth.getUser()
 if(!user)redirect("/auth/login")
 const {data:profile,error}=await supabase.from("profiles")
  .select("role,is_active").eq("id",user.id).single()
 if(error||!profile?.is_active||!["admin","super_admin"].includes(profile.role))
  return <section className="rounded-xl border bg-card p-6">
    <h1 className="font-semibold">Recovery and cutover review</h1>
    <p className="mt-2 text-sm text-muted-foreground">Only active admins can access this review.</p>
  </section>
 return <div className="mx-auto max-w-4xl space-y-5">
  <header>
   <Link href="/readiness" className="text-sm font-semibold text-primary hover:underline">← Go-live readiness</Link>
   <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-primary">Read-only · Release control</p>
   <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Backup, restore and cloud cutover</h1>
   <p className="mt-2 text-sm leading-6 text-muted-foreground">
    Synthetic CI tests only establish that backup commands, checksum validation and isolated restore controls work.
    Actual MTDC restore, cloud migration and operational acceptance must still be witnessed and signed off.
   </p>
  </header>
  <section className="rounded-xl border bg-card p-4 sm:p-5">
   <h2 className="font-semibold text-destructive">Not approved for production</h2>
   <p className="mt-2 text-sm text-muted-foreground">
    The real November draft remains local. Nothing on this page runs a backup,
    starts cloud deployment, releases a guardian, or clears historical capacity exceptions.
   </p>
  </section>
  <section className="rounded-xl border bg-card p-4 sm:p-5">
   <h2 className="font-semibold">Recovery checklist</h2>
   <p className="mt-1 text-xs text-muted-foreground">These are manual release gates—not completed status indicators.</p>
   <div className="mt-3 divide-y">
    {checklist.map((item,index)=><article key={item.title} className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
       <h3 className="text-sm font-semibold">{index+1}. {item.title}</h3>
       <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">Awaiting evidence</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
    </article>)}
   </div>
  </section>
  <section className="rounded-xl border bg-card p-4 sm:p-5">
   <h2 className="font-semibold">Local-only recovery scripts</h2>
   <p className="mt-2 text-sm text-muted-foreground">
    Once PostgreSQL client tools are installed, use the scripts in the NextGen repository.
    They reject non-local database URLs and prevent restore into the original postgres database.
   </p>
   <p className="mt-3 text-sm font-medium">Backup</p>
   <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-3 text-xs">bash scripts/backup-local-staging.sh</pre>
   <p className="mt-3 text-sm font-medium">Verify a restore (separate empty drill database only)</p>
   <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-3 text-xs">bash scripts/verify-local-restore.sh .local-backups/snapshot-.../</pre>
   <p className="mt-2 text-xs leading-5 text-muted-foreground">
    Refer to docs/production-cutover-runbook.md for environment variables, compatibility and safety requirements.
    Backup files contain private information and must never be uploaded or committed.
   </p>
  </section>
 </div>
}
