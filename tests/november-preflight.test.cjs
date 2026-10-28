/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"), assert=require("node:assert/strict")
const fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript")
const compile=(path)=>ts.transpileModule(fs.readFileSync(path,"utf8"),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
}).outputText
const sched={exports:{}}
vm.runInNewContext(compile("lib/scheduling.ts"),{exports:sched.exports,module:sched,Date,Map,Set,Number,String})
const mod={exports:{}}
vm.runInNewContext(compile("lib/november-preflight.ts"),{
 exports:mod.exports,module:mod,
 require:(p)=>{if(p==="@/lib/scheduling")return sched.exports;throw Error(p)},
 Date,Map,Set,Number,String
})
const {buildNovemberPreflight,isEligibleForPlannedClass}=mod.exports
const data=()=>({
 templates:[{id:"t1",branch_id:"mtdc",programme_id:"jr",day_of_week:6,start_time:"09:00",
  end_time:"10:30",regular_capacity:2,replacement_capacity:5}],
 enrollments:[{id:"e1",student_id:"s1",branch_id:"mtdc",programme_id:"jr",
  default_session_id:"t1",frequency_type:"weekly",preferred_weeks:null,
  start_date:"2026-10-01",end_date:null,status:"active"}],
 students:[{id:"s1",status:"active"}],calendar:[],existingBatch:null,
})
test("November Saturday has four teaching lessons by existing generator",()=>{
 const p=buildNovemberPreflight(data())
 assert.equal(p.classCount,4);assert.equal(p.expectedBookings,4)
 assert.equal(p.canGenerateNewDraft,true)
 assert.equal(p.classes[0].date,"2026-11-07")
})
test("monthly week preference and start/end dates are respected",()=>{
 const e={...data().enrollments[0],frequency_type:"twice_monthly",
  preferred_weeks:[1,3],start_date:"2026-11-10"}
 assert.equal(isEligibleForPlannedClass(e,{
  session_template_id:"t1",class_date:"2026-11-07",week_number:1}),false)
 const d=data();d.enrollments=[e]
 const p=buildNovemberPreflight(d)
 assert.equal(p.expectedBookings,1)
})
test("capacity cannot be treated as ready when exceed regular seats",()=>{
 const d=data()
 d.enrollments.push({...d.enrollments[0],id:"e2",student_id:"s2"})
 d.enrollments.push({...d.enrollments[0],id:"e3",student_id:"s3"})
 d.students.push({id:"s2",status:"active"},{id:"s3",status:"active"})
 const p=buildNovemberPreflight(d)
 assert.equal(p.overloadedClasses,4);assert.equal(p.canGenerateNewDraft,false)
})
test("pending calendar date blocks November preflight",()=>{
 const d=data();d.calendar=[{closed_on:"2026-11-07",decision:"pending",target_on:null}]
 const p=buildNovemberPreflight(d)
 assert.equal(p.canGenerateNewDraft,false)
 assert.equal(p.issues.some(i=>i.code==="ACADEMIC_CALENDAR"),true)
})
test("never recommend generating over an existing draft",()=>{
 const d=data();d.existingBatch={id:"b",status:"draft"}
 const p=buildNovemberPreflight(d)
 assert.equal(p.canGenerateNewDraft,false)
 assert.equal(p.issues.some(i=>i.code==="BATCH_EXISTS"),true)
})
test("duplicate enrollment for same student in same slot is blocker",()=>{
 const d=data();d.enrollments.push({...d.enrollments[0],id:"e2"})
 const p=buildNovemberPreflight(d)
 assert.equal(p.issues.some(i=>i.code==="DOUBLE_BOOKED_STUDENT"),true)
})
test("guardian issue elsewhere never invents bookings or alters enrollment",()=>{
 const d=data();const before=JSON.stringify(d)
 buildNovemberPreflight(d);assert.equal(JSON.stringify(d),before)
})
