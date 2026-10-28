# NextGen — Admin pilot to company production handoff
Updated: 2026-10-28 (facts section refreshed from the 2026-10-28 local audit) | Owner decision: prepare, do not deploy yet
Branch: feat/replacement-engine-phase1-20261016 | Existing PR #1: draft

## Executive release decision
- READY: owner/admin briefing, read-only review of existing records, preparation of isolated UAT.
- NOT YET READY: unrestricted daily operations, production cutover, automatic outgoing WhatsApp/invoicing.
- Objective: admin signs into a Kizzu-owned deployment and finds already-imported, source-verified parents, students, guardian links, enrollments, session settings and validated November schedules. They should NOT manually re-enter hundreds of records.
- V1 scope: parent/student/enrollment directory, class settings, academic calendar, monthly scheduling and approval, attendance, reschedules, replacements, capacity checks, operational dashboard. Billing, invoices/receipts and Merpati WhatsApp may stay on the existing manual process IF operations expressly accepts a documented temporary workaround and confirms there is no in-app promise of automated delivery.

## Verified versus unverified facts (do not overstate)
- Last observed GitHub working branch head before this document: df9cac2 (2026-10-25); PR #1 open/draft; latest automated GitHub Actions passed. Branch must be checked again by implementer.
- Scheduling generation now uses atomic database RPC in migration 024. All current production-readiness decisions must use current code, not superseded non-atomic generator notes elsewhere.
- Current LOCAL baseline (read-only aggregate audit 2026-10-28, `docs/release-evidence/nextgen-local-readiness-2026-10-28.md`; migrations 001-029 applied; 34 PASS / 4 WARN / 3 UNKNOWN / 0 FAIL): 144 students, 101 parents, 139 active enrollments (MTDC 89, Cyberjaya 50) covering 131 distinct students; 622 September evidence rows (492 regular roster + 130 historical replacement); October MTDC 48 regular sessions / 332 regular bookings (locked) and 81 historical replacement reservations. These are snapshots, not proof of attendance or identity.
- SUPERSEDED: the earlier "November MTDC draft 48 classes / 356 bookings" checkpoint no longer exists locally. The data refresh (importer) rebuilt local data from the sheets and the November draft is now optional: there are 0 November batches. The admin generates it from Class schedule when ready. Ignore the old 48/356 and 352-booking figures elsewhere.
- Open WARN items (2026-10-28): 39 active students with no guardian link; 3 parents with no phone/WhatsApp; 13 active students with no active enrollment; 5 October classes at 6/5 yellow usage. Also 8 students have more than one active enrollment (could be legitimate, e.g. two programmes, but no database rule prevents accidental duplicates).
- Historical replacement review: 81 source rows classified; 52 recorded as source_checked, 29 still needs_investigation. No make-up obligations were created from legacy rows (0).
- Five October sessions have 6/5 yellow-seat reservations; real operational room/facilitator confirmation remains required.
- A guardian relationship for Hadi Ayyash was still pending independent source verification.
- No proof that the company GitHub repository, company Supabase project, Vercel deployment, production secrets or local-to-company data cutover is complete.
- Current accessible Supabase connector showed only a personal organization and projects; this is not proof that company resources do not exist. Company resources require owner-provided access and verification.
- No observed completion of human admin UAT, full real-data disaster recovery certification or production sign-off.
- Count of UNIQUE real students, parents, active enrollments, verified guardian links and Cyberjaya completeness requires a new aggregate-only LOCAL audit. 356 bookings is NOT 356 students.

## Data policy for first release
1. Import verified real parents, students, guardians, enrollments and branch/programme/session settings before admin onboarding. Preserve stable IDs, relationships, original dates and audit history. Deduplicate only with independent evidence, never by fuzzy names alone.
2. Keep September and October as read-only/appropriately reviewable historical data; do NOT erase them or automatically turn ambiguous roster rows into attendance or replacement entitlement.
3. Keep confirmed October historical yellow reservations in capacity accounting. Pending historical sources stay pending with an owner and evidence trail. Five 6/5 sessions must not be silently overridden.
4. When a November MTDC DRAFT exists, preserve it and audit exact student/enrollment/date/slot pairings against present rules. (Superseded 2026-10-28: no November draft exists now. When the admin generates one, it must not be overwritten, and not locked without admin approval.)
5. Explicitly check Cyberjaya data quality and completeness independently of MTDC before any claim of company-wide readiness.
6. Exclude demo/synthetic users and fixtures from production. Do not publish private CSVs, student names, phone numbers, Auth data, backups, or secrets in commits, PRs or ChatGPT.
7. Use a signed source-of-truth and document the cutoff/freeze time: no manual changes in LOCAL after final export, no parallel write authorities, reconcile deltas if source changes.

## Release workstreams and gates

### A. Local baseline and business-data audit — P0
- [ ] Check git branch/clean tree and running Native Runtime; verify API localhost :25395 and local Postgres :24080 rather than silently switching to cloud.
- [ ] Read /readiness, /readiness/november, /readiness/guardians, /replacements/legacy and /readiness/uat with an admin account. Record aggregate counts only in a new non-sensitive evidence file.
- [ ] Compare students, parents, active enrollments, missing guardian links, duplicates, broken FKs, inactive templates and all Nov stored sessions/bookings to signed-off MTDC and Cyberjaya source files.
- [ ] Resolve Hadi guardian only when human independent evidence identifies the relationship; leave unresolved with documented owner otherwise.
- [ ] Seek admin decisions and room/facilitator evidence for five October 6/5 yellow-capacity cases. Never synthesize capacity, attendance or entitlement to obtain a green audit.
- [ ] Verify migration 024 is applied to intended LOCAL database, tests pass, and no protected real November/October records change during review.
- Acceptance: evidence report lists numeric before/after aggregates, blockers with named owners and read-only invariants; no invented PASS.

