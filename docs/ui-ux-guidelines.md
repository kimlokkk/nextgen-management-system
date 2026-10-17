# NextGen UI/UX Standard — Clean Admin Workspace

## Product direction

NextGen is an operations tool used by admins to finish tasks, not a marketing page.
**CLEAN** means *low cognitive load*, not a blank page: predictable structure, readable text,
restrained visual accents, and an obvious next action. Functional safety always wins over decoration.

### Rules we use everywhere

1. **One primary action per surface.** Secondary actions get a quiet border;
   destructive actions must be visually distinct and require confirmation.
2. **The clickable thing must look clickable.** Links are semantically links, buttons
   are buttons. Provide hover, focus-visible, pressed, disabled and loading feedback.
   Never make an inert card look actionable.
3. **Clear visual hierarchy.** Section heading → short contextual description →
   essential controls → status/data → follow-up actions. No unexplained abbreviations.
4. **Readable density.** Tight enough for admin workflows, not crowded. Use consistent
   8px-ish spacing, 40px+ targets for touch, and avoid competing bold labels.
5. **Neutral palette.** Let typography and spacing carry the interface; use color
   for status, validation, primary actions and destructive actions only.
6. **Honest data.** Distinguish open/scheduled/completed/cancelled; explain what a metric
   includes. Do not show an empty state as a zero when the query failed.
7. **Responsive first.** Navigation stays available on mobile, card grids collapse,
   forms use one column on small screens, and large data tables scroll horizontally
   without losing their action column.
8. **Accessible interaction.** Keyboard usable, visible focus, labels for fields,
   understandable icon labels, and reduced-motion support.
9. **No new spending for UI work.** Reuse Next.js, React, Tailwind and Lucide already
   in the repo; no commercial component libraries or new paid services.
10. **Business logic stays intact.** UI changes must not rewrite schedule, entitlement,
    slot capacity or attendance rules.

## Shared patterns

- Workspace shell: responsive sidebar with explicit active route and a mobile menu,
  sticky header, safe content width, logical focus order, skip-to-content.
- Page intro: short eyebrow, clear title, one-sentence context; primary action obvious.
- Metrics: value + label + period/scope + drill-down affordance if clickable.
- Forms: visible labels, required fields indicated, error feedback, disabled and pending states.
- Tables: clear column names, row dividers and hover differentiation; small screens scroll
  rather than hide information.
- Action links: `ui-action-link` for quiet actions. Buttons use
  `ui-primary-action` / `ui-secondary-action`.
- Clickable cards: `ui-interactive-card`; non-clickable cards should have no hover treatment.

## Implementation waves

### Wave 1 — Foundation (in progress / review)
- Responsive navigation and content shell.
- Consistent hover/focus/disabled states.
- Direct-table horizontal scrolling on mobile.
- Shared action styling across high-use pages.
- App metadata and keyboard access.

### Wave 2 — Data-heavy modules
- Parents, Students, Enrollments: accessible forms, concise validation, better
  empty states, responsive record lists, clearer status/action columns.
- Schedule: separate schedule creation from review; concise batch cards, filters,
  validation summary and session actions.
- Reschedule and Replacement: consistent status styling, wizard-like assign/change
  flow, compact cancellation panel, explicit back/next navigation.

### Wave 3 — Operational polish
- Dashboard prioritization and drill-down usability.
- Loading/pending/success/error feedback for server actions.
- Mobile screenshots and manual QA at widths 375, 768, 1024 and 1440.
- Keyboard and screen-reader smoke test, contrast check in light and dark themes.

## Definition of done for each page

- [ ] A new admin understands what the page is for within five seconds.
- [ ] Can tell which items can be clicked without trying them.
- [ ] Primary action is findable within five seconds.
- [ ] No horizontal overflow of the full page at 375px.
- [ ] Tables with many columns have an independent horizontal scroll.
- [ ] Keyboard tab order and focus visibility are clear.
- [ ] Hover and disabled states never misrepresent an available action.
- [ ] Empty, error and pending states are understandable.
- [ ] Existing business-flow regressions remain green.


## Admin-centered information architecture (based on existing NextGen features)

