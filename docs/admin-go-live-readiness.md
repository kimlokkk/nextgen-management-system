# NextGen Admin Go-live: local audit and release gates

The `/readiness` route is read-only and restricted to active admin/super_admin accounts. It checks student data, links, September–October evidence, class occupancy and November draft readiness. It does NOT certify production. All counts are queried live from the environment serving NextGen with paginated authenticated requests (no service-role bypass).

## Why pilot is currently blocked
- Historical September/October data are in Supabase Local and are not automatically present in cloud production.
- Five October yellow-seat exceptions have been observed in MTDC staging. Their real capacity decisions require operational verification; do not auto-approve or invent attendance.
- November needs a deliberate draft review/approval, with calendar and student enrollment verification.
- Production backup/restore, admin user permissions, signed-off import and end-to-end UAT remain manual requirements.
- Draft regeneration is disabled (generation is atomic and refuses any existing batch). There is currently no admin 'discard draft and regenerate' action; a wrong draft can only be corrected with the draft edit tools (move/add/remove, or send back to draft).

## Release gates (human acceptance)
1. Compare actual directory and enrollment totals with signed-off MTDC/Cyberjaya sources; resolve invalid links without deleting history.
2. Resolve blocking capacity exceptions with the admin capacity decision workflow; historical unknowns may stay pending with documented ownership.
3. Run one complete November workflow on disposable staging: generate, approve, lock, attendance, reschedule/replacement; verify missing and duplicate inputs.
4. Define backup and *tested restore*, user authorization, hosting secrets, monitoring, and rollback plan.
5. Transfer private baseline data to production using explicit approved migration/cutover; never push spreadsheets or student names to GitHub.
6. Obtain real admin sign-off for the pilot before treating NextGen as the operational system.

No migrations or data writes are added by this audit screen.

## Historical source decisions (migration 022, local only)
- Independent, audited state per October legacy source: needs investigation, source correlated (unverified), or identity + original date source checked. A source check must cite specific independent evidence, have explicit identity and date confirmation, and pass chronology checks.
- Source checks do **not** confer replacement entitlement, approve attendance, release Excel yellow reservations or approve five overcapacity sessions. The older review_state/evidence_received workflow remains separate.
- The readiness page reports evidence import and human reconciliation as two different checks. A successful import is NOT a passed reconciliation.
- Only migration 022 and the isolated fixture SQL integration test need to be applied to local staging; do not run on the cloud project until launch review. No real MTDC records are changed by the migration.

## Evidence reference selection UX
- On historical September matching roster rows, admin can click **Use this reference** to populate the linked decision form with the exact source sheet, row and class date.
- Choosing a reference **does not submit** the form, tick either verification checkbox, approve an entitlement, or change attendance/seat reservations.
- Form text stays editable if operations has additional documentary references; users must still explicitly review and submit a decision.

## Missing guardian links (migration 023; local only)
- The admin readiness Guardian link check opens `/readiness/guardians`, showing active students with no relationship entries.
- Admin selects an existing parent after independently verifying the relationship, states father/mother/guardian and records the source. Surname/phone alone is not verification.
- The guardian RPC locks the student, validates actor, parent and relationship, and inserts the new primary guardian link and audit entry atomically. It cannot change existing links, enrollments, bookings or attendance.
- Apply 023 to **Supabase Local** only. Do not apply to cloud production prior to cutover review. No private data or parent names are included in the migration or tests.

## November 2026 MTDC preflight (read-only; no migration)
- `/readiness/november` previews November class sessions through the existing `generateClassSessions` engine and the current frequency/start/end enrollment rules.
- Queries local active templates, active MTDC enrollments, student status, calendar decisions and existing November batch; simulates expected class/regular booking counts without any writes.
- Shows structural blockers: missing templates, inactive/missing students, frequency configurations with no W1–W4, calendar errors, duplicate student enrollment in a slot, and regular capacity overflow. Also explicitly blocks recommending regeneration if ANY November batch already exists (existing `generateSchedule` deletes prior draft before rewriting).
- Review this before any November generation. Even a clean preview does not verify actual attendance, replacements, facilitator capacity, annual closures, billing or production readiness.
- No guardian confirmation is guessed or required for class simulation. Hadi's unknown guardian remains a separate admin-source dependency.