### B. Code/security hardening — P0 for concurrent production operations
- [ ] Inspect reschedule-initiation workflow for multiple independent API writes / best-effort compensation (previous known risk) and harden to a single authenticated, admin-authorized atomic SQL transaction if still present. Add rollback, conflict, duplicate entitlement, RLS and concurrency tests.
- [ ] Review all privileged SECURITY DEFINER routines, execute grants, active-admin checks, exposed schemas and Auth trigger; remove unintended anonymous execution only after verifying intended trigger behavior. Check Supabase advisors and compromised-password protections.
- [ ] Test role restrictions: no ordinary/non-admin changes; admin/super_admin only as intended. Inspect SSR session/cookie behavior in deployment.
- [ ] Run npm ci, npm run lint, npm run build, unit tests and isolated PostgreSQL integration/UAT. Do not assume a green CI run proves real browser UAT.

### C. Company isolation & staging — P0
- [ ] Confirm actual owning identities/team access for Kizzu GitHub, company Supabase and Vercel. Never guess a repository/project name or access rights.
- [ ] Create or transfer a PRIVATE company GitHub repository with protected default branch, review rules and CI, only on explicit owner approval. Preserve original dev repo/branch history; never push secrets or private data.
- [ ] Create a dedicated company-owned Supabase NextGen project, NOT the IRIS database, and a separate isolated UAT/staging database/project with fake data. Verify organization, billing boundaries, region, Auth and RLS policies.
- [ ] Create Kizzu Vercel project linked to the approved company repo, with protected staging/preview and production environments. Use distinct scoped publishable keys/URLs and server-only secrets; never point staging at production data.
- [ ] Keep WhatsApp blast, billing, and all external webhooks/callbacks disabled until approved. No real communications during UAT.
- Acceptance: Kizzu-owned, isolated, accessible staging URL with least-privilege admin account and no real private data exposed to unapproved testers.

### D. Supabase-aware migration, recovery and verification — P0
- [ ] Fresh encrypted/restricted LOCAL backup and checksum before any export. Review docs/production-cutover-runbook.md and scripts: managed Supabase schemas cannot be blindly restored into hosted PostgreSQL.
- [ ] Demonstrate real snapshot restore in an isolated initialized compatible Supabase clone, including auth.users/identities, app tables, UUID/FK integrity and login/role policies; exclude live tokens/MFA sessions as required and handle Storage/R2 object bytes separately. Synthetic restore CI alone is insufficient.
- [ ] Dry-run migration with aggregate-only comparison and referential checks; plan identity transfer and account recovery. Require owner approval before cloud writes.
- [ ] Run controlled company database migration, preserve historical reservations and audit provenance, then validate record fingerprints/foreign keys, unique-entity totals, class occupancy, November draft identity pairings and admin login.
- [ ] Document rollback runbook, retention, backup owner, monitoring, access revocation, new deploy reversal and data-freeze procedures.
- Acceptance: restore evidence recorded and reproducible, verified migration and owner-approved cutover plan.

### E. Human acceptance, sign-off and switch — P0
- [ ] Brief admin using real records READ-ONLY. Do interactive writes against an ISOLATED disposable environment with synthetic students.
- [ ] Witness all six /readiness/uat checks: enrollments to timetable; Draft→Approved→Locked; attendance/time guards; reschedule/replacement capacity and lifecycle; historical integrity; admin acceptance/recovery.
- [ ] Compare the actual November schedule with room/facilitator availability and closures. Determine whether outstanding historic issues block a particular operation; document exception owners.
- [ ] Decide the V1 scope and manual billing/WhatsApp interim process; train admin on normal operations and known limitations.
- [ ] Obtain signed dated admin + technical owner GO/NO-GO and authorize production switch separately. Do not merge PR #1 or enable outgoing messages simply because CI is green.

## Evidence deliverables
- docs/release-evidence/ (aggregate-only; mark PASS/FAIL/UNKNOWN and cite test names, Git SHAs, timestamps; never PII).
- Data migration mapping and dry-run report (safe metadata only).
- Browser UAT notes and signed acceptance stored securely outside public repo.
- Backup/restore evidence and rollback plan stored privately; GitHub contains only sanitized summary.
- Cutover checklist: company accounts, endpoints, environment isolation, role checks, data integrity, legacy reservations, Nov draft audit, recovery drill, comms plan, admin sign-off.

## Do not do
- Do not reset/drop Supabase LOCAL, overwrite October imports, regenerate November, mark future attendance, auto-approve 6/5 cases, assume a guardian identity, manufacture makeup entitlements or merge to main without authorization.
- Do not create an IRIS dependency, use service-role in browser, expose auth tokens or PII, or run migration against a company cloud project without an explicit approval and rollback plan.
- Do not treat this plan, GitHub passing CI or existing READINESS UI as approval to serve actual students.

## Starting references
- docs/admin-go-live-readiness.md
- docs/production-cutover-runbook.md
- docs/legacy-mtdc-seat-reconciliation.md
- docs/academic-calendar-v1.md
- /readiness, /readiness/november, /readiness/uat, /readiness/recovery
- GitHub PR #1 and latest GitHub Actions
