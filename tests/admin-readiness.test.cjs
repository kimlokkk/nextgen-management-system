/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript")
const src=fs.readFileSync("lib/admin-readiness.ts","utf8")
const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const m={exports:{}};vm.runInNewContext(code,{module:m,exports:m.exports})
const audit=m.exports.assessReadiness
const fixture=()=>{
 const branch="mt",template="t",student="s",enrollment="e",session="c",batch="b"
 return {
  students:[{id:student,full_name:"Test Student",status:"active"}],
  parents:[{id:"p"}],guardians:[{student_id:student,parent_id:"p"}],
  enrollments:[{id:enrollment,student_id:student,branch_id:branch,programme_id:"pr",default_session_id:template,status:"active"}],
  templates:[{id:template,branch_id:branch,programme_id:"pr"}],
  branches:[{id:branch,name:"MTDC",code:"MTDC"}],
  batches:[{id:batch,branch_id:branch,schedule_month:"2026-10-01",status:"draft"}],
  sessions:[{id:session,schedule_batch_id:batch,branch_id:branch,programme_id:"pr",session_template_id:template,class_date:"2026-10-03",status:"scheduled",regular_capacity:15,replacement_capacity:5}],
  bookings:[{id:"r",class_session_id:session,student_id:student,enrollment_id:enrollment,booking_type:"regular",attendance_status:"upcoming"}],
  october:[],september:[{id:"x",evidence_kind:"regular_roster"},{id:"y",evidence_kind:"legacy_replacement"}]
 }
}
test("audit never pronounces production ready just from clean local data",()=>{
 const r=audit(fixture());assert.equal(r.manual,3)
 assert.equal(r.checks.find(x=>x.id==="november").status,"block")
})
test("Excel legacy plus active yellow counts accurately, but never counts it as attendance",()=>{
 const d=fixture()
 d.october=Array.from({length:6},(_,i)=>({id:"h"+i,target_class_id:"c",review_state:"pending",linked_active_booking_id:null}))
 const r=audit(d)
 assert.equal(r.checks.find(x=>x.id==="capacity").status,"block")
 assert.equal(r.checks.find(x=>x.id==="capacity").count,1)
 assert.match(r.checks.find(x=>x.id==="october-history").description,/6 historical source rows/)
})
test("explicit modern link counts a yellow reservation only once",()=>{
 const d=fixture()
 d.bookings.push({id:"modern",class_session_id:"c",student_id:"s",enrollment_id:"e",booking_type:"replacement",attendance_status:"upcoming"})
 d.october=Array.from({length:5},(_,i)=>({id:"h"+i,target_class_id:"c",review_state:"pending",linked_active_booking_id:i===0?"modern":null}))
 const r=audit(d);assert.equal(r.checks.find(x=>x.id==="capacity").status,"pass")
})
test("broken active enrollment is go-live blocker",()=>{
 const d=fixture();d.enrollments[0].default_session_id="unknown"
 assert.equal(audit(d).checks.find(x=>x.id==="enrollments").status,"block")
})
test("roster import missing is blocker, not false success",()=>{
 const d=fixture();d.september=[]
 assert.equal(audit(d).checks.find(x=>x.id==="september-history").status,"block")
})
