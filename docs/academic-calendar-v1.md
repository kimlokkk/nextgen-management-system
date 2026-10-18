# Academic Calendar V1 — Admin decisions before monthly schedule generation

## Why this exists

A branch can close for a holiday, NextGen event or branch-level closure. The
class scheduler must not infer whether all affected students need a replacement,
a fee adjustment, or a new regular date. **An administrator explicitly decides.**

Example for MTDC, October 2026:
- A Saturday 24 October event is **not confirmed** merely because a
  spreadsheet doesn't list classes on that date.
- When the admin records an event on **2026-10-24** and chooses **Move**
  to **2026-10-31**, lessons still run as **W4**, not as individual makeups.
- Cyberjaya is unaffected: calendar exceptions are branch-specific.

## Teaching weeks vs transition week (agreed September 2026 policy)

**Do not equate W5 with a fifth regular/paid class.** Monthly regular lessons
remain W1–W4 by default; the fifth occurrence of a weekday (if any) is an
**administrative transition week** for creating and reviewing the next month's
draft, not an automatic extra lesson. A four-occurrence weekday uses W4 for
both its regular class and transition planning.

Example, October 2026:
- Saturday: 3, 10, 17, 24 Oct are regular W1–W4. Saturday **31 Oct is W5
  transition** by default, not automatically generated as a fifth class.
- Sunday: 4, 11, 18, 25 Oct are regular W1–W4. Sunday **25 Oct is W4
  and transition**.
- A separately *confirmed* branch closure may move Saturday 24 Oct W4 to
  Saturday 31 Oct. The lesson still displays **W4**, while the date is also
  the administrative **W5 transition date**; those are different concepts.
- A source spreadsheet labelling 31 Oct W5 is **not** evidence of five
  paid lessons or proof that 24 Oct was cancelled. Verify with the admin.
- The transition CTA opens the next month's **draft generator** with the
  month/branch preselected; it does **not** silently generate, approve, lock,
  WhatsApp-blast or bill anything.

Implementation: `getMonthlyTeachingCycle(year, month, dayOfWeek)` is the
shared source of truth for four default regular teaching dates, the final
weekday occurrence / transition label, and the next month. Neither draft
regeneration nor a new approval is required just to display the transition
week. Extra paid sessions or optional W5 teaching would need an explicit
future enrollment/package rule rather than a calendar-dependent default.

## Event lifecycle

| Decision | Meaning | Generator |
|---|---|---|
| Pending | Recorded but no admin decision yet | Blocks generation if affecting a planned W1–W4 class |
| Move | Replace this branch-wide class day with explicit target date | All active templates on the day move; same lesson week number |
| Skip | No regular class on that date | Drops that date's scheduled regular classes; no automatic replacement/credit |
| Withdrawn | Event no longer affects teaching | Generator returns to ordinary class dates |

The event record is retained for audit even when withdrawn; delete is blocked.

**V1 limitations, deliberate:** one branch/day per event; all programmes at
that branch that would teach that day are affected. Moves require a **later
date on the same weekday in the same month** (e.g. 24→31 October) and must not
collide with another existing class or calendar event. Cross-month moves,
single-programme closures, cross-branch events and recurring holiday rules are
**not supported yet**. The existing four teaching-week baseline remains.

## Protection and approval

1. An active **admin/super_admin** creates a branch/date event. New events are Pending.
2. They save an explicit decision, with an explicit acknowledgement for Skip.
3. The Academic Calendar page provides a **read-only date preview**.
4. The Schedule generator loads those decisions and validates **before** it
   destroys any existing draft. For existing drafts, the user must explicitly
   tick an overwrite acknowledgement.
5. Editing an event after a draft was generated does not mutate its classes.
   Schedule Validation then blocks approving the stale draft; regenerate it
   deliberately to incorporate the new decisions.
6. After a batch is Approved or Locked, calendar edits for that branch/month
   are denied both by the server action and the **database trigger**.
   An exceptional change after locking will need a separate audited workflow
   in a future phase; V1 does not directly rewrite past bookings.

**Caution:** The existing draft regeneration implementation deletes/recreates
the draft and its child sessions/bookings. It is not an in-place transaction.
Only test this with development/staging data until a non-destructive
regeneration/approval workflow is implemented.

## Technical files

- `supabase/migrations/016_academic_calendar.sql`: table, uniqueness, status/date
  constraints, RLS, automatic update timestamp, approved/locked protection.