### Sidebar

1. **Overview → Dashboard:** One entry point; no duplicate homepage.
2. **People → Parents, Students, Enrollments:** These mirror the workflow of
   enrolling a child (guardian contact → child profile → class enrollment).
3. **Class operations → Class schedule, Reschedules, Replacements:** Day-to-day
   work stays together; exceptions are separate from the schedule itself.
4. **Setup → Class settings:** Capacity and weekly session templates.
   The read-only Session directory remains accessible from Class settings rather
   than occupying a near-duplicate primary menu item.
5. **Billing** will be added to the navigation when implemented, not shown as a
   fake interactive destination.

### Page content order

**Dashboard**
- First: counts of students/enrollments and open exceptions.
- Then: "Needs attention" action list **before** lower-priority weekly class listing.
- Then: monthly attendance summary.
- Any metric should name the time period/status it covers.

**Reschedules / Replacements**
- Clear purpose (what a new admin needs to do), not a generic "queue" heading.
- 3 compact summaries: awaiting assignment, scheduled, history.
- Search and an explicit filter: All / To assign / Scheduled / History.
- Prioritize open requests in the list, then scheduled, then completed/cancelled.
- Mobile: scannable **cards**, each with name, programme/branch, original class,
  destination, status and an explicit full-width action.
- Desktop: compact table with a real Action column.
- No dependence on sideways swiping to reach the primary task.
- Keep original and assigned class separate; do not imply cancellation means absence.

**Parents, Students, Enrollments (next redesign)**
- Default to **records first** with a search/filter and concise list.
- The create flow should be a clearly labelled primary action that reveals
  a form only when needed; long forms should not push the entire directory away.
- Enrollment form: order by prerequisite: student → branch → programme →
  regular session → frequency/start date.

**Monthly Schedule (next redesign)**
- Existing locked schedule and class review should be primary.
- Generate a schedule remains a clearly labelled secondary operation.
- Show month, branch, programme, lock state, capacity and conflicts without
  mixing actions for draft vs locked schedules.

**Session review / replacement detail (next redesign)**
- Primary context and status at top.
- Then today's student roster/capacity or original+target class.
- Then one prominent next step (mark attendance, choose yellow slot).
- Risky actions (cancel/release) separated into a lower-priority "More actions" area.

### What has actually been implemented so far
- Responsive sidebar + grouped menu with a clear disabled/active distinction.
- Dashboard attention list moved before weekly classes.
- Both queue pages now render mobile cards below the desktop table breakpoint
  and include search, status filters, summaries and visible CTA buttons.
- Shared hover, focus, button, input and table basics from Wave 1.

These improvements are **not** a claim that every create/detail page has been
fully redesigned. Parent/student/enrollment forms and schedule/detail screens
still require their dedicated UX pass and manual phone-size browser checks.


## Theme polish — Option C

- `next-themes` is **already installed and wrapped in `app/layout.tsx`**;
  don't install it again and do not nest a second ThemeProvider.
- Header `Theme` menu offers Light, Dark and System and stores a manual choice
  in browser storage through `next-themes`.
- Theme palette is implemented in the final modern `:root` and `.dark` design
  tokens in `app/globals.css`. Base colors are neutral with restrained emerald
  accents for important navigation, calls to action, focus, and KPI icons.
- Status meaning: amber open/pending, blue scheduled, emerald completed, rose
  cancelled. Colors never replace text labels.
- Both desktop and mobile share one token system and header theme picker.
- UI-only: no schema change, Supabase update or additional dependency.
- Manual QA: toggle each theme from the header; check sidebar active state,
  forms, queues, dashboard and login at 393px and desktop widths; refresh and
  verify manual theme persists; test System by changing the OS theme.

## Wave 2 — Parents, Students, Enrollments implemented

- All three pages use `RecordDirectory`: record list first, visible Add action
  to reveal/collapse the original create form, search, and status filters
  on pages that actually have statuses. Form is not permanently above the list.
- Small screens show readable **cards** with the crucial fields without sideways
  scrolling. Desktop retains a dense table with the established TableScrollArea
  navigation for half-width windows.
