/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs")
const code=fs.readFileSync("app/(app)/schedule/sessions/[id]/actions.ts","utf8")
const sql=fs.readFileSync("supabase/migrations/025_atomic_reschedule_initiation.sql","utf8")
const ci=fs.readFileSync(".github/workflows/verify.yml","utf8")
const lifeActions=fs.readFileSync("app/(app)/reschedules/[id]/actions.ts","utf8")
const life=fs.readFileSync("supabase/migrations/027_atomic_reschedule_lifecycle.sql","utf8")
const action=code.split("export async function markForReschedule(")[1]
    .split("export async function initiateReplacement(")[0]

test("markForReschedule delegates to the atomic RPC with no direct table access",()=>{
 assert.match(action,/\.rpc\(\s*"initiate_reschedule_obligation"/)
 for (const forbidden of [".insert(",".update(",".delete(",".upsert(",".from("]) {
  assert.ok(!action.includes(forbidden),`markForReschedule must not call ${forbidden}`)
 }
})
test("no best-effort compensating cleanup remains in the session actions file",()=>{
 assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(code))
})
test("RPC locks the booking and keeps obligation + booking writes in one function",()=>{
 assert.match(sql,/for update/)
 assert.match(sql,/insert into public\.makeup_obligations/)
 assert.match(sql,/update public\.student_bookings/)
 assert.match(sql,/get diagnostics v_rows = row_count/)
 assert.ok(!/exception\s+when/i.test(sql),"RPC must not swallow errors; failure must roll back everything")
 assert.ok(!/delete from/i.test(sql))
})
test("RPC is admin-only, pinned search_path, not executable by anon/PUBLIC",()=>{
 assert.match(sql,/security definer/)
 assert.match(sql,/set search_path = ''/)
 assert.match(sql,/p\.role in \('admin', 'super_admin'\)/)
 assert.match(sql,/revoke all on function public\.initiate_reschedule_obligation\(uuid, uuid\)\s*from public, anon/)
 assert.match(sql,/grant execute on function public\.initiate_reschedule_obligation\(uuid, uuid\)\s*to authenticated/)
})
test("CI runs the isolated reschedule integration test",()=>{
 assert.match(ci,/atomic-reschedule-integration:/)
 assert.match(ci,/tests\/sql\/atomic_reschedule_initiation\.sql/)
 assert.match(ci,/tests\/reschedule-atomicity\.test\.cjs/)
})

test("assign / reopen / cancel delegate to atomic RPCs with no direct table access",()=>{
 for (const rpc of ["assign_reschedule_slot","reopen_reschedule_assignment","cancel_reschedule"]) {
  assert.match(lifeActions,new RegExp('\\.rpc\\(\\s*"'+rpc+'"'))
 }
 for (const forbidden of [".insert(",".update(",".delete(",".upsert(",".from("]) {
  assert.ok(!lifeActions.includes(forbidden),`reschedule lifecycle actions must not call ${forbidden}`)
 }
})
test("027 locks the class row whose capacity changes and never swallows errors",()=>{
 assert.match(life,/where c\.id = p_target_session_id\s+for update;/,"assign must lock the target class")
 assert.match(life,/where c\.id = v_src\.class_session_id\s+for update;/,"cancel must lock the original class")
 assert.ok(!/exception\s+when/i.test(life),"027 must not swallow errors; failure must roll back everything")
 assert.ok(!/delete from public\.(makeup_obligations|class_sessions)/i.test(life))
})
test("027 functions are admin-only, search_path pinned, closed to anon/PUBLIC",()=>{
 assert.equal((life.match(/security definer/g)||[]).length,3)
 assert.equal((life.match(/set search_path = ''/g)||[]).length,3)
 assert.equal((life.match(/p\.role in \('admin', 'super_admin'\)/g)||[]).length,3)
 for (const sig of ["assign_reschedule_slot(uuid, uuid)","reopen_reschedule_assignment(uuid)","cancel_reschedule(uuid)"]) {
  assert.ok(life.includes("revoke all on function public."+sig+" from public, anon;"),sig)
  assert.ok(life.includes("grant execute on function public."+sig+" to authenticated;"),sig)
 }
})
test("CI runs the isolated reschedule lifecycle test",()=>{
 assert.match(ci,/supabase\/migrations\/027_atomic_reschedule_lifecycle\.sql/)
 assert.match(ci,/tests\/sql\/atomic_reschedule_lifecycle\.sql/)
})
