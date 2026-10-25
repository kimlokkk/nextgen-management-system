#!/usr/bin/env python3
"""Fail closed for raw pg_restore archives containing Supabase-managed schemas."""
import re
import sys

managed = {"auth", "realtime", "storage", "vault", "supabase_migrations",
           "supabase_functions", "graphql_public", "graphql", "extensions",
           "cron", "net", "_realtime"}
hits = set()
entries = 0
for line in sys.stdin:
    if not re.match(r"^\s*\d+;", line):
        continue
    entries += 1
    for schema in managed:
        if re.search(r"(?<![a-zA-Z0-9_])" + re.escape(schema) + r"(?![a-zA-Z0-9_])", line):
            hits.add(schema)
if not entries:
    sys.exit("Empty/invalid pg_restore TOC; refusing restore")
if hits:
    print(
      "STOP: This full backup contains Supabase-managed schemas: " + ", ".join(sorted(hits)) + ".\n"
      "A raw platform dump is NOT directly restorable into an empty ordinary PostgreSQL database.\n"
      "No recovery has been verified; no restore attempted by this script.\n"
      "Do not bypass by changing server privileges, skipping managed functions, or using --clean.\n"
      "See docs/production-cutover-runbook.md for a Supabase-compatible recovery strategy.",
      file=sys.stderr)
    sys.exit(2)
print("App-only archive: no managed Supabase schemas detected")
