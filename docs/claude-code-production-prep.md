# Claude Code task — NextGen V1 admin pilot and company production preparation
Updated: 2026-10-27 | Use this as the executable engineering brief.
Read docs/production-readiness-plan-2026-10-27.md FIRST.
This document grants permission to audit, implement safe fixes, test and make reviewed code commits on the feature branch; it does NOT grant permission to deploy production, mutate genuine data, provision paid infrastructure, transfer private records, merge main or enable messaging.

## Project context
- Repository: kimlokkk/nextgen-management-system
- Expected work branch: feat/replacement-engine-phase1-20261016 (PR #1 is draft; do not work on old main).
- Stack: Next.js 16, TypeScript, Tailwind v4, Supabase Auth/PostgreSQL, local macOS Supabase CLI Native Runtime, future Vercel + Kizzu company Supabase.
- Typical local config: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:25395 ; Native Runtime local Postgres port 24080; do not print secrets. App npm run dev. Verify real ports/config locally before any action.
- Existing migrations through 024; 024 atomic monthly generation must be checked for presence in target environment.
- Known local snapshot checkpoints (verify afresh; not definitive current counts): September evidence 622; October MTDC 48 classes/352 regular bookings + 81 historical yellow reservations, five classes 6/5; November MTDC DRAFT 48 classes/356 bookings. Hadi Ayyash guardian source unresolved. CYBERJAYA must be separately audited.
- Current business goal: ADMIN CAN USE THE SYSTEM WITH PRELOADED VERIFIED REAL STUDENTS/PARENTS/ENROLLMENTS. Sept/Oct stay historical; November draft preserved and validated. V1 excludes new billing/invoicing/WhatsApp automation until separately built/approved.

## Non-negotiable guardrails
1. First inspect git status, actual current branch and HEAD. If local changes exist, preserve them; never discard/rebase without request. Verify latest GitHub and current source. Do not blindly merge or force-push.
2. No supabase db reset, DROP, destructive cleanup, or regeneration of November draft or October legacy class history. Never apply migrations to company cloud without approval.
3. Never guess missing guardian, attendance, yellow capacity or replacement entitlements. Historical evidence does not imply the student attended.
4. Do not include identifiable people, contacts, private CSVs, tokens, passwords, backups or Supabase dump contents in Git/terminal reports/AI prompts. Do not print .env.local values; only report existence and masked host.
5. Keep real data reads restricted to authorized owner/local access. Use synthetic data only for mutation UAT. Need explicit user permission before external accounts/paid services, live data writes/transfers, PR merge, deployment, domain/secret changes or outbound messages.
6. Kizzu company GitHub, Vercel and Supabase are TARGET environments, NOT verified as provisioned. Keep IRIS strictly separate.

## Execution plan — perform what is safely possible now
Phase 0: Inspect codebase, package scripts, docs, PR and migrations 001–024, test workflows, .gitignore and app routes. Record current branch, HEAD, tests and existing TODOs. Read docs/admin-go-live-readiness.md, docs/production-cutover-runbook.md, docs/legacy-mtdc-seat-reconciliation.md and this handoff.

Phase 1: Conduct a READ-ONLY local readiness audit (when Native Runtime is up):
- Validate database connection and relevant migration/RPC existence without changing data.
- Inspect /readiness, /readiness/november, /readiness/guardians, /replacements/legacy and /readiness/uat; compare actual unique active students, parents, guardian links, active enrollments, invalid/duplicate records, MTDC and Cyberjaya coverage.
- Compare original Sept 622 / Oct 81 / Oct 352 / Nov 48+356 checkpoints; explain differences, not hide them.
- Prove November saved draft matches exact student/enrollment/time/weekday/class-date projections, not merely aggregate totals; protect existing IDs.
- Identify 5 overcapacity cases, Hadi guardian and other uncertainties as human-ownership tasks; do NOT resolve by guess.
- Produce sanitized docs/release-evidence/nextgen-local-readiness.md marking every gate PASS, FAIL or UNKNOWN and what evidence is missing. No PII.

Phase 2: Harden and verify code:
- Check whether markForReschedule or analogous initiation still performs non-atomic Supabase writes; if yes, propose and implement a single PostgreSQL atomic admin-authorized RPC and regression tests using disposable DB only, without live migration or destructive changes.
- Review Auth session handling, privileged function grants/RLS and approved/locked scheduling flows. Identify actual security gaps, never randomly revoke permissions used by Supabase Auth triggers.
- Create/extend tests for record-preserving reconciliation, November draft protection, capacity guard, duplicate entitlement, concurrent admin updates, student/enrollment consistency, role restrictions and rollback.
- Run npm ci, npm run lint, npm run build, existing JS/SQL suites and isolated operations UAT. Record failures and fix genuine regressions; do not fake PASS.

Phase 3: Prepare deployment artifacts, NOT deployment:
- Propose clean private company GitHub repo/PR strategy, Kizzu-owned independent Supabase staging/production projects and separate Vercel environments. Prefer staging test data; production receives source-verified records only after permission.
- Prepare executable but guarded, idempotent DRY-RUN data migration preflight and count/foreign-key/fingerprint validators where feasible. Keep snapshot source read-only; exact user/UUID identity preservation and Auth restore require explicit compatibility testing.
- Define a Kizzu company-ownership/access checklist, scoped env-var names (no values), secure secrets checklist, backups, restore rehearsal, rollback, Auth invite/account migration flow, monitoring and domain.
- Supply admin briefing/UAT scripts for a real admin (READ-ONLY source) and fake-data staging workflow. Document billing/WhatsApp manual interim SOP, if accepted by owner.
- Existing docs/production-cutover-runbook.md and docs/admin-go-live-readiness.md are authoritative; update only where current code/evidence proves stale, labeling superseded paths.

Phase 4: Report and stop at approval gates:
- Give an explicit GO/NO-GO for (a) admin briefing, (b) isolated pilot, (c) real operational company launch.
- Show a blocker matrix: issue, severity, evidence, owner, proposed fix, safe next action. Distinguish verified facts from local-only assumptions and unverified company resources.
- Summarize actual file changes (exact file paths and blocks), tests run/results and commit SHA/branch. Push safe reviewable changes to a feature branch; open/update PR, never merge to main without the user's approval.
- Ask user only for unavoidable ownership/credential approvals, real source-signoffs and irreversible/destructive decision gates. Stop before production or migration of real private data.

## Communication and code-change response style
Use casual Malay for the owner but write technical notes precisely. For every requested code edit report: FILE LOCATION → EXACT BLOCK TO FIND → WHAT TO ADD/REPLACE → FINAL EXPECTED BLOCK → HOW TO TEST → EXPECTED OUTCOME.
Do work now rather than re-explaining the Next.js setup. If local-only tools/data are inaccessible, state that clearly and prepare bounded audited work without inventing results.
