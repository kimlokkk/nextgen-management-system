/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript")
const m={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync("lib/schedule-transition-policy.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:m.exports,module:m})
const f=m.exports.validateScheduleTransition
test("human approval requires valid draft and acknowledgement",()=>{
 assert.equal(f("draft","approve",true,true),null)
 assert.match(f("draft","approve",true,false),/Confirm/)
 assert.match(f("draft","approve",false,true),/blocking/)
 assert.match(f("approved","approve",true,true),/Only draft/)
})
test("locking requires approved status and second acknowledgement",()=>{
 assert.equal(f("approved","lock",true,true),null)
 assert.match(f("draft","lock",true,true),/Only approved/)
 assert.match(f("approved","lock",true,false),/Confirm/)
 assert.match(f("locked","lock",true,true),/Only approved/)
})
test("actions call policy and compare-and-set approval checks returned row",()=>{
 const a=fs.readFileSync("app/(app)/schedule/actions.ts","utf8")
 const approve=a.split("export async function approveSchedule(")[1].split("export async function lockSchedule(")[0]
 const lock=a.split("export async function lockSchedule(")[1]
 assert.match(approve,/validateScheduleTransition\(/)
 assert.match(lock,/validateScheduleTransition\(/)
 assert.match(approve,/\.select\("id"\)\s*\.maybeSingle\(\)/)
 assert.match(approve,/if \(!approvedBatch\)/)
 assert.match(lock,/if \(!lockedBatch\)/)
})
