
/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict")
const fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript")
const src=fs.readFileSync("lib/september-reconciliation.ts","utf8")
const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const m={exports:{}};vm.runInNewContext(code,{module:m,exports:m.exports})
const compare=m.exports.compareSeptemberEvidence
const e=(o={})=>({
 source_ref:"FIXTURE-01",source_tab:"TEST",source_row:1,evidence_kind:"regular_roster",
 student_name:"AMIR SAMPLE BIN TEST",class_date:"2026-09-05",start_time:"09:00",
 end_time:"10:30",space_label:"ROOM",course:"DIY",module_raw:"",
 attendance_raw:"",original_date:null,...o
})
test("exact name and date is only a roster candidate",()=>{
 const r=compare(" Amir Sample Bin Test ","2026-09-05",[e()])
 assert.equal(r.roster.length,1);assert.equal(Object.hasOwn(r,"entitlement"),false)
})
test("short name requires identity review",()=>{
 const r=compare("AMIR SAMPLE","2026-09-05",[e()])
 assert.equal(r.roster.length,0);assert.equal(r.possibleNameVariation.length,1)
})
test("different class date does not count",()=>{
 assert.equal(compare("AMIR SAMPLE BIN TEST","2026-09-19",[e()]).roster.length,0)
})
test("replacement record cannot stand for regular class/earned entitlement",()=>{
 const r=compare("AMIR SAMPLE BIN TEST","2026-09-05",[e({
 evidence_kind:"legacy_replacement",original_date:"2026-09-05",
 class_date:"2026-09-12",attendance_raw:"/"
 })])
 assert.equal(r.roster.length,0);assert.equal(r.sameOriginReplacement.length,1)
})
test("other months are ignored",()=>{
 assert.equal(compare("AMIR SAMPLE BIN TEST","2026-08-05",[e()]).roster.length,0)
})
