/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert"), fs = require("fs"), path = require("path")
const root = path.join(__dirname, "..")
const read = f => fs.readFileSync(path.join(root, f), "utf8")
const mig = read("supabase/migrations/031_enrollment_changes.sql")
const actions = read("app/(app)/enrollments/actions.ts")
const page = read("app/(app)/enrollments/page.tsx")
const rowActions = read("components/enrollment-row-actions.tsx")
const importer = read("scripts/refresh-data-from-sources.py")
const rpcs = [
  ["create_enrollment", "uuid,uuid,text,smallint\\[\\],date"],
  ["change_enrollment", "uuid,date,uuid,text,smallint\\[\\],text"],
  ["set_enrollment_status", "uuid,text,date,text"],
]

test("the three RPCs are security definer, pinned, admin-only and revoked from anon", () => {
  assert.equal((mig.match(/language plpgsql security definer set search_path=''/g) || []).length, 3)
  assert.match(mig, /language plpgsql stable security definer set search_path=''/) // the conflict helper
  assert.equal((mig.match(/Only active admins can (add|change) enrollments/g) || []).length, 3)
  for (const [f, sig] of rpcs) {
    assert.match(mig, new RegExp(`revoke all on function public\\.${f}\\(${sig}\\) from public,anon,authenticated`), f)
    assert.match(mig, new RegExp(`grant execute on function public\\.${f}\\(${sig}\\) to authenticated`), f)
  }
})
test("the helpers cannot be called by clients", () => {
  assert.match(mig, /revoke all on function public\.normalize_enrollment_weeks\(text,smallint\[\]\) from public,anon,authenticated/)
  assert.match(mig, /revoke all on function public\.enrollment_schedule_conflict\(uuid,uuid,text,smallint\[\],date,date,uuid\) from public,anon,authenticated/)
  assert.doesNotMatch(mig, /grant execute on function public\.(normalize_enrollment_weeks|enrollment_schedule_conflict)/)
})
test("clients cannot write enrollments directly, but keep the UPDATE the schedule generator's FOR SHARE lock needs", () => {
  assert.match(mig, /revoke insert, update, delete on public\.enrollments from public, anon, authenticated/)
  assert.match(mig, /grant update \(updated_at\) on public\.enrollments to authenticated/)
  assert.doesNotMatch(mig, /grant (insert|delete)[^;]*on public\.enrollments/i)
})
test("frequency, weeks and overlap rules live in the database", () => {
  assert.match(mig, /Twice monthly needs exactly two teaching weeks/)
  assert.match(mig, /A weekly enrollment does not use preferred weeks/)
  assert.match(mig, /Choose teaching weeks from 1 to 4/)
  assert.match(mig, /r\.start_time < v_t\.end_time and v_t\.start_time < r\.end_time/)
  assert.match(mig, /overlapping time on the same day in the same week/)
})
test("a change from a date closes the old row and opens a new one, so old bookings keep their enrollment", () => {
  assert.match(mig, /set end_date=p_effective_from-1/)
  assert.match(mig, /v_mode := 'split'/)
  assert.match(mig, /This enrollment already has bookings\. Choose a date after its start date/)
  assert.match(mig, /v_mode := 'in_place'/)
  assert.doesNotMatch(mig, /(update|delete\s+from)\s+public\.(student_bookings|class_sessions|schedule_batches|makeup_obligations)/i)
})
test("stopped enrollments are final and every change leaves an audit row", () => {
  assert.match(mig, /A stopped enrollment cannot be changed/)
  assert.equal((mig.match(/insert into public\.enrollment_changes/g) || []).length, 3)
  assert.match(mig, /alter table public\.enrollment_changes enable row level security/)
  assert.match(mig, /grant select on public\.enrollment_changes to authenticated/)
  assert.doesNotMatch(mig, /grant (insert|update|delete)[^;]*enrollment_changes/i)
})
test("server actions call only the RPCs and never write enrollments directly", () => {
  for (const f of ["create_enrollment", "change_enrollment", "set_enrollment_status"]) assert.match(actions, new RegExp(`rpc\\("${f}"`))
  assert.doesNotMatch(actions, /\.from\("enrollments"\)\s*\.(insert|update|delete)/)
  assert.match(actions, /confirm_stop/)
})
test("the page offers change, pause and stop in plain wording and says existing schedules are not changed", () => {
  assert.match(page, /EnrollmentRowActions/)
  assert.match(rowActions, /Change this enrollment/)
  assert.match(rowActions, /Schedules that were already generated are not changed/)
  assert.match(rowActions, /A stopped enrollment cannot be resumed/)
})
test("the data refresh importer classifies the new audit table so it does not refuse to run", () => {
  assert.match(importer, /WIPE = \[[^\]]*"enrollment_changes"/)
})
