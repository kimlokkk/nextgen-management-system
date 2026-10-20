# MTDC October 2026: confirmed legacy yellow seats (Local only)

Status: local staging / Draft PR. Cloud production intentionally unchanged.

## Business evidence
- The MTDC October attendance workbook is an operations-confirmed record of 81
  historical replacement reservations, not evidence that each child attended.
- The origin months are Jun–October; original source class records for most
  historical reservations are unavailable. Never synthesize attendance or
  makeup_obligations solely to fit the modern engine.
- Local imported regular schedule: 48 sessions / 352 regular bookings.
- Historical review queue: 81 records, broken down as 69 missing original
  booking, 7 source-link candidates, 3 date-order reviews, 2 roster identity
  reviews. A total of 30 legacy source entries sit in five 6/5 yellow slots.
  The extra capacity required is five, not 30.

## Occupancy and migration 019
1. Apply `supabase/migrations/018_legacy_replacement_review.sql`, then load
   the private/local-only review queue from the existing October import.
2. Apply `019_legacy_yellow_seat_guard.sql` to Supabase LOCAL only.
3. Effective yellow usage is **active, occupying replacement bookings +
   Excel-confirmed non-excluded legacy reservations not already represented
   by an explicitly linked active booking**.
4. Migration 019 does not edit any of the 81 source records, 352 regular
   bookings, capacities or attendance; it adds a linkage column and database
   triggers for *future* writes.
5. A linked modern booking only counts once, and only if the student name,
   target class and booking type match (verified by trigger). If the linked
   booking is cancelled or moved, the Excel reservation counts again.
   The app does NOT auto-link on names or create active bookings.
6. Inserting or moving a modern replacement into a fully reserved class
   is blocked by the database even when the legacy seats have not been
   converted to student_bookings.
7. Reducing a class capacity below occupied seats is blocked.
8. Regenerating/deleting a class with confirmed legacy reservations is blocked
   to preserve source-to-class linkage. Do not reset local DB or regenerate
   the MTDC October Draft during reconciliation.

## Admin operations
- Schedule timetable and class details show effective yellow occupancy, with
  active and Excel legacy breakdown. Source records are **not** attendance.
- Schedule validation treats combined yellow overages as draft approval blockers.
- Historical replacement review page surfaces over-capacity classes in one
  shortlist, with links to the affected session detail.
- Each of the five 6/5 exceptions requires operational confirmation of room
  and facilitator capacity **before** using the existing *Draft only*,
  class-specific, reason-and-audit capacity adjustment (migration 017).
  No blanket template increase and no automated override.
- The historical review queue retains date-order, identity and missing-origin
  status independently from operational confirmation of the target reservation.
- Excel data and personally identifying student details must never be added
  to this GitHub repository.

## Expected local read-only verification
After migration 019, on the current local import:
- 81 non-excluded historical reservations (unless admin has explicitly
  excluded some via audited review decisions).
- Five target classes may initially show 6/5, i.e. 5 total excess seats
  (assuming capacities and import remain unchanged).
- Active modern replacement count remains whatever it was before the change.
- No historical attendance was marked present/completed.
- No makeup_obligations were generated from the legacy records.

Do not apply migration 019 to the live Supabase cloud without a separate
deployment and migration review.

## Capacity decision review (migration 020: local only)
- Admin can retain current yellow capacity while recording a plan to resolve excess reservations. This leaves overcapacity warnings and booking restrictions unchanged.
- Increasing capacity requires confirmed room space, facilitator availability, named confirmer and a note (all database enforced); affects only one draft scheduled class.
- Both decisions audit the acting admin, time, old/new limit and active/legacy counts. Increases also use the existing migration 017 change audit.
- Stale capacity or occupancy is rejected atomically. Legacy source records, regular bookings and attendance remain unchanged.
- The old unverified capacity-adjust RPC is no longer executable by authenticated clients after migration 020.
- Apply migration 020 only to the existing local MTDC staging database once 017–019 are installed. Cloud production must not be altered without a separate review.

## Read-only original booking candidate comparison (no migration)
- For explicit original_booking_id candidates, admin can compare the imported student's name/original date with the current source booking name, original session date/time, booking type and recorded attendance.
- Matching text is explicitly NOT identity verification, attendance confirmation or replacement entitlement.
- A candidate source marked Present is flagged for manual operations review; the app never changes it.
- Missing original bookings and permission/query errors show an explicit unavailable state rather than silently implying a match.
- There are no data writes, no automated source linkage, and no new migrations in this increment.