## Draft recreation safety gate
- Schedule generation now refuses any existing branch/month batch, even a draft. The destructive `confirm_regenerate` and old delete/recreate branch have been removed; a unique database constraint still prevents concurrent duplicate batch creation.
- A new-batch failure attempts cleanup and surfaces a prominent warning if cleanup itself fails. New-batch creation is still multi-request and must become transactionally atomic before unrestricted production release.
- Data in earlier months is never regenerated. In particular, October's legacy sessions/attendance remain outside the new November flow.

## November postgeneration draft audit
- `/readiness/november` now separately audits the SAVED class sessions and regular student bookings against the fresh enrollment-based forecast, including class dates/times, enrollment identity, booking state and duplicates.
- A clean overall total alone is not sufficient: two changed student IDs are a blocker even when class and booking totals still match.
- The report never approves, locks, regenerates or changes attendance. Production release requires witnessed UAT and a snapshot/cutover strategy; the current comparison uses today's enrollment records and can fail after legitimate future changes.

## UAT / approval release gates
- `/readiness/uat` is a read-only admin checklist; its six items remain pending until an actual admin witnesses them.
- The schedule approval form now demands a dated human decision outside the app: explicit confirmation that class dates, capacity and facilitator arrangements were checked. The server enforces this acknowledgement.
- Lock has a separate confirmation, independently validated by the server. A blank form, stale status, failed validation or lack of admin rights cannot move state.
- Approval now requires the compare-and-set update to return a row; a no-op/race must never be reported as successful.
- Run disruptive attendance/replacement UAT only on an isolated database with fake fixtures. Future November attendance cannot be tested by forcing actual records into the past.
- These changes do not approve or lock the real MTDC November schedule, resolve the Hadi Ayyash guardian source, clear the October capacity exceptions, transfer local data into cloud, or certify backup/restore.

## Disposable operations smoke UAT CI (no local migration; no MTDC data touched)
- Separate GitHub Actions `operational-uat-smoke` job spins up ephemeral PostgreSQL, applies current replacement + attendance RPCs, uses `tests/sql/replacement_fixture.sql`, then runs `tests/sql/uat_operational_journey.sql`.
- It checks future attendance rejection; no duplicate entitlement; yellow-seat capacity; moving seats without creating a new booking ID; release and cancel; attending a completed replacement; rescheduled original preserved while attended makeup completes; regular absence/correction; and non-admin RPC denial.
- **This is not a browser UAT or authorization to operate real November**. All human sign-offs remain pending. It does not create/reset local databases, does not touch cloud Supabase and never reads imported student PII.

## Atomic monthly schedule generation (migration 024) — supersedes earlier cleanup path

- `generateSchedule` now calls only `public.generate_monthly_schedule_atomic(branch_id, first_day_of_month)`, instead of separate insert requests for batch/classes/bookings followed by best-effort cleanup.
- A single **SECURITY INVOKER** PostgreSQL RPC checks the active admin, active branch, existing batch, active templates, eligible enrollment/student relationships, Academic Calendar move/skip/pending decisions, duplicate student assignments, and regular capacity; then inserts the batch, first four teaching weeks, and regular bookings in the **same DB transaction**.
- Database RLS still applies. Existing draft/approved/locked batches **cannot** be regenerated, and previous months are never deleted. Postgres uniqueness is the final concurrency safeguard.
- Any error, including an injected failure after the *second booking*, rolls back **all** writes. CI job `Atomic schedule rollback and security` verifies successful generation, moved/skipped calendar weeks, duplicates, overcapacity, non-admin/inactive-admin denial, and forced rollback on **synthetic** data in isolated PostgreSQL.
- Earlier sections referring to delete-and-recreate or non-transactional new-draft cleanup describe the **old** generator, not current branch behavior.
- No extra data migration or import is performed by 024. Apply it in **Supabase Local** only first. (Superseded 2026-10-28: the local November draft no longer exists after the data refresh; the admin generates it when ready. Once a draft exists, do not generate again for the same branch/month.)
- Release gate remains **human admin UAT, historical capacity decisions, guardian confirmation, production data cutover and verified backup/restore**. Passing CI does not authorize deployment.