- `lib/scheduling.ts`: pure, calendar-aware generation; week numbers preserved.
- `app/(app)/housekeeping/calendar/{page,actions}.tsx/ts`: admin page and actions
  (the files actually have extensions `page.tsx`, `actions.ts`).
- `components/calendar-decision-form.tsx`: client decision controls.
- `app/(app)/schedule/actions.ts`: apply calendar decisions to drafts, plus
  regeneration confirmation.
- `lib/schedule-validation.ts`: detect events modified after draft generation.
- `tests/scheduling-calendar.test.cjs`: deterministic October 2026 tests.
- `tests/sql/calendar_integration.sql`: migration constraints and freeze guard.

## Setup / safe manual acceptance test

1. Pull the development branch. Apply **only migration 016** to a **development /
   staging Supabase database** after confirming migrations 001–015 exist.
   **The repository commit does not apply the migration remotely.**
2. Open **Academic calendar** in Class Operations. Select the MTDC branch and
   `2026-10`. Confirm its active Saturday class templates are correct.
3. Add "NextGen event" on `2026-10-24`. It starts as Pending.
4. Select **Move class** and target `2026-10-31`; save.
5. Expand **Preview class dates**. The moved Saturday classes should show
   `W4` on 31 October and no W4 on 24 October.
6. Open Class schedule, generate a draft for MTDC October. If a draft exists,
   review the overwrite warning and tick the confirmation **only on staging**.
7. Review the generated class list and each session's regular bookings.
   Ensure no individual makeup obligation is generated for a whole-class move.
8. If you need to change the event, edit it before approving and regenerate
   the stale draft deliberately. Try approver/locker checks and confirmed
   frozen state on test data.

No student/parent details are imported by this feature. Attendance must still
come from a separate verified import or regular marking workflow; blank cells
in historical sheets are not treated as absence.

## Questions to agree before Phase 2

- How does NextGen handle student fees/credits for **Skip** (no regular class)?
- Should admin be able to move across **months** or to a different weekday,
  with facilitator and room availability checks?
- Should there be programme-specific or space-specific closures (MTDC Space 1/2)?
- What approval/audit flow should apply when an event emerges **after locking**?
- How are affected parents/facilitators notified when the date changes?


## Historical MTDC reconciliation: per-class yellow-seat overrides (migration 017)

In the October 2026 staging import, **101 regular placements and 352 regular
bookings reconcile**, with no per-enrollment booking count mismatches. The 81
legacy replacement rows remain in `nextgen_import`; they are NOT actual
yellow-seat bookings and have not been granted new obligations.

Five source slots contain six replacement names while the generated class
yellow capacity is five:

| Date | Space mapping | Time | Source/capacity |
|---|---|---|---|
| 2026-10-03 | Space 1 / JR_MAKER (staging only) | 11:00–12:30 | 6/5 |
| 2026-10-04 | Space 2 / YOUNG_CODER (staging only) | 11:00–12:30 | 6/5 |
| 2026-10-10 | Space 2 / YOUNG_CODER (staging only) | 09:00–10:30 | 6/5 |
| 2026-10-11 | Space 2 / YOUNG_CODER (staging only) | 11:00–12:30 | 6/5 |
| 2026-10-18 | Space 2 / YOUNG_CODER (staging only) | 11:00–12:30 | 6/5 |

**Never raise template capacity to make a historical source count match.**
After operations confirms physical room/facilitator capacity, an active admin
can open **Class schedule → Review** for the individual class, expand
**Adjust yellow seats for this class only**, explicitly acknowledge the
change and give a reason. Migration 017 provides the audited, draft-only RPC.
No defaults change and no capacity is adjusted merely by visiting the page.

The one-class audit is retained even if a draft is regenerated (the affected
class session reference becomes null on deletion). However, a manual override
of a draft is **not** transferred into regenerated class sessions; operations
must check it again after regeneration. Approved/locked classes cannot be
adjusted using this action.

**IMPORTANT:** Reconciliation still requires verifying historical source
bookings and class eligibility. A capacity adjustment alone does not
validate, import or create any of the 81 legacy replacement bookings.
Two legacy replacement entries for a student not in the October roster may
refer to earlier-month enrollment. Also, 72 W1 module entries remain
unimported and are not a substitute for attendance confirmation.

`supabase/migrations/017_class_replacement_capacity_override.sql` is committed
on the feature branch only, NOT applied to the user's local/cloud DB by Git.
Run local migrations explicitly only after backing up local staging. Do not
apply to production without review.
