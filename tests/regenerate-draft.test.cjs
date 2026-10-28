/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert"), fs = require("fs"), path = require("path")
const root = path.join(__dirname, "..")
const read = f => fs.readFileSync(path.join(root, f), "utf8")
const mig = read("supabase/migrations/032_regenerate_draft_schedule.sql")
const actions = read("app/(app)/schedule/actions.ts")
const page = read("app/(app)/schedule/page.tsx")
const importer = read("scripts/refresh-data-from-sources.py")

test("the RPCs are security definer, pinned, admin-only and revoked from anon", () => {
  assert.equal((mig.match(/security definer set search_path=''/g) || []).length, 3)
  assert.equal((mig.match(/Only active admins can rebuild a draft schedule/g) || []).length, 2)
  for (const sig of ["preview_draft_regeneration\\(uuid\\)", "regenerate_draft_schedule\\(uuid,text,boolean\\)"]) {
    assert.match(mig, new RegExp(`revoke all on function public\\.${sig} from public,anon,authenticated`))
    assert.match(mig, new RegExp(`grant execute on function public\\.${sig} to authenticated`))
  }
  assert.match(mig, /revoke all on function public\.draft_regeneration_facts\(uuid\) from public,anon,authenticated/)
  assert.doesNotMatch(mig, /grant execute on function public\.draft_regeneration_facts/)
})
test("only a draft can be rebuilt, and anything real depending on it blocks the rebuild", () => {
  for (const text of ["A locked schedule can never be rebuilt", "only a draft can be rebuilt", "already have attendance",
    "replacement or reschedule booking", "make-up record", "historical replacement reservation", "cancelled or completed"]) {
    assert.ok(mig.includes(text), text)
  }
  assert.match(mig, /This draft cannot be rebuilt/)
})
test("manual work is only lost with an explicit yes and its history is kept", () => {
  assert.match(mig, /coalesce\(p_acknowledge_losses,false\) is not true/)
  assert.match(mig, /Confirm to continue/)
  assert.doesNotMatch(mig, /delete\s+from\s+public\.(draft_schedule_edits|class_seat_allocation_changes|class_replacement_capacity_reviews|makeup_obligations|student_bookings|class_sessions)/i)
})
test("the delete and the generation share one transaction, so a failed generation keeps the old draft", () => {
  const del = mig.indexOf("delete from public.schedule_batches")
  const gen = mig.indexOf("public.generate_monthly_schedule_atomic(")
  assert.ok(del > 0 && gen > del)
  assert.doesNotMatch(mig, /exception\s+when/i)
  assert.match(mig, /select sb\.id,sb\.branch_id,sb\.schedule_month into v_b\s+from public\.schedule_batches sb where sb\.id=p_batch_id for update/)
})
test("the audit table is read-only for clients and protected by RLS", () => {
  assert.match(mig, /alter table public\.schedule_draft_regenerations enable row level security/)
  assert.match(mig, /grant select on public\.schedule_draft_regenerations to authenticated/)
  assert.doesNotMatch(mig, /grant (insert|update|delete)[^;]*schedule_draft_regenerations/i)
  assert.equal((mig.match(/insert into public\.schedule_draft_regenerations/g) || []).length, 1)
})
test("the server action calls only the RPC and needs both a reason and a confirmation", () => {
  assert.match(actions, /rpc\("regenerate_draft_schedule"/)
  assert.match(actions, /confirm_rebuild/)
  assert.match(actions, /acknowledge_losses/)
  assert.doesNotMatch(actions, /\.from\("schedule_batches"\)\s*\.delete/)
})
test("the schedule page previews first, lists blockers and names what would be lost", () => {
  assert.match(page, /rpc\("preview_draft_regeneration"/)
  assert.match(page, /It cannot be rebuilt right now/)
  assert.match(page, /I accept losing/)
  assert.match(page, /If the new draft cannot be built, this one stays as it is/)
})
test("the data refresh importer classifies the new audit table so it does not refuse to run", () => {
  assert.match(importer, /WIPE = \[[^\]]*"schedule_draft_regenerations"/)
})
