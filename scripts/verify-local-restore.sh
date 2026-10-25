#!/usr/bin/env bash
# Only restores into an EMPTY, separately named LOCAL drill database.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${1:?Usage: NEXTGEN_RESTORE_DRILL_URL=<local drill database URL> bash scripts/verify-local-restore.sh .local-backups/snapshot-...}"
for bin in python3 psql pg_restore; do command -v "$bin" >/dev/null || { echo "Missing $bin" >&2; exit 1; }; done
python3 "$ROOT/scripts/local-backup-guard.py" restore
python3 - "$ROOT" "$1" <<'PY'
import pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve()/".local-backups"
path=pathlib.Path(sys.argv[2]).resolve()
if root not in path.parents or not path.is_dir():
    sys.exit("Restore input must be a snapshot directory in .local-backups")
for name in ("database.dump","sha256.txt","baseline.json"):
    if not (path/name).is_file():
        sys.exit(f"Missing required file: {name}")
PY
DIR="$(cd "$1" && pwd)"
python3 - "$DIR" <<'PY'
import hashlib, pathlib,sys
p=pathlib.Path(sys.argv[1])
actual=hashlib.sha256(p.joinpath("database.dump").read_bytes()).hexdigest()
expected=p.joinpath("sha256.txt").read_text().split()[0]
if actual!=expected: sys.exit("Checksum mismatch; refusing restore")
print("Backup SHA-256 verified")
PY
# Verify target is empty BEFORE issuing any restore. Do not use --clean or --create.
EXISTING="$(psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$NEXTGEN_RESTORE_DRILL_URL" -c "
  select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname not like 'pg_%' and n.nspname<>'information_schema'
  and c.relkind in ('r','p','v','m','f');
")"
if [ "$EXISTING" != "0" ]; then
  echo "Restore target has existing objects ($EXISTING). Refusing all changes." >&2
  exit 1
fi
pg_restore --exit-on-error --single-transaction --no-owner --no-acl \
  --dbname="$NEXTGEN_RESTORE_DRILL_URL" "$DIR/database.dump"
psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$NEXTGEN_RESTORE_DRILL_URL" \
  -f "$ROOT/scripts/cutover-baseline.sql" > "$DIR/restored-baseline.json"
python3 - "$DIR" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1])
before=json.loads(p.joinpath("baseline.json").read_text())
after=json.loads(p.joinpath("restored-baseline.json").read_text())
if before!=after:
    print("FAIL: restored cutover baseline differs")
    for key in sorted(set(before)|set(after)):
        if before.get(key)!=after.get(key): print(f"  {key}: {before.get(key)} != {after.get(key)}")
    sys.exit(1)
print("PASS: restored staging baseline matches original snapshot")
PY
echo "Keep the drill database isolated. Never use this script against local 'postgres' or cloud production."
