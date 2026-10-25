#!/usr/bin/env python3
"""Read-only per-table fingerprints of source now vs recovery lab.

No rows, emails, names, UUIDs, hashes or secrets are printed.
A mismatch may reflect source edits since the snapshot was taken; investigate.
"""
import os
import re
import subprocess
import sys
from urllib.parse import urlsplit

def url(name,port):
    val=os.getenv(name,"")
    try:
        parsed=urlsplit(val)
        good=parsed.scheme in ("postgres","postgresql") and parsed.username=="postgres" and parsed.hostname in ("127.0.0.1","localhost") and parsed.port==port and parsed.path=="/postgres" and not parsed.query
    except ValueError:
        good=False
    if not good:
        sys.exit(f"REFUSED: {name} must use local postgres on port {port}")
    return val

def sql(db,statement):
    res=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",db,"-c",statement],text=True,capture_output=True)
    if res.returncode: sys.exit(f"Cannot read database: {res.stderr[-300:]}")
    return res.stdout.strip()

source=url("NEXTGEN_LOCAL_DATABASE_URL",24080)
lab=url("NEXTGEN_RECOVERY_LAB_URL",25196)
tables=sql(lab,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1").splitlines()
if len(tables)!=21 or not all(re.fullmatch(r"[a-z][a-z0-9_]*",x) for x in tables):
    sys.exit("Recovery Lab schema is not the expected 21 application tables")
pairs=[("auth","users"),("auth","identities")]+[("public",t) for t in tables]
diffs=0
print("Comparing table counts and deterministic row-content fingerprints (no PII displayed):")
for schema,table in pairs:
    q=f"""SELECT count(*)::text || ':' ||
     md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' ORDER BY md5(to_jsonb(t)::text)),''))
     FROM "{schema}"."{table}" t"""
    a,b=sql(source,q),sql(lab,q)
    ca=a.split(":")[0];cb=b.split(":")[0]
    match=a==b
    print(f"  {schema}.{table}: source={ca} lab={cb} {'MATCH' if match else 'DIFFERENT'}")
    diffs+=not match
if diffs: sys.exit(f"{diffs} table(s) differ from LIVE local source. Snapshot timing or restore needs investigation.")
print("PASS: all 23 table fingerprints match the current local source.")
print("This does NOT verify MFA/session login, object Storage/R2 files or cloud deployment.")