- **Parents:** parent name, WhatsApp, phone and email; searchable by contact info.
- **Students:** primary guardian, date of birth, laptop and active status;
  searchable by student or guardian; link to create a parent first if absent.
- **Enrollments:** student, programme and branch context, regular session,
  frequency, start date and status; historical inactive student/branch/programme
  names resolve from all records, while the create form offers only active
  options. Clear missing prerequisite guidance when create is impossible.
- Enrollment form keeps the existing dependent Branch → Programme → Session flow
  and now clears the selected session when branch/programme changes, preventing
  stale mismatched choices.
- Shared `FormSubmit` presents a pending/loading state and disables duplicate
  submit; create forms have programmatic labels and more suitable mobile
  phone/email keyboard hints.
- Scope is **UX/queries only**: no server-action rewrite, schema migration,
  database data write, dependency or new paid service. Existing business
  logic/validation is still enforced by the original server actions.
- Remaining work: review/UX improvements to form submission error/success
  feedback and further Schedule/detail-page overhaul, followed by browser QA.

## Wave 3 — Schedule workspace redesign

The monthly Schedule page now opens an available schedule automatically:
1. **This month's locked batch** if available.
2. This month's latest batch otherwise.
3. The most recently generated available month otherwise.

The selected schedule appears **before the archive/generator**, with:
- Month, branch and status badge.
- Count of sessions, regular seat usage/capacity and yellow seat
  usage/capacity, plus a blocking validation summary.
- Counts use `countsTowardsRegularCapacity` and
  `countsTowardsReplacementCapacity` from the existing schedule policy,
  matching the class detail page. The old hardcoded `0 / yellow capacity`
  was misleading and has been removed.
- A contextual approve (draft) or lock (approved) action, with validation;
  locked schedules are clearly read-only at the batch level.
- Class list: search by date/programme, week and programme filters,
  mobile class cards with Review button, and a desktop table with explicit
  horizontal scrolling.
- Browse monthly schedules: searchable status filter, desktop table/mobile
  cards, current selection marker, click to review a different batch.
- Generate schedule is in an optional, collapsible panel below the
  current workspace; warning states that regenerating an existing draft
  replaces that draft and its bookings, and only active branches can be chosen.

Important: no scheduling algorithm or server-action changes, no DB mutation
or migration, no additional package. Need manual browser QA for:
- Existing batches from different months/branches and invalid batch URL.
- Locked, approved, draft and validation-error states.
- Half-width desktop, iPhone, dark/light theme and class review links.
- Correct regular/yellow occupancy on a real assignment.


## Wave 4 — Session Detail + Attendance UI (2026-10-18)

- Rebuilt the class detail layout around the admin's decision path:
  **class identity/status → seat usage → warnings → attendance progress →
  searchable student roster with row-specific actions**.
- Capacity cards show actual **regular** and **yellow/replacement** usage,
  plus reschedules (explicitly noted as included in regular usage), using the
  existing policy counters. Over-capacity numbers remain prominently red.
- Class attendance panel displays recorded / eligible, Present, Absent,
  Unmarked and recording progress. A separate present-of-marked percentage is
  shown only when records have been marked (otherwise an em dash).
  Original reschedules and cancelled bookings remain excluded from these
  attendance totals.
- Added `components/session-roster.tsx` with searchable student entries,
  attendance-state filters, booking-type filter, stacked mobile cards,
  half-width-friendly desktop table and semantic attendance colors. Real actions
  and history remain available inside each row; long tables are not required on
  phones.
- Form submit feedback shows a per-action spinner and prevents rapid duplicate
  submits. Buttons for Present, Absent, Confirm Absence, Mark Reschedule,
  Plan Replacement, Reopen Replacement and Mark Absent/Replacement are rendered
  by the server page using **the exact existing eligibility conditions**.
- No edits to `app/(app)/schedule/sessions/[id]/actions.ts`, session policy,
  Supabase schema, migrations or scheduling/attendance business rules.
- Browser QA required on locked past classes, future/unlocked sessions,
  replacement/reschedule obligation variants (especially cancelled/reopened),
  desktop half-width, iPhone cards, keyboard forms and dark mode.
