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

## Correction after first real Native Runtime restore failure (2026-10-25)

The original raw `pg_dump` includes Supabase-managed platform schemas such as `realtime`.
The initial real restore failed on `realtime.list_changes` with
`permission denied to set parameter "log_min_messages"`.
This is not evidence of archive corruption: the SHA-256 matched, but the
**real restore remains UNVERIFIED**.

The `verify-local-restore.sh` script now checks pg_restore's table of contents
and refuses archives containing managed Supabase schemas *before writing* to a
disposable target. CI continues to test full archive restore with a simple
application-only synthetic database, which does not prove Supabase recovery.

`backup-local-staging.sh` now retains both the complete private archival
`database.dump` and an additional `application-public.dump` containing only
app-owned public objects, with its own checksum. **Neither is a full portable
Supabase recovery artifact**: the app-only dump is missing Auth identity data,
Storage object bytes, Realtime and platform configuration.

Correct real recovery requires a **separately initialized Supabase runtime**
with managed `auth`, `realtime`, `storage`, roles and extensions,
and a Supabase-aware logical export/restore sequence with separately
planned users, identities and file/object storage. See
[Supabase Backup & Restore using CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
Do not restore platform internal functions into bare PostgreSQL, grant
privileges to silence the error, or remove checks merely to get green counts.

The first failed `--single-transaction --exit-on-error` restore should have
rolled back changes to the disposable drill DB. Check that with a read-only
catalog query before attempting any other recovery drill. Never reset the
actual local database containing November's imported draft.

## Source vs recovery lab preflight (after 24 migrations installed)

Run only from the NextGen source repository with BOTH stacks running:

```bash
cd ~/Sites/nextgen-management-system
export NEXTGEN_LOCAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:24080/postgres"
export NEXTGEN_RECOVERY_LAB_URL="postgresql://postgres:postgres@127.0.0.1:25196/postgres"
bash scripts/recovery-lab-preflight.sh .local-backups/snapshot-20261025T074148Z-cZNJ1t
```

The script performs **no writes**. It validates localhost ports, both private archive checksums, public-only archive contents, read-only aggregate source and lab counts, 24 lab migrations, 21 lab public tables, no existing student/Auth rows and the `on_auth_user_created` trigger. It intentionally leaves migrated seed branches/programmes/templates intact; do not import application data on top of these seeded IDs without a proper plan. Treat failure as a stop condition.

The preflight does NOT restore any data or verify that user logins can be recovered.

## Lab-only real app data restore (not full Supabase recovery)

After the 24 migrations have been applied to the separately initialized Recovery Lab, and the read-only preflight passed, the operator can run:

```bash
cd ~/Sites/nextgen-management-system
export NEXTGEN_LOCAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:24080/postgres"
export NEXTGEN_RECOVERY_LAB_URL="postgresql://postgres:postgres@127.0.0.1:25196/postgres"
python3 scripts/restore-recovery-lab.py .local-backups/snapshot-20261025T074148Z-cZNJ1t
```

This is a **dry run by default**. It checks the source and target schema layouts, verifies archive hashes, checks target has no existing business/Auth identities, and selects **only** the archived `TABLE DATA` for 21 public tables plus `auth.users` and `auth.identities`. The original full dump is **never replayed as schema**, so managed Realtime functions will not be re-created. It intentionally excludes live session/refresh tokens, Auth MFA data and Storage/R2 files.

To perform the isolated Recovery Lab data restore **after reviewing dry-run output**, add `--apply`. It executes a *single PostgreSQL transaction* (psql `-1`): precondition checks, replaces only seeded application rows, temporarily uses `SET LOCAL session_replication_role=replica` to prevent duplicate profile triggers, imports selected Auth/application data, switches trigger behavior back, validates aggregate snapshot baselines and checks all relevant foreign-key relationships. Any error aborts the full transaction, including the seed cleanup. It only targets localhost port 25196 and never writes to the source 24080.

After the transactional import passes:

```bash
python3 scripts/compare-recovery-lab.py
```

This **read-only** script compares counts and canonical row-content fingerprints for all 21 public tables plus two Auth tables against the **current LIVE source database** without exposing values. Source changes since the snapshot can cause mismatches; they must be investigated or a fresh backup taken, not dismissed.

**Still pending**: actual login and role-policy UAT, Auth MFA/session configuration, Storage/R2 object bytes, and recovery with compatible production secrets/configuration. This flow establishes an application-data/UUID recovery drill only, not a certified full disaster-recovery restore.
