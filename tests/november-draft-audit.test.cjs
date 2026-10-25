/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"), assert=require("node:assert/strict")
const fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript")
const load=(path,requires={})=>{
 const m={exports:{}}
 const code=ts.transpileModule(fs.readFileSync(path,"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
 }).outputText
 vm.runInNewContext(code,{module:m,exports:m.exports,require:p=>requires[p],Date,Map,Set,Number,String})
 return m.exports
}
const s=load("lib/scheduling.ts")
const p=load("lib/november-preflight.ts",{"@/lib/scheduling":s})
const {auditNovemberStoredDraft:audit}=load("lib/november-draft-audit.ts",{"@/lib/november-preflight":p})
function fixture(){
 const expected=[{templateId:"t",date:"2026-11-07",week:1,start:"09:00",end:"10:30",
  regularCapacity:15,expectedRegular:1}]
 const enrollments=[{id:"e",student_id:"s",branch_id:"b",programme_id:"p",status:"active",
  default_session_id:"t",start_date:"2026-09-01",end_date:null,frequency_type:"weekly"}]
 const sessions=[{id:"c",session_template_id:"t",class_date:"2026-11-07",week_number:1,
  start_time:"09:00:00",end_time:"10:30:00",regular_capacity:15,replacement_capacity:5,status:"scheduled"}]
 const bookings=[{id:"bk",class_session_id:"c",student_id:"s",enrollment_id:"e",booking_type:"regular",attendance_status:"upcoming"}]
 return {expected,enrollments,sessions,bookings}
}
test("exact class and student/enrollment match passes",()=>{
 const d=fixture();const r=audit(d.expected,d.enrollments,d.sessions,d.bookings)
 assert.equal(r.matching,true);assert.equal(r.expectedBookings,1)
})
test("same totals but wrong student fails",()=>{
 const d=fixture();d.bookings[0].student_id="other"
 const r=audit(d.expected,d.enrollments,d.sessions,d.bookings)
 assert.equal(r.matching,false);assert.equal(r.issues.some(x=>x.code==="WRONG_STUDENT_OR_ENROLLMENT"),true)
})
test("same totals but wrong enrollment fails",()=>{
 const d=fixture();d.bookings[0].enrollment_id="other"
 assert.equal(audit(d.expected,d.enrollments,d.sessions,d.bookings).matching,false)
})
test("missing booking fails",()=>{
 const d=fixture();d.bookings=[]
 assert.equal(audit(d.expected,d.enrollments,d.sessions,d.bookings).matching,false)
})
test("duplicate class fails",()=>{
 const d=fixture();d.sessions.push({...d.sessions[0],id:"c2"})
 assert.equal(audit(d.expected,d.enrollments,d.sessions,d.bookings).matching,false)
})
test("class time drift fails",()=>{
 const d=fixture();d.sessions[0].start_time="09:30:00"
 assert.equal(audit(d.expected,d.enrollments,d.sessions,d.bookings).matching,false)
})
test("preview does not mutate any source",()=>{
 const d=fixture();const before=JSON.stringify(d)
 audit(d.expected,d.enrollments,d.sessions,d.bookings)
 assert.equal(JSON.stringify(d),before)
})
