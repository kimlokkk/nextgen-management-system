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
# Portable application-only schema backup, in addition to the complete
# forensic archive. Auth, Storage object bytes and platform config are separate.
pg_dump --format=custom --no-owner --no-acl --schema=public \
  --dbname="$NEXTGEN_LOCAL_DATABASE_URL" --file="$DIR/application-public.dump"
pg_restore --list "$DIR/application-public.dump" >/dev/null
psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$NEXTGEN_LOCAL_DATABASE_URL" \
  -f "$ROOT/scripts/cutover-baseline.sql" > "$DIR/baseline.json"
python3 - "$DIR" <<'PY'
import hashlib, json, pathlib, sys
p=pathlib.Path(sys.argv[1])
data=p.joinpath("database.dump").read_bytes()
baseline=json.loads(p.joinpath("baseline.json").read_text())
p.joinpath("sha256.txt").write_text(hashlib.sha256(data).hexdigest()+"  database.dump\n")
app=p.joinpath("application-public.dump").read_bytes()
p.joinpath("application-sha256.txt").write_text(hashlib.sha256(app).hexdigest()+"  application-public.dump\n")
p.joinpath("manifest.json").write_text(json.dumps({
    "purpose":"LOCAL STAGING recovery evidence only, not proof of cloud readiness",
    "contains_private_data":True, "bytes":len(data),
    "application_public_archive_bytes":len(app),
    "application_public_archive_is_NOT_complete_recovery":True,
    "baseline_metrics":baseline,
}, indent=2)+"\n")
PY
chmod 600 "$DIR"/*
COMPLETE=1
echo "Backup complete (private): $DIR"
echo "Full snapshot saved, but Supabase internals cannot be replayed into blank PostgreSQL."
echo "Also saved application-public.dump (does not include Auth, managed schemas or Storage bytes)."
echo "Real recovery requires a separate initialized Supabase-compatible environment."
