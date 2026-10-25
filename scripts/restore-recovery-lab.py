#!/usr/bin/env python3
"""Restore snapshot app rows + basic Auth users/identities to ISOLATED native lab.

NEVER runs against the source. Replays only TABLE DATA and SEQUENCE SET, never
schema/functions/policies from raw pg_dump. One transaction with FK verification.
This is NOT complete Auth (sessions/MFA) or Storage file recovery.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

SOURCE_PORT, LAB_PORT = 24080, 25196
ARCHIVE_RE = re.compile(r"^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA (public|auth) ([a-z][a-z0-9_]*)\s")
SEQ_RE = re.compile(r"^\s*\d+;\s+\d+\s+\d+\s+SEQUENCE SET public ([a-z][a-z0-9_]*)\s")
APP_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")

def run(args, *, capture=True, **kwargs):
    proc = subprocess.run(args, text=True, capture_output=capture, **kwargs)
    if proc.returncode:
        if capture:
            # Commands only report errors, never dump payload SQL to console.
            sys.stderr.write('Database tool returned an error. Details withheld to protect private backup rows.\n')
        raise RuntimeError(f"Command failed: {args[0]}")
    return proc.stdout if capture else ""

def db_url(env, expected_port):
    url = os.getenv(env, "")
    if not url:
        sys.exit(f"Missing {env}")
    try:
        u = urlsplit(url)
        valid = (u.scheme in ("postgres", "postgresql") and
                 u.hostname in ("127.0.0.1", "localhost") and
                 u.port == expected_port and u.path == "/postgres" and
                 u.username == "postgres" and not u.query and not u.fragment)
    except ValueError:
        valid = False
    if not valid:
        sys.exit(f"REFUSED {env}: expected postgres on 127.0.0.1:{expected_port}/postgres")
    return url

def query(url, sql):
    return run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",url,"-c",sql]).strip()

def sha256_file(path):
    """Stream a checksum in fixed-size chunks, including on macOS Python 3.9/3.10.

    hashlib.file_digest was added in Python 3.11 and cannot be assumed on Macs.
    """
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def snapshot_path(repo_root, raw):
    root = (repo_root / ".local-backups").resolve()
    snap = Path(raw).resolve()
    if root not in snap.parents or not snap.is_dir() or snap.is_symlink():
        sys.exit("REFUSED: snapshot must be an owned .local-backups/snapshot-* directory")
    if not snap.name.startswith("snapshot-"):
        sys.exit("REFUSED: invalid snapshot directory name")
    for name, checksum in (("database.dump","sha256.txt"),
                           ("application-public.dump","application-sha256.txt")):
        content = (snap / name)
        digest = (snap / checksum)
        if not content.is_file() or content.is_symlink() or not digest.is_file():
            sys.exit(f"REFUSED: missing private backup/checksum {name}")
        expected = digest.read_text().split()[0]
        current = sha256_file(content)
        if current != expected:
            sys.exit(f"REFUSED: archive integrity failed: {name}")
    base = json.loads((snap / "baseline.json").read_text())
    return snap, base

def public_tables(url):
    rows = query(url, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
    names = [x for x in rows.splitlines() if x]
    if not all(APP_NAME_RE.fullmatch(x) for x in names):
        sys.exit("Unexpected public table identifier")
    return names

def column_fingerprint(url):
    sql = """SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,
     format_type(a.atttypid,a.atttypmod),a.attnotnull)
     ORDER BY n.nspname,c.relname,a.attnum),'[]'::jsonb)::text
     FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
     AND (n.nspname='public' OR (n.nspname='auth' AND c.relname IN ('users','identities')))"""
    return json.loads(query(url, sql))

def check_lab_empty(lab):
    sql = """SELECT json_build_object(
        'auth_users',(SELECT count(*) FROM auth.users),
        'auth_identities',(SELECT count(*) FROM auth.identities),
        'schema_migrations',(SELECT count(*) FROM supabase_migrations.schema_migrations),
        'trigger',(SELECT count(*) FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created'),
        'business_rows',(SELECT coalesce(sum(n_live_tup),0)::bigint FROM pg_stat_user_tables
                         WHERE schemaname='public' AND relname NOT IN ('branches','programmes','session_templates'))
    )::text"""
    status = json.loads(query(lab,sql))
    # Accurate rather than approximate statistics for critical non-seeded tables.
    if status["auth_users"] != 0 or status["auth_identities"] != 0:
        sys.exit("STOP: Recovery Lab already contains Auth identities")
    if status["schema_migrations"] != 24 or status["trigger"] != 1:
        sys.exit("STOP: Recovery Lab migration/trigger mismatch")
    others = [t for t in public_tables(lab) if t not in ("branches","programmes","session_templates")]
    for table in others:
        if int(query(lab, f'SELECT count(*) FROM public."{table}"')) != 0:
            sys.exit(f"STOP: Recovery Lab contains business rows in {table}")
    return status

def selected_toc(archive, app_tables):
    lines = run(["pg_restore","--list",str(archive)]).splitlines()
    seen = set()
    selected = []
    for line in lines:
        m = ARCHIVE_RE.match(line)
        if m:
            schema,table = m.groups()
            if schema == "public" and table in app_tables or schema == "auth" and table in ("users","identities"):
                seen.add((schema,table))
                selected.append(line)
            continue
        if SEQ_RE.match(line):
            selected.append(line)
    expected = {("public",t) for t in app_tables}|{("auth","users"),("auth","identities")}
    if seen != expected or len(seen) != len([x for x in selected if ARCHIVE_RE.match(x)]):
        missing = sorted(expected-seen)
        extra = sorted(seen-expected)
        sys.exit(f"STOP: snapshot TABLE DATA coverage mismatch: missing={missing} extra={extra}")
    return selected

def build_guard(tables, baseline):
    # Precheck and seed cleanup run under the SAME transaction as the import.
    quoted = ",".join('public."'+t+'"' for t in tables)
    checks = [
        ("students", "SELECT count(*) FROM public.students"),
        ("parents", "SELECT count(*) FROM public.parents"),
        ("active_enrollments", "SELECT count(*) FROM public.enrollments WHERE status='active'"),
        ("september_source_rows", "SELECT count(*) FROM public.legacy_september_evidence WHERE source_batch='mtdc-2026-09'"),
        ("october_source_rows", "SELECT count(*) FROM public.legacy_replacement_reviews WHERE source_batch='mtdc-2026-10'"),
        ("november_classes", "SELECT count(*) FROM public.class_sessions s JOIN public.schedule_batches b ON b.id=s.schedule_batch_id WHERE b.schedule_month='2026-11-01'"),
        ("november_bookings", "SELECT count(*) FROM public.student_bookings bk JOIN public.class_sessions s ON s.id=bk.class_session_id JOIN public.schedule_batches b ON b.id=s.schedule_batch_id WHERE b.schedule_month='2026-11-01'"),
    ]
    for key,_ in checks:
        if not isinstance(baseline.get(key),int):
            sys.exit(f"Missing numeric snapshot baseline: {key}")
    before = """DO $check$
    BEGIN
      IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 24
       OR (SELECT count(*) FROM pg_tables WHERE schemaname='public') <> 21
       OR (SELECT count(*) FROM auth.users) <> 0
       OR (SELECT count(*) FROM auth.identities) <> 0
       OR (SELECT count(*) FROM pg_trigger
          WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created') <> 1
      THEN RAISE EXCEPTION 'Recovery target not fresh, correct schema or Auth trigger'; END IF;
    END $check$;
    """
    after = "\n".join(
        f"IF ({query_sql}) <> {baseline[key]} THEN RAISE EXCEPTION 'Snapshot baseline mismatch: {key}'; END IF;"
        for key, query_sql in checks
    )
    # Validate all actual FK relationships, even though restore briefly runs
    # with session_replication_role=replica to prevent double profile insertion.
    after += """
    IF EXISTS (SELECT 1 FROM public.profiles p LEFT JOIN auth.users u ON p.id=u.id
       WHERE u.id IS NULL) THEN RAISE EXCEPTION 'Orphan profile'; END IF;
    """
    fk = r"""
    DO $foreign_keys$
    DECLARE c record; join_sql text; notnull_sql text; ref_col text; broken boolean;
    BEGIN
      FOR c IN SELECT con.oid, con.conrelid, con.confrelid, con.conkey, con.confkey
        FROM pg_constraint con JOIN pg_namespace n ON n.oid=con.connamespace
        WHERE con.contype='f' AND con.conrelid IN (
           SELECT cl.oid FROM pg_class cl JOIN pg_namespace ns ON ns.oid=cl.relnamespace
           WHERE ns.nspname='public' OR (ns.nspname='auth' AND cl.relname IN ('users','identities')))
      LOOP
        SELECT string_agg(format('s.%I = t.%I',sa.attname,ta.attname),' AND ' ORDER BY k.ord),
               string_agg(format('s.%I IS NOT NULL',sa.attname),' AND ' ORDER BY k.ord),
               (array_agg(ta.attname ORDER BY k.ord))[1]
          INTO join_sql,notnull_sql,ref_col
        FROM unnest(c.conkey,c.confkey) WITH ORDINALITY k(sa,ta,ord)
        JOIN pg_attribute sa ON sa.attrelid=c.conrelid AND sa.attnum=k.sa
        JOIN pg_attribute ta ON ta.attrelid=c.confrelid AND ta.attnum=k.ta;
        EXECUTE format('SELECT exists(SELECT 1 FROM %s s LEFT JOIN %s t ON %s WHERE (%s) AND t.%I IS NULL)',
            c.conrelid::regclass,c.confrelid::regclass,join_sql,notnull_sql,ref_col)
          INTO broken;
        IF broken THEN RAISE EXCEPTION 'Foreign key validation failed: %',c.conrelid::regclass; END IF;
      END LOOP;
    END $foreign_keys$;
    """
    return (
        before + "\nTRUNCATE TABLE "+quoted+" RESTART IDENTITY;\n",
        "DO $baseline$ BEGIN\n"+after+"\nEND $baseline$;\n"+fk,
    )

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("snapshot",help="private .local-backups/snapshot-* folder")
    parser.add_argument("--apply",action="store_true",help="explicitly perform isolated lab-only transaction")
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    source=db_url("NEXTGEN_LOCAL_DATABASE_URL",SOURCE_PORT)
    lab=db_url("NEXTGEN_RECOVERY_LAB_URL",LAB_PORT)
    snap,baseline=snapshot_path(root,args.snapshot)
    table_names=public_tables(lab)
    if len(table_names)!=21:
        sys.exit("STOP: wrong public-table count in Recovery Lab")
    if public_tables(source)!=table_names:
        sys.exit("STOP: public table list differs between source and Recovery Lab")
    if column_fingerprint(source)!=column_fingerprint(lab):
        sys.exit("STOP: source/recovery columns differ; cannot safely copy Auth + app data")
    check_lab_empty(lab)
    # Basic Auth clone intentionally omits MFA/SSO tables. Refuse to silently
    # downgrade existing non-password accounts in the recovery environment.
    for protected in ("mfa_factors","sso_providers"):
        present = query(source,"SELECT to_regclass('auth."+protected+"') IS NOT NULL")
        if present == "t":
            count = int(query(source,'SELECT count(*) FROM auth."'+protected+'"'))
            if count:
                sys.exit("STOP: source uses MFA/SSO; this basic Auth restoration plan is insufficient")
    toc=selected_toc(snap/"database.dump",set(table_names))
    print("READ-ONLY RESTORE PLAN")
    print("  Source archive: verified private snapshot")
    print("  Destination: 127.0.0.1:25196/postgres only")
    print("  Selected: 21 public tables + auth.users + auth.identities (data only)")
    print("  Auth tokens/sessions, MFA settings, Storage/R2 bytes: NOT restored")
    print("  Migration seed rows: replaced inside one rollback-safe transaction")
    print("  Realtime/auth/storage schema definitions: NEVER replayed")
    print("  No credentials, identities or row contents will be printed")
    if not args.apply:
        print("DRY RUN PASSED: no writes. Re-run with --apply to execute isolated recovery.")
        return
    with tempfile.TemporaryDirectory(prefix="recovery-work-",dir=root/".local-backups") as tmp:
        temp=Path(tmp)
        os.chmod(temp,0o700)
        toc_file=temp/"selected.toc"
        toc_file.write_text("\n".join(toc)+"\n")
        payload=temp/"data.sql"
        run(["pg_restore","--no-owner","--no-acl","--data-only",
             "--use-list",str(toc_file),"--file",str(payload),str(snap/"database.dump")])
        prepare,verify=build_guard(table_names,baseline)
        (temp/"pre.sql").write_text(prepare)
        (temp/"verify.sql").write_text(verify)
        for file in temp.iterdir():
            os.chmod(file,0o600)
        print("Importing into isolated Recovery Lab as ONE transaction...")
        # -1 wraps all -c/-f operations in a single BEGIN/COMMIT.
        # A bad INSERT, FK or baseline aborts every write, even seed truncation.
        run(["psql","-X","-q","-1","-v","ON_ERROR_STOP=1","-d",lab,
             "-f",str(temp/"pre.sql"),
             "-c","SET LOCAL session_replication_role = replica",
             "-f",str(payload),
             "-c","SET LOCAL session_replication_role = origin",
             "-f",str(temp/"verify.sql")],capture=True)
    print("LAB IMPORT TRANSACTION COMMITTED; counts and foreign keys passed.")
    print("Not yet full recovery: Auth login, MFA/session behavior, Storage/R2 and row-level comparison remain.")
    print("DO NOT reset or regenerate the original NextGen database.")

if __name__=="__main__":
    try:
        main()
    except (RuntimeError,subprocess.CalledProcessError) as error:
        sys.exit("STOP: recovery aborted or not verified. "+str(error))
