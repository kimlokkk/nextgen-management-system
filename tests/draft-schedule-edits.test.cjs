/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert"), fs = require("fs"), path = require("path")
const root = path.join(__dirname, "..")
const read = f => fs.readFileSync(path.join(root, f), "utf8")
const mig = read("supabase/migrations/029_draft_schedule_edits.sql")
const actions = read("app/(app)/schedule/sessions/[id]/edit-actions.ts")
const scheduleActions = read("app/(app)/schedule/actions.ts")
const validation = read("lib/schedule-validation.ts")
const classPage = read("app/(app)/schedule/sessions/[id]/page.tsx")
const fns = ["move_student_in_draft", "remove_student_from_draft_class", "add_student_to_draft_class", "reopen_schedule_draft"]

test("every draft-edit RPC is security definer, pinned, admin-only and revoked from anon", () => {
  assert.equal((mig.match(/security definer set search_path=''/g) || []).length, 4)
  assert.equal((mig.match(/Only active admins can (edit a draft schedule|reopen a schedule)/g) || []).length, 4)
  for (const f of fns) {
    assert.match(mig, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public,anon,authenticated`), f)
    assert.match(mig, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to authenticated`), f)
  }
})
test("edits only work on a draft month and always leave an audit row with a reason", () => {
  assert.ok((mig.match(/Only a draft schedule can be edited/g) || []).length >= 3)
  assert.equal((mig.match(/Explain the change in 10 to 500 characters/g) || []).length, 4)
  assert.equal((mig.match(/insert into public\.draft_schedule_edits/g) || []).length, 4)
  assert.match(mig, /A locked schedule cannot be reopened/)
  assert.match(mig, /Only an approved schedule can be sent back to draft/)
})
test("edits never change enrollments, obligations, attendance or calendar", () => {
  assert.doesNotMatch(mig, /update\s+public\.enrollments|delete\s+from\s+public\.(enrollments|makeup_obligations|students|class_sessions)/i)
  assert.doesNotMatch(mig, /insert into public\.makeup_obligations|attendance_status\s*=\s*'present'/i)
  assert.match(mig, /already has a follow-up/)
})
test("capacity, overlap, programme and enrollment-window rules are enforced in the database", () => {
  assert.match(mig, /same programme and branch/)
  assert.match(mig, /overlapping class on that date/)
  assert.match(mig, /is full \(%\/%\)/)
  assert.match(mig, /enrollment is not active on the target date/)
})
test("the audit table is read-only for clients and protected by RLS", () => {
  assert.match(mig, /alter table public\.draft_schedule_edits enable row level security/)
  assert.match(mig, /revoke all on public\.draft_schedule_edits from public, anon, authenticated/)
  assert.match(mig, /grant select on public\.draft_schedule_edits to authenticated/)
  assert.doesNotMatch(mig, /grant (insert|update|delete)[^;]*draft_schedule_edits/i)
})
test("server actions call only the RPCs and never write bookings directly", () => {
  for (const f of ["move_student_in_draft", "remove_student_from_draft_class", "add_student_to_draft_class"]) assert.match(actions, new RegExp(`rpc\\("${f}"`))
  assert.match(scheduleActions, /rpc\("reopen_schedule_draft"/)
  assert.doesNotMatch(actions, /\.from\("student_bookings"\)\s*\.(insert|update|delete)/)
  assert.match(actions, /confirm_remove/)
  assert.match(scheduleActions, /confirm_reopen/)
})
test("approval validation accepts admin-placed bookings but still checks everything else", () => {
  assert.match(validation, /!booking\.manually_placed\s*&&\s*enrollment\.default_session_id/)
  assert.match(validation, /regular capacity exceeded/)
  assert.match(validation, /has overlapping classes/)
  assert.match(validation, /enrollment has not started/)
})
test("the class page shows edit tools only for a draft month", () => {
  assert.match(classPage, /const canEditDraft = canAdjustDraftCapacity/)
  assert.match(classPage, /canEditDraft && isRegular && !hasActiveObligation/)
  assert.match(classPage, /Placed manually/)
})
