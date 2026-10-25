# NextGen — Production cutover & disaster-recovery runbook

**Release state: NOT APPROVED.** All September/October imports and 48-class/356-booking November draft are **Supabase Local**, not hosted production.

## A. Local recovery snapshot (operator-only)
Requires PostgreSQL client binaries `pg_dump`, `pg_restore`, `psql`, plus Python 3.
On macOS, `brew install libpq` and `export PATH="$(brew --prefix libpq)/bin:$PATH"`.
`NEXTGEN_LOCAL_DATABASE_URL` must point to the Native Runtime's local 127.0.0.1:24080 **postgres** database.

```bash
export NEXTGEN_LOCAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:24080/postgres"
bash scripts/backup-local-staging.sh
```

Outputs a **custom-format PostgreSQL database dump**, SHA-256, manifest and aggregate-only counts under `/.local-backups/snapshot-.../`. This directory is gitignored and permissions are restricted; **the dump still contains private student, guardian and possibly Auth data**. Store offline and restrict access. Do not upload the dump, manifest or screenshots containing PII to GitHub/ChatGPT.

**Do not restore this dump into the existing local NextGen database.** Test restore only in an independently provisioned, empty `nextgen_restore_drill_*` database with matching required extensions/roles. The verifier checks connection locality, target naming, checksum, pre-existing objects, and compares aggregate baselines:

```bash
export NEXTGEN_RESTORE_DRILL_URL="postgresql://postgres:postgres@127.0.0.1:24080/nextgen_restore_drill_one"
bash scripts/verify-local-restore.sh .local-backups/snapshot-.../
```

The target database must **already exist** and be disposable/empty. The script never creates, drops, clears or overwrites a database. A Supabase-specific full dump may require a restore environment with equivalent Auth, Storage and extensions: if the restore fails, mark the gate *failed*, fix environment compatibility in a disposable clone, **never disable safety checks to force a pass**. Database dump alone does not back up object bytes in Supabase Storage or Cloudflare R2.

The GitHub `Backup/restore safety drill` CI job tests a separate **synthetic** database, guards and checksum. It does *not* prove the real MTDC snapshot can be restored.

## B. Freeze & baseline before cutover
- Confirm the genuine admin is responsible for decisions. Hadi Ayyash guardian remains pending until the source identifies the relationship.
- Review the five October capacity exceptions; do not change entitlements or claim they are resolved merely to clear the UI.
- Record active student/parent/enrollment counts, 622 September source records, 81 October source records and **November 48 classes / 356 bookings** against source evidence. Counts are expected checkpoints from the local test, not guarantees about cloud.
- Take a **fresh backup**, successfully restore it in a compatible isolated clone, and record hashes and outcome in an approved secure operations log.
- Stop edits to local staging during final export; decide who is the single write authority and enforce downtime to avoid diverging data.

## C. Cloud deployment needs explicit authorization
1. Prepare a **new empty** hosted Supabase project with matching schema migrations, auth configuration, secrets and extensions. Verify permission policies and SQL functions; never use service-role keys in the browser.
2. Plan identity/foreign-key migration of local Auth users, students, guardians, enrollments, class sessions, bookings and legacy evidence. Preserve UUID links and audit history; do **not** blindly restore a local full dump over a managed production Supabase database.
3. Verify cloud migration with same aggregate counts **plus individual referential-integrity and booking checks**, then run administrator login, role restrictions, replacement/attendance and reconciliation acceptance.
4. Back up and separately migrate object **bytes** (Supabase Storage and/or Cloudflare R2) with access control. Database backups may store Storage metadata but not actual files.
5. Configure TLS/hosting, monitored jobs, messaging credentials (Merpati) and HTTPS callback endpoints. Keep outbound WhatsApp/invoice automation disabled until human approval.
6. Trial production restore and rollback procedure with an isolated clone; ensure backups have named owner, retention policy and periodic restore rehearsal.
7. Obtain **written admin sign-off** and a release window. Only then decide go/no-go, announce switch, and keep the pre-cutover snapshot.

**No script in this repo runs cloud migration or changes a live database.**

Sources: Supabase docs [Database Backups](https://supabase.com/docs/guides/platform/backups) and [Backup & Restore Using CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
