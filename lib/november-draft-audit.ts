import { isEligibleForPlannedClass, type ClassPreview, type PreviewEnrollment } from "@/lib/november-preflight"

export type StoredNovemberSession = {
 id:string; session_template_id:string; class_date:string; week_number:number;
 start_time:string; end_time:string; regular_capacity:number; replacement_capacity:number;
 status:string
}
export type StoredNovemberBooking = {
 id:string; class_session_id:string; student_id:string; enrollment_id:string|null;
 booking_type:string; attendance_status:string
}
export type DraftAuditIssue = {kind:"blocker"|"review"; code:string; description:string}
export type DraftAuditResult = {
 matching:boolean; expectedClasses:number; actualClasses:number;
 expectedBookings:number; actualBookings:number; issues:DraftAuditIssue[]
}
const sessionKey=(template:string,date:string)=>template+"|"+date
const hhmm=(time:string)=>time.slice(0,5)

/** Compares EVERY expected student/enrollment allocation, not just totals.
 * Intended for a newly generated, untouched draft and a same-time enrollment snapshot.
 * Read-only: no approval, seat changes, attendance or entitlement is created.
 */
export function auditNovemberStoredDraft(
 expected:ClassPreview[], enrollments:PreviewEnrollment[],
 actualSessions:StoredNovemberSession[], actualBookings:StoredNovemberBooking[]
):DraftAuditResult {
 const issues:DraftAuditIssue[]=[]
 const add=(code:string,description:string,kind:DraftAuditIssue["kind"]="blocker")=>
  issues.push({kind,code,description})
 const byKey=new Map<string,StoredNovemberSession>()
 const sessionIds=new Set(actualSessions.map(s=>s.id))
 for(const s of actualSessions){
  const key=sessionKey(s.session_template_id,s.class_date)
  if(byKey.has(key))add("DUPLICATE_CLASS",`Duplicate session for ${s.class_date} / ${s.session_template_id}`)
  byKey.set(key,s)
 }
 const expectedKeys=new Set<string>()
 const bookingsBySession=new Map<string,StoredNovemberBooking[]>()
 for(const b of actualBookings){
  if(!sessionIds.has(b.class_session_id))add("ORPHAN_BOOKING",`Booking ${b.id} belongs to a missing session`)
  const current=bookingsBySession.get(b.class_session_id)??[]
  current.push(b);bookingsBySession.set(b.class_session_id,current)
 }
 let expectedCount=0
 for(const planned of expected){
  const key=sessionKey(planned.templateId,planned.date)
  if(expectedKeys.has(key))add("DUPLICATE_PROJECTION",`Repeated projected class ${planned.date} / ${planned.templateId}`)
  expectedKeys.add(key)
  const s=byKey.get(key)
  if(!s){add("MISSING_CLASS",`Missing stored class ${planned.date} / ${planned.templateId}`);continue}
  if(s.status!=="scheduled" || s.week_number!==planned.week ||
    hhmm(s.start_time)!==hhmm(planned.start) || hhmm(s.end_time)!==hhmm(planned.end) ||
    s.regular_capacity!==planned.regularCapacity)
   add("CLASS_MISMATCH",`Stored timetable/capacity differs for ${planned.date} / ${planned.templateId}`)

  const qualified=enrollments.filter(e=>isEligibleForPlannedClass(e,{
   session_template_id:planned.templateId,class_date:planned.date,week_number:planned.week
  }))
  expectedCount+=qualified.length
  const expectedByStudent=new Map(qualified.map(e=>[e.student_id,e.id]))
  // Above is an enrollment-ID projection: actual bookings must preserve identity.
  const actual=bookingsBySession.get(s.id)??[]
  if(actual.length!==qualified.length) add("CLASS_BOOKING_COUNT",
   `${planned.date} / ${planned.templateId}: stored ${actual.length}, projected ${qualified.length}`)
  const seen=new Set<string>()
  for(const b of actual){
   if(seen.has(b.student_id)) add("DUPLICATE_STUDENT",`Student double-booked in class ${planned.date} / ${planned.templateId}`)
   seen.add(b.student_id)
   if(b.booking_type!=="regular"||b.attendance_status!=="upcoming")
    add("UNEXPECTED_BOOKING_STATE",`Booking state/type has changed in ${planned.date} / ${planned.templateId}`)
   if(!expectedByStudent.has(b.student_id) ||
      expectedByStudent.get(b.student_id)!==b.enrollment_id)
    add("WRONG_STUDENT_OR_ENROLLMENT",
     `Stored booking ${b.id} does not match projected student/enrollment for ${planned.date}`)
  }
  for(const e of qualified){
   if(!seen.has(e.student_id))add("MISSING_STUDENT",`Missing student enrollment ${e.id} in ${planned.date} / ${planned.templateId}`)
  }
 }
 for(const s of actualSessions)if(!expectedKeys.has(sessionKey(s.session_template_id,s.class_date)))
  add("EXTRA_CLASS",`Extra stored class ${s.class_date} / ${s.session_template_id}`)
 if(actualSessions.length!==expected.length)
  add("CLASS_TOTAL",`Stored ${actualSessions.length} classes; projection ${expected.length}`)
 if(actualBookings.length!==expectedCount)
  add("BOOKING_TOTAL",`Stored ${actualBookings.length} bookings; projection ${expectedCount}`)
 return {
  matching:issues.every(i=>i.kind!=="blocker"),
  expectedClasses:expected.length,actualClasses:actualSessions.length,
  expectedBookings:expectedCount,actualBookings:actualBookings.length,issues,
 }
}
