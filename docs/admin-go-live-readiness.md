# NextGen Admin Go-live: local audit and release gates

The `/readiness` route is read-only and restricted to active admin/super_admin accounts. It checks student data, links, September–October evidence, class occupancy and November draft readiness. It does NOT certify production. All counts are queried live from the environment serving NextGen with paginated authenticated requests (no service-role bypass).

## Why pilot is currently blocked
- Historical September/October data are in Supabase Local and are not automatically present in cloud production.
- Five October yellow-seat exceptions have been observed in MTDC staging. Their real capacity decisions require operational verification; do not auto-approve or invent attendance.
- November needs a deliberate draft review/approval, with calendar and student enrollment verification.
- Production backup/restore, admin user permissions, signed-off import and end-to-end UAT remain manual requirements.
- Draft regeneration uses delete/recreate and must not be run on preserved October legacy sessions or a production database until hardened.

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
