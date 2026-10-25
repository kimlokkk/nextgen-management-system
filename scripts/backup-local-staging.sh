#!/usr/bin/env bash
# Backup ONLY NextGen's local Native Runtime. No cloud connection is supported.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for bin in python3 pg_dump pg_restore psql; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing $bin. On macOS: brew install libpq; export PATH=\"\$(brew --prefix libpq)/bin:\$PATH\"" >&2
    exit 1
  fi
done
python3 "$ROOT/scripts/local-backup-guard.py" source
STORE="$ROOT/.local-backups"
if [ -L "$STORE" ]; then echo "Refusing symlink backup destination" >&2; exit 1; fi
mkdir -p "$STORE"
chmod 700 "$STORE"
DIR="$(mktemp -d "$STORE/snapshot-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
cleanup() { if [ "${COMPLETE:-0}" != "1" ]; then rm -rf -- "$DIR"; fi; }
trap cleanup EXIT
echo "Saving encrypted-at-rest-location-sensitive database snapshot in local ignored folder..."
pg_dump --format=custom --no-owner --no-acl --dbname="$NEXTGEN_LOCAL_DATABASE_URL" --file="$DIR/database.dump"
pg_restore --list "$DIR/database.dump" >/dev/null
psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$NEXTGEN_LOCAL_DATABASE_URL" \
  -f "$ROOT/scripts/cutover-baseline.sql" > "$DIR/baseline.json"
python3 - "$DIR" <<'PY'
import hashlib, json, pathlib, sys
p=pathlib.Path(sys.argv[1])
data=p.joinpath("database.dump").read_bytes()
baseline=json.loads(p.joinpath("baseline.json").read_text())
p.joinpath("sha256.txt").write_text(hashlib.sha256(data).hexdigest()+"  database.dump\n")
p.joinpath("manifest.json").write_text(json.dumps({
    "purpose":"LOCAL STAGING recovery evidence only, not proof of cloud readiness",
    "contains_private_data":True, "bytes":len(data),
    "baseline_metrics":baseline,
}, indent=2)+"\n")
PY
chmod 600 "$DIR"/*
COMPLETE=1
echo "Backup complete (private): $DIR"
echo "Restore must be tested in a separate, empty nextgen_restore_drill_* database."
