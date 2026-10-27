#!/usr/bin/env bash
# READ-ONLY, AGGREGATE-ONLY readiness audit of the LOCAL Supabase database (127.0.0.1:24080).
# Never prints names, phones, emails or credentials. Never writes to the database.
#
#   NEXTGEN_LOCAL_DATABASE_URL='postgresql://postgres:<password>@127.0.0.1:24080/postgres' \
#     bash scripts/audit-local-readiness.sh [output.md]
#
# Optional: pass an output path (e.g. docs/release-evidence/nextgen-local-readiness.md).
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for bin in python3 psql; do command -v "$bin" >/dev/null || { echo "Missing $bin" >&2; exit 1; }; done
python3 "$ROOT/scripts/local-backup-guard.py" source      # refuses anything but 127.0.0.1:24080/postgres
OUT="${1:-}"
CSV="$(mktemp)"; trap 'rm -f "$CSV"' EXIT
# Session-level read-only AND an explicit read-only transaction: two independent write blocks.
PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000' \
  psql -X -q -v ON_ERROR_STOP=1 --csv -d "$NEXTGEN_LOCAL_DATABASE_URL" \
  -c 'begin read only' -f "$ROOT/scripts/sql/local-readiness-audit.sql" -c 'rollback' > "$CSV"
python3 - "$CSV" "$OUT" <<'PY'
import csv, sys, datetime, collections
rows = list(csv.DictReader(open(sys.argv[1], newline="")))
if not rows:
    sys.exit("Audit returned no rows; do not treat as PASS")
counts = collections.Counter(r["status"] for r in rows)
lines = [f"# NextGen local readiness audit",
         "",
         f"Generated: {datetime.datetime.now().astimezone().isoformat(timespec='seconds')} (local database 127.0.0.1:24080, read-only, aggregate-only)",
         "",
         "Summary: " + ", ".join(f"{k}={counts[k]}" for k in ("PASS","FAIL","WARN","PENDING","UNKNOWN","INFO") if counts[k]),
         "",
         "A clean run is NOT production readiness. UNKNOWN means it must be checked by a human or outside the database.",
         ""]
sec = None
for r in rows:
    if r["sec"] != sec:
        sec = r["sec"]; lines += ["", f"## Section {sec}", "", "| id | status | check | actual | expected | note |", "|---|---|---|---|---|---|"]
    cell = lambda v: (v or "").replace("|", "/").replace("\n", " ")
    lines.append(f"| {r['id']} | **{r['status']}** | {cell(r['title'])} | {cell(r['actual'])} | {cell(r['expected'])} | {cell(r['note'])} |")
text = "\n".join(lines) + "\n"
print(text)
if len(sys.argv) > 2 and sys.argv[2]:
    open(sys.argv[2], "w").write(text)
    print(f"Saved: {sys.argv[2]}", file=sys.stderr)
bad = counts["FAIL"]
print(f"Exit hint: {bad} FAIL, {counts['WARN']} WARN, {counts['PENDING']} PENDING, {counts['UNKNOWN']} UNKNOWN", file=sys.stderr)
PY
