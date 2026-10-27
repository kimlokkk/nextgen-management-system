/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs")
const sql=fs.readFileSync("supabase/migrations/026_protect_profile_privileged_columns.sql","utf8")
const orig=fs.readFileSync("supabase/migrations/003_auth_profiles.sql","utf8")
const ci=fs.readFileSync(".github/workflows/verify.yml","utf8")
const t=fs.readFileSync("tests/sql/profile_role_protection.sql","utf8")
test("premise: 003 still has an unrestricted own-row UPDATE policy (the reason 026 exists)",()=>{
 assert.match(orig,/Users can update own profile/)
})
test("026 limits client UPDATE to full_name and removes insert/delete from clients",()=>{
 assert.match(sql,/revoke all on table public\.profiles from anon/)
 assert.match(sql,/revoke insert, update, delete[^;]*on table public\.profiles from authenticated/)
 assert.match(sql,/grant update \(full_name\) on table public\.profiles to authenticated/)
 assert.ok(!/grant update \([^)]*\b(role|is_active|id)\b/.test(sql),"026 must never grant UPDATE on role/is_active/id")
})
test("026 adds a trigger layer that blocks id/role/is_active changes by client roles",()=>{
 assert.match(sql,/current_user in \('anon', 'authenticated'\)/)
 assert.match(sql,/new\.role is distinct from old\.role/)
 assert.match(sql,/new\.is_active is distinct from old\.is_active/)
 assert.match(sql,/before update on public\.profiles/)
})
test("SQL test proves the vulnerability first, then the fix, then both layers",()=>{
 for (const marker of ["PHASE A","PHASE B","PHASE C","PHASE D","PHASE E"]) assert.ok(t.includes(marker),marker)
})
test("CI runs the isolated profile role protection test",()=>{
 assert.match(ci,/profile-role-protection:/)
 assert.match(ci,/tests\/sql\/profile_role_protection\.sql/)
 assert.match(ci,/tests\/profile-role-protection\.test\.cjs/)
})