## Migrations 025-029 (added after this document was first written; local only)
- 025 and 027: reschedule initiate/assign/reopen/cancel are single atomic SECURITY DEFINER RPCs with class-row locking. 026: signed-in users can no longer change their own role or active flag.
- 028: `resolve_missing_student_guardian_new_parent` creates a parent and links the guardian in one transaction (admin only, audited). `/readiness/guardians` has a searchable parent picker.
- 029: admins can edit a DRAFT month: `move_student_in_draft`, `add_student_to_draft_class`, `remove_student_from_draft_class` (same programme; capacity, overlap and enrollment-window checks; reason required; one row each in `draft_schedule_edits`; enrollments are never changed) and `reopen_schedule_draft` (approved, not locked, back to draft). Hand-placed bookings are flagged `manually_placed`.
- Data refresh importer (`scripts/refresh-data-from-sources.py`): rebuilds local business data from the sheets. It only targets the local Native Runtime database and `apply --target main` requires a fresh backup snapshot. Its per-student notices and make-up review lists are written to `private/*.csv` (git-ignored) and are NOT yet shown inside the app.
- The 2026-10-28 audit confirms all 29 migrations are applied and the audit expects 22 public tables.

## Refreshing parents and guardians from the updated directory sheet
- The directory sheet (tabs CYBER and MTDC; column B student, C phone, D parent) is the guardian source for the data-refresh importer. To use a newer version, export the Google Sheet as .xlsx into `private/sources/students-parents.xlsx` (git-ignored). The importer needs no new format.
- A cell with several numbers (for example `012-3450001/ 0 13-450 0002`, or two numbers with a `(DAFTAR WS)` label between them) now gives the FIRST number as the parent phone and keeps the other number in the parent note. Before, all digits were glued into one wrong phone.
- Header rows are never read as students. Siblings with the same parent and phone still share one parent record.
- On 2026-10-28 the 37 students without a guardian were linked in the LOCAL database straight from this sheet through the audited guardian RPCs (relationship `guardian`, because the sheet only says father or mother). A later refresh rebuilds guardians from the sheet, so the sheet must contain those parents before the importer is run.
- Covered by `tests/test_directory_import.py` (synthetic data only). The importer itself was not run for this change.

## Enrollment create, change, pause and stop (migration 031; local only until reviewed)
- `/enrollments` now lets an admin add an enrollment (with teaching weeks for twice-monthly students), change the class slot or how often a student comes **from a chosen date**, and pause, resume or stop. All of it goes through `create_enrollment`, `change_enrollment` and `set_enrollment_status`; every change writes a row to `enrollment_changes` with the reason.
- A change from a date closes the old enrollment the day before and opens a new one, so bookings already made keep pointing at the enrollment that created them. An enrollment that has no bookings yet is corrected in place.
- Rules: the slot must belong to the enrollment's branch, weekly uses no weeks, twice monthly uses exactly two of weeks 1 to 4, and a student cannot have two active enrollments that overlap in time on the same day in the same week. Two slots on one day that do not overlap (for example 09:00 to 10:30 and 11:00 to 12:30) are allowed.
- Nothing here changes a schedule that was already generated. Pause and stop remove the student from every month generated from then on; they do not keep the student in part of a month. The new rules reach a month only when it is generated, so a draft made before a change needs to be regenerated (the discard-and-regenerate action is not built yet).
- Clients can no longer write `enrollments` directly. UPDATE stays only on `updated_at`, because the monthly generator takes `FOR SHARE` locks that need an UPDATE privilege. Verified in an isolated database built from the real schema: the generator still works, a change from a date shows up in the next generated month, and a paused student is left out.
- Covered by `tests/sql/enrollment_changes.sql` (synthetic) and `tests/enrollment-changes.test.cjs`. Apply 031 to Supabase LOCAL only after a backup.
