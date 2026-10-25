/** Read-only go-live audit. No function in this module changes database records. */
export type Check = {id:string; label:string; description:string; status:"pass"|"block"|"review"|"manual"; count?:number; href?:string}
export type Snapshot = {
 students:{id:string;full_name:string;status:string}[];
 parents:{id:string}[];
 guardians:{student_id:string;parent_id:string}[];
 enrollments:{id:string;student_id:string;branch_id:string;programme_id:string;default_session_id:string|null;status:string}[];
 templates:{id:string;branch_id:string;programme_id:string}[];
 branches:{id:string;name:string;code:string|null}[];
 batches:{id:string;branch_id:string;schedule_month:string;status:string}[];
 sessions:{id:string;schedule_batch_id:string;branch_id:string;programme_id:string;session_template_id:string;class_date:string;status:string;regular_capacity:number;replacement_capacity:number}[];
 bookings:{id:string;class_session_id:string;student_id:string;enrollment_id:string|null;booking_type:string;attendance_status:string}[];
 october:{id:string;target_class_id:string|null;review_state:string;linked_active_booking_id:string|null}[];
 september:{id:string;evidence_kind:string}[];
 reconciliations:{review_id:string;disposition:string}[];
}
const normalize=(s:string)=>s.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase()
const occupying=(s:string)=>!["cancelled","not_scheduled","rescheduled"].includes(s)
export function assessReadiness(d:Snapshot) {
 const checks:Check[]=[]
 const add=(c:Check)=>checks.push(c)
 const students=new Map(d.students.map(x=>[x.id,x]))
 const enrollments=new Map(d.enrollments.map(x=>[x.id,x]))
 const templates=new Map(d.templates.map(x=>[x.id,x]))
 const batches=new Map(d.batches.map(x=>[x.id,x]))
 const mt=d.branches.find(x=>normalize(x.name).includes("mtdc")||normalize(x.code??"")==="mtdc")
 const oct=d.sessions.filter(x=>x.branch_id===mt?.id&&x.class_date.startsWith("2026-10-"))
 const octIds=new Set(oct.map(x=>x.id))
 const bookings=d.bookings.filter(x=>octIds.has(x.class_session_id))
 const regular=bookings.filter(x=>x.booking_type==="regular")
 const active=d.students.filter(x=>x.status==="active")
 const guardianIds=new Set(d.guardians.map(x=>x.student_id))
 const activeEnroll=d.enrollments.filter(x=>x.status==="active")
 const incompleteEnroll=activeEnroll.filter(x=>{
   const session=x.default_session_id?templates.get(x.default_session_id):null
   return !students.has(x.student_id) || students.get(x.student_id)?.status!=="active" ||
     !d.branches.some(b=>b.id===x.branch_id) ||
     !d.templates.some(t=>t.id===x.default_session_id && t.branch_id===x.branch_id && t.programme_id===x.programme_id) ||
     !session
 }).length
 const duplicateNames=new Map<string,number>()
 for(const x of d.students) {const k=normalize(x.full_name);if(k)duplicateNames.set(k,(duplicateNames.get(k)??0)+1)}
 const duplicateGroups=[...duplicateNames.values()].filter(x=>x>1).length
 const nameless=d.students.filter(x=>!x.full_name.trim()).length
 add({id:"students",label:"Student directory",status:d.students.length?"pass":"block",count:d.students.length,
 description:"Records loaded. Not proof that every student's identity is verified.",href:"/students"})
 add({id:"names",label:"Student name quality",status:nameless?"block":duplicateGroups?"review":"pass",
 count:nameless+duplicateGroups,description:`${nameless} missing names · ${duplicateGroups} duplicate-name groups. Never merge automatically.`,href:"/students"})
 const missingGuardian=active.filter(x=>!guardianIds.has(x.id)).length
 add({id:"guardians",label:"Parent / guardian associations",status:missingGuardian?"review":"pass",count:missingGuardian,
 description:`${missingGuardian} active students without a linked guardian. May need manual confirmation.`,href:"/readiness/guardians"})
 add({id:"enrollments",label:"Active enrollment links",status:incompleteEnroll?"block":"pass",count:incompleteEnroll,
 description:`${incompleteEnroll} active enrollments have a missing/inactive student or a missing/mismatched regular class template.`,href:"/enrollments"})
 add({id:"october-schedule",label:"MTDC October baseline",status:oct.length&&regular.length?"pass":"block",
 count:oct.length,description:`${oct.length} class sessions · ${regular.length} regular bookings. Compare against signed-off September/October imports.`,href:"/schedule"})
 const invalidClasses=oct.filter(x=>!templates.has(x.session_template_id)||batches.get(x.schedule_batch_id)?.branch_id!==x.branch_id).length
 const invalidBookings=bookings.filter(b=>{
   const session=oct.find(x=>x.id===b.class_session_id)
   const en=b.enrollment_id?enrollments.get(b.enrollment_id):null
   return !students.has(b.student_id) ||
     (b.booking_type==="regular" && (!en || en.student_id!==b.student_id || en.branch_id!==session?.branch_id || en.programme_id!==session?.programme_id))
 }).length
 add({id:"booking-links",label:"October booking references",status:invalidClasses+invalidBookings?"block":"pass",
 count:invalidClasses+invalidBookings,description:`${invalidClasses} class-template/batch mismatches · ${invalidBookings} invalid booking/student/enrollment links.`,href:"/schedule"})
 const legacyByClass=new Map<string,typeof d.october>()
 for(const x of d.october){if(!x.target_class_id||x.review_state==="excluded")continue;const list=legacyByClass.get(x.target_class_id)??[];list.push(x);legacyByClass.set(x.target_class_id,list)}
 const byClass=new Map<string,typeof bookings>()
 for(const x of bookings){const list=byClass.get(x.class_session_id)??[];list.push(x);byClass.set(x.class_session_id,list)}
 let yellowOver=0,regularOver=0
 for(const session of oct.filter(x=>x.status==="scheduled")){
   const slot=byClass.get(session.id)??[]
   const activeYellow=slot.filter(x=>x.booking_type==="replacement"&&!["cancelled","not_scheduled"].includes(x.attendance_status))
   const activeIds=new Set(activeYellow.map(x=>x.id))
   const historic=(legacyByClass.get(session.id)??[]).filter(x=>!x.linked_active_booking_id||!activeIds.has(x.linked_active_booking_id)).length
   if(activeYellow.length+historic>session.replacement_capacity)yellowOver++
   if(slot.filter(x=>["regular","reschedule"].includes(x.booking_type)&&occupying(x.attendance_status)).length>session.regular_capacity)regularOver++
 }
 add({id:"capacity",label:"October class capacity",status:yellowOver+regularOver?"block":"pass",count:yellowOver+regularOver,
 description:`${yellowOver} yellow overcapacity sessions (active + confirmed Excel legacy) · ${regularOver} regular overcapacity sessions. No automatic override.`,href:"/replacements/legacy"})
 const noTarget=d.october.filter(x=>x.review_state!=="excluded"&&!x.target_class_id).length
 add({id:"october-history",label:"October historical source data imported",
 status:d.october.length?(noTarget?"review":"pass"):"block",count:d.october.length,
 description:`${d.october.length} imported source rows · ${noTarget} non-excluded rows without a target class. Presence in the database does not mean review is complete.`,href:"/replacements/legacy"})
 const decisions=new Map(d.reconciliations.map(x=>[x.review_id,x.disposition]))
 const waiting=d.october.filter(x=>!decisions.has(x.id)).length
 const investigating=d.october.filter(x=>decisions.get(x.id)==="needs_investigation").length
 const correlated=d.october.filter(x=>decisions.get(x.id)==="source_correlated").length
 const checked=d.october.filter(x=>decisions.get(x.id)==="source_checked").length
 add({id:"october-reconciliation",label:"October source reconciliation decisions",
 status:waiting||investigating||correlated?"review":"pass",count:waiting+investigating+correlated,
 description:`${checked} source checked · ${correlated} correlated but unverified · ${investigating} needs investigation · ${waiting} has no evidence decision. These do not represent approved replacement entitlements.`,
 href:"/replacements/legacy"})
 const roster=d.september.filter(x=>x.evidence_kind==="regular_roster").length
 const replacement=d.september.filter(x=>x.evidence_kind==="legacy_replacement").length
 add({id:"september-history",label:"September source evidence",status:roster&&replacement?"pass":"block",
 count:roster+replacement,description:`${roster} weekly roster rows · ${replacement} replacement source rows. Raw marks not interpreted as attendance.`,href:"/replacements/legacy"})
 const november=d.batches.filter(x=>x.branch_id===mt?.id&&x.schedule_month.startsWith("2026-11-"))
 add({id:"november",label:"November 2026 schedule",status:november.length?"review":"block",count:november.length,
 description:november.length?`November batch exists (${november.map(x=>x.status).join(", ")}). Manual operations sign-off still required.`:"November draft not yet prepared for MTDC.",
 href:"/readiness/november"})
 for(const [id,label,description] of [
 ["uat","Full admin UAT","Witness full admin workflows in disposable staging; MTDC November draft must stay untouched."],
 ["backup","Backups and recovery","Production backup, a tested restore, and access-control review must be signed off."],
 ["deployment","Production data cutover","September/October imports and enrollments are LOCAL. Cloud data migration, hosting and credentials require explicit controlled deployment."]
 ]) add({id,label,description,status:"manual",...(id==="uat"?{href:"/readiness/uat"}:id==="backup"||id==="deployment"?{href:"/readiness/recovery"}:{})})
 return {
  metrics:[
   {label:"Students",value:d.students.length},
   {label:"Parents",value:d.parents.length},
   {label:"Active enrollments",value:activeEnroll.length},
   {label:"October regular bookings",value:regular.length},
   {label:"September evidence",value:d.september.length},
   {label:"October legacy",value:d.october.length}
  ],checks,
  blockers:checks.filter(x=>x.status==="block").length,
  reviews:checks.filter(x=>x.status==="review").length,
  manual:checks.filter(x=>x.status==="manual").length,
 }
}
