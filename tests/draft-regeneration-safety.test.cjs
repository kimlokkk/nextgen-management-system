/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs")
const code=fs.readFileSync("app/(app)/schedule/actions.ts","utf8")
const ui=fs.readFileSync("app/(app)/schedule/page.tsx","utf8")
test("new generation is delegated to atomic RPC with no direct inserts",()=>{
 const generate=code.split("export async function generateSchedule(")[1]
    .split("export async function approveSchedule(")[0]
 assert.match(generate,/\.rpc\(\s*"generate_monthly_schedule_atomic"/)
 assert.ok(!generate.includes(".insert("))
 assert.ok(!generate.includes(".delete("))
})
test("old destructive regen branch and UI checkbox are removed",()=>{
 assert.ok(!code.includes('formData.get("confirm_regenerate")'))
 assert.ok(!ui.includes('name="confirm_regenerate"'))
 assert.ok(!code.includes(".eq(\"id\", existingBatch.id)"))
})
test("Postgres RPC is responsible for all-or-nothing creation",()=>{
 const sql=fs.readFileSync("supabase/migrations/024_atomic_monthly_schedule_generation.sql","utf8")
 assert.match(sql,/security invoker/)
 assert.match(sql,/insert into public.schedule_batches/)
 assert.match(sql,/insert into public.class_sessions/)
 assert.match(sql,/insert into public.student_bookings/)
 assert.ok(!sql.includes("delete from"))
 assert.ok(!sql.includes("exception when"))
})
test("generation requires an active admin",()=>{
 assert.match(code,/Only active admins may generate a schedule/)
})
