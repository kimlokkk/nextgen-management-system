/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert"), fs = require("fs"), path = require("path")
const root = path.join(__dirname, "..")
const read = f => fs.readFileSync(path.join(root, f), "utf8")
const mig = read("supabase/migrations/030_class_seat_reallocation.sql")
const action = read("app/(app)/schedule/sessions/[id]/seat-actions.ts")
const page = read("app/(app)/schedule/sessions/[id]/page.tsx")
const importer = read("scripts/refresh-data-from-sources.py")
const fn = "reallocate_class_seats"

test("the RPC is security definer, pinned, admin-only and not executable by anon", () => {
  assert.match(mig, /language plpgsql security definer set search_path=''/)
  assert.match(mig, /Only active admins can change class seat allocation/)
  assert.match(mig, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public,anon,authenticated`))
  assert.match(mig, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`))
})
test("the class total can never change, and the database also enforces it on the audit row", () => {
  assert.match(mig, /The class total must stay %/)
  assert.match(mig, /check \(old_regular \+ old_replacement = new_regular \+ new_replacement\)/)
})
test("seats already booked or reserved are a floor, counted the same way as the rest of the app", () => {
  assert.match(mig, /Regular seats cannot go below the %/)
  assert.match(mig, /Replacement seats cannot go below the %/)
  assert.match(mig, /legacy_reserved_yellow_seats\(v_class\.id\)/)
  assert.match(mig, /booking_type in \('regular','reschedule'\)/)
  assert.match(mig, /attendance_status not in \('rescheduled','cancelled','not_scheduled'\)/)
})
test("approved and locked months need a source reference, and stale or empty changes are refused", () => {
  assert.match(mig, /batch_status = 'draft' or source_ref is not null/)
  assert.match(mig, /Give the source reference/)
  assert.match(mig, /Seats changed since page load/)
  assert.match(mig, /matches the current one/)
  assert.match(mig, /Explain the change in 10 to 500 characters/)
})
test("only seat limits and the audit row are written; bookings, attendance, obligations and enrollments are never touched", () => {
  assert.doesNotMatch(mig, /(insert\s+into|update|delete\s+from)\s+public\.(student_bookings|makeup_obligations|enrollments|students|session_templates|legacy_replacement_reviews)/i)
  assert.equal((mig.match(/update public\.class_sessions/g) || []).length, 1)
  assert.equal((mig.match(/insert into public\.class_seat_allocation_changes/g) || []).length, 1)
  assert.doesNotMatch(mig, /\binsert into public\.(?!class_seat_allocation_changes)/i)
})
test("the audit table is read-only for clients and protected by RLS", () => {
  assert.match(mig, /alter table public\.class_seat_allocation_changes enable row level security/)
  assert.match(mig, /revoke all on public\.class_seat_allocation_changes from public, anon, authenticated/)
  assert.match(mig, /grant select on public\.class_seat_allocation_changes to authenticated/)
  assert.doesNotMatch(mig, /grant (insert|update|delete)[^;]*class_seat_allocation_changes/i)
})
test("the server action derives replacement from the total and only calls the RPC", () => {
  assert.match(action, /rpc\("reallocate_class_seats"/)
  assert.match(action, /p_new_replacement: total - data\.newRegular/)
  assert.doesNotMatch(action, /\.from\("class_sessions"\)\s*\.(insert|update|delete)/)
})
test("the class page offers the panel to admins on any month, in plain wording", () => {
  assert.match(page, /import \{ reallocateClassSeats \} from "\.\/seat-actions"/)
  assert.match(page, /Change seats · this class only/)
  assert.match(page, /canReadLegacy && session\.status === "scheduled"/)
  assert.match(page, /The total stays/)
})
test("the data refresh importer classifies the new audit table so it does not refuse to run", () => {
  assert.match(importer, /WIPE = \["class_seat_allocation_changes"/)
})
