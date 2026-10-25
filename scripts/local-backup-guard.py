#!/usr/bin/env python3
"""Validate local-only Postgres connection settings without printing credentials."""
import os
import sys
from urllib.parse import urlsplit

kind = sys.argv[1] if len(sys.argv) > 1 else ""
env_key = "NEXTGEN_LOCAL_DATABASE_URL" if kind == "source" else "NEXTGEN_RESTORE_DRILL_URL"
uri = os.getenv(env_key, "")
if not uri:
    sys.exit(f"Missing {env_key}")
try:
    parsed = urlsplit(uri)
    host, port, name = parsed.hostname, parsed.port, parsed.path.removeprefix("/")
except ValueError:
    sys.exit("Invalid PostgreSQL connection URL")
allowed_port = {24080, 5432} if os.getenv("CI") == "true" else {24080}
if parsed.scheme not in ("postgres", "postgresql") or host not in ("127.0.0.1", "localhost") or port not in allowed_port:
    sys.exit("Refusing non-local database. Expected 127.0.0.1:24080 (5432 in isolated CI only).")
if kind == "source" and name != "postgres":
    sys.exit("Local source must be the postgres database")
if kind == "restore" and not name.startswith("nextgen_restore_drill_"):
    sys.exit("Restore target must have a dedicated nextgen_restore_drill_* database name")
if kind not in ("source", "restore"):
    sys.exit("Specify source or restore")
print(f"Verified local {kind} endpoint: {host}:{port}/{name}")
