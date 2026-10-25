#!/usr/bin/env bash
# READ-ONLY source/recovery-lab preflight. Never imports, deletes or changes data.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${1:?Usage: bash scripts/recovery-lab-preflight.sh .local-backups/snapshot-...}"
for cmd in python3 psql pg_restore; do
    command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }
done
: "${NEXTGEN_LOCAL_DATABASE_URL:?Set NEXTGEN_LOCAL_DATABASE_URL for original local source}"
: "${NEXTGEN_RECOVERY_LAB_URL:?Set NEXTGEN_RECOVERY_LAB_URL for separate recovery stack}"

# Never accept guessed or remote database endpoints; compare two distinct ports.
python3 - <<'PY'
import os,sys
from urllib.parse import urlsplit
source=urlsplit(os.environ["NEXTGEN_LOCAL_DATABASE_URL"])
lab=urlsplit(os.environ["NEXTGEN_RECOVERY_LAB_URL"])
checks=[
 ("source",source,"24080"),
 ("lab",lab,"25196"),
]
for name,u,port in checks:
    if u.scheme not in ("postgresql","postgres") or u.hostname not in ("127.0.0.1","localhost") or str(u.port)!=port or u.path!="/postgres":
        sys.exit(f"REFUSED: {name} must be 127.0.0.1:{port}/postgres; no cloud and no other DB.")
if source.geturl()==lab.geturl():
    sys.exit("REFUSED: source and lab are the same URL")
print("Isolation confirmed: source 127.0.0.1:24080 → lab 127.0.0.1:25196 (READ-ONLY)")
PY

python3 - "$ROOT" "$1" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1]).resolve()/".local-backups"
snapshot=Path(sys.argv[2]).resolve()
if root not in snapshot.parents or not snapshot.is_dir():
    sys.exit("REFUSED: snapshot must be a private directory in NextGen .local-backups/")
for file in ("database.dump","application-public.dump","sha256.txt","application-sha256.txt","baseline.json"):
    if not (snapshot/file).is_file():
        sys.exit(f"REFUSED: snapshot missing {file}")
import hashlib
for filename,checksum in (("database.dump","sha256.txt"),("application-public.dump","application-sha256.txt")):
    expected=(snapshot/checksum).read_text().split()[0]
    actual=hashlib.sha256((snapshot/filename).read_bytes()).hexdigest()
    if actual!=expected:
        sys.exit(f"REFUSED: checksum mismatch for {filename}")
print("Both private snapshot archives passed SHA-256 checks")
PY
SNAP="$(cd "$1" && pwd)"
# Read archive TOCs only, never replay raw Supabase-managed internal schema objects.
pg_restore --list "$SNAP/database.dump" >/dev/null
# The app archive must have no managed platform schema entry.
pg_restore --list "$SNAP/application-public.dump" | python3 "$ROOT/scripts/validate-restore-archive.py"

SOURCE_META="$(psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$NEXTGEN_LOCAL_DATABASE_URL" -c "
 select json_build_object(
 'postgres_version',current_setting('server_version'),
 'auth_users',(select count(*) from auth.users),
 'auth_identities',(select count(*) from auth.identities),
 'profiles',(select count(*) from public.profiles),
 'students',(select count(*) from public.students),
 'parents',(select count(*) from public.parents),
 'active_enrollments',(select count(*) from public.enrollments where status='active'),
 'september_evidence',(select count(*) from public.legacy_september_evidence),
 'october_sources',(select count(*) from public.legacy_replacement_reviews),
 'november_classes',(select count(*) from public.class_sessions cs join public.schedule_batches b on b.id=cs.schedule_batch_id where b.schedule_month='2026-11-01'),
 'november_bookings',(select count(*) from public.student_bookings bk join public.class_sessions cs on bk.class_session_id=cs.id join public.schedule_batches b on b.id=cs.schedule_batch_id where b.schedule_month='2026-11-01'),
 'orphan_profiles',(select count(*) from public.profiles p left join auth.users u on p.id=u.id where u.id is null),
 'profile_auth_trigger',(select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created')
 )::text")"
LAB_META="$(psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$NEXTGEN_RECOVERY_LAB_URL" -c "
 select json_build_object(
 'postgres_version',current_setting('server_version'),
 'auth_users',(select count(*) from auth.users),
 'auth_identities',(select count(*) from auth.identities),
 'profiles',(select count(*) from public.profiles),
 'students',(select count(*) from public.students),
 'parents',(select count(*) from public.parents),
 'enrollments',(select count(*) from public.enrollments),
 'class_sessions',(select count(*) from public.class_sessions),
 'student_bookings',(select count(*) from public.student_bookings),
 'september_evidence',(select count(*) from public.legacy_september_evidence),
 'october_sources',(select count(*) from public.legacy_replacement_reviews),
 'migration_count',(select count(*) from supabase_migrations.schema_migrations),
 'public_tables',(select count(*) from pg_tables where schemaname='public'),
 'seed_branches',(select count(*) from public.branches),
 'seed_programmes',(select count(*) from public.programmes),
 'seed_templates',(select count(*) from public.session_templates),
 'profile_auth_trigger',(select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created')
 )::text")"
python3 - "$SOURCE_META" "$LAB_META" <<'PY'
import json,sys
src,lab=(json.loads(x) for x in sys.argv[1:])
print("\nSOURCE (aggregate counts only):")
for k,v in src.items(): print(f"  {k}: {v}")
print("\nRECOVERY LAB (aggregate counts only):")
for k,v in lab.items(): print(f"  {k}: {v}")
required_empty=("auth_users","auth_identities","profiles","students","parents",
                "enrollments","class_sessions","student_bookings","september_evidence","october_sources")
nonempty={k:lab.get(k) for k in required_empty if lab.get(k)!=0}
if nonempty:
    sys.exit("STOP: recovery lab has existing user or imported records. No restore may proceed.")
if lab.get("migration_count")!=24 or lab.get("public_tables")!=21:
    sys.exit("STOP: recovery lab schema is not the expected 24 migrations / 21 public tables.")
if src.get("orphan_profiles")!=0:
    sys.exit("STOP: source profiles have missing Auth user references.")
if src.get("profile_auth_trigger")!=1 or lab.get("profile_auth_trigger")!=1:
    sys.exit("STOP: Auth profile trigger differs from expected; import order needs review.")
print("\nPASS: recovery preflight only. ZERO database writes; restore is NOT yet verified.")
print("WARNING: Lab has migrated seed branches/programmes/templates. A blind app dump import will conflict.")
PY
