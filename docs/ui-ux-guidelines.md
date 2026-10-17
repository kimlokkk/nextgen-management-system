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
