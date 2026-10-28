/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert"), fs = require("fs"), path = require("path")
const root = path.join(__dirname, "..")
const read = f => fs.readFileSync(path.join(root, f), "utf8")
const mig = read("supabase/migrations/028_guardian_link_with_new_parent.sql")
const action = read("app/(app)/readiness/guardians/actions.ts")
test("new-parent RPC is security definer, pinned search_path, admin-only and not callable by anon", () => {
  assert.match(mig, /security definer set search_path=''/)
  assert.match(mig, /Only active admins can link guardians/)
  assert.match(mig, /revoke all on function public\.resolve_missing_student_guardian_new_parent[\s\S]*from public,anon,authenticated/)
  assert.match(mig, /grant execute on function public\.resolve_missing_student_guardian_new_parent[\s\S]*to authenticated/)
})
test("parent creation and link happen in one RPC (no separate client-side insert)", () => {
  assert.match(mig, /insert into public\.parents[\s\S]*resolve_missing_student_guardian\(/)
  const fn = action.slice(action.indexOf("resolveGuardianLinkNewParent"))
  assert.match(fn, /rpc\("resolve_missing_student_guardian_new_parent"/)
  assert.doesNotMatch(fn, /from\("parents"\)\.insert/)
})
test("the audited rules stay: confirmation, evidence and relationship are required for both paths", () => {
  assert.match(action, /confirmed: z\.literal\("yes"\)/)
  assert.equal((action.match(/evidenceReference: z\.string\(\)\.trim\(\)\.min\(10\)/g) || []).length, 2)
  assert.equal((action.match(/relationship: z\.enum\(\["father","mother","guardian"\]\)/g) || []).length, 2)
})
