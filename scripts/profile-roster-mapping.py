#!/usr/bin/env python3
"""READ-ONLY, counts-only: learn how the October rosters map to session templates/enrollments in the LOCAL database.

  NEXTGEN_LOCAL_DATABASE_URL=... python3 scripts/profile-roster-mapping.py

Prints session-template CONFIG (day/time/programme/capacity: not personal data) and a crosstab of
(roster tab + block) -> template currently used by the matching student's active enrollment. No names are printed.
"""
import argparse, collections, csv, os, pathlib, subprocess, sys, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import nextgen_sources as S

ROOT = pathlib.Path(__file__).resolve().parent.parent
Q_TPL = """select coalesce(b.code,b.name) as branch, t.day_of_week as dow, to_char(t.start_time,'HH24:MI') as start,
 to_char(t.end_time,'HH24:MI') as finish, p.code as programme, coalesce(t.name,'') as name, t.is_active as active,
 t.regular_capacity as cap, t.replacement_capacity as ycap, t.id::text as id
 from public.session_templates t join public.branches b on b.id=t.branch_id join public.programmes p on p.id=t.programme_id order by 1,2,3,5"""
Q_ENR = """select s.full_name as student, coalesce(b.code,b.name) as branch, e.status, e.frequency_type as freq,
 coalesce(array_to_string(e.preferred_weeks,','),'') as weeks, e.default_session_id::text as tpl, p.code as programme
 from public.enrollments e join public.students s on s.id=e.student_id join public.branches b on b.id=e.branch_id
 join public.programmes p on p.id=e.programme_id"""

def psql_rows(sql):
    g = subprocess.run([sys.executable, str(ROOT / "scripts/local-backup-guard.py"), "source"], capture_output=True, text=True)
    if g.returncode: sys.exit(g.stderr.strip() or "Refusing: not the local main database")
    with tempfile.NamedTemporaryFile("w+", suffix=".csv") as tmp:
        env = dict(os.environ, PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=60000")
        r = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--csv", "-d", os.environ["NEXTGEN_LOCAL_DATABASE_URL"],
                            "-c", "begin read only", "-c", sql, "-c", "rollback"], env=env, stdout=tmp, stderr=subprocess.PIPE, text=True)
        if r.returncode: sys.exit("psql failed: " + r.stderr.strip()[:300])
        tmp.seek(0); return list(csv.DictReader(tmp))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--sources", default=str(ROOT / "private/sources"))
    ap.add_argument("--db-templates"); ap.add_argument("--db-enrollments")
    a = ap.parse_args()
    try: import openpyxl
    except ImportError: sys.exit("Missing openpyxl. Run: pip3 install --user openpyxl")
    tpl = list(csv.DictReader(open(a.db_templates))) if a.db_templates else psql_rows(Q_TPL)
    enr = list(csv.DictReader(open(a.db_enrollments))) if a.db_enrollments else psql_rows(Q_ENR)
    label = {t["id"]: f"{t['branch']} {['SUN','MON','TUE','WED','THU','FRI','SAT'][int(t['dow'])]} {t['start']}-{t['finish']} {t['programme']}" + (f" '{t['name']}'" if t["name"] else "") for t in tpl}
    print("== session templates (config) ==")
    for t in tpl: print(f"  {label[t['id']]} | cap {t['cap']} yellow {t['ycap']} | {'active' if t['active'] in ('t','true','True') else 'INACTIVE'}")
    by_student = collections.defaultdict(list)
    for e in enr:
        if e["status"] == "active": by_student[S.name_key(e["student"])].append(e)
    print("\n== active enrollments: frequency / preferred weeks (counts) ==")
    print("  ", dict(collections.Counter((e["branch"], e["freq"], e["weeks"] or "-") for es in by_student.values() for e in es)))
    print("  students with >1 active enrollment:", sum(1 for es in by_student.values() if len(es) > 1))
    for f, src in (("mtdc-oct.xlsx", "MTDC"), ("cyber-oct.xlsx", "CYBER")):
        rows, warn = S.parse_roster(openpyxl.load_workbook(pathlib.Path(a.sources) / f, data_only=True), src)
        print(f"\n== {src} October roster -> DB template (count of student rows) ==  warnings: {warn or 'none'}")
        x = collections.Counter()
        for r in rows:
            es = by_student.get(S.name_key(r["name"]), [])
            key = (r["tab"].strip(), r["block"] or "-")
            if not es: x[(key, "NO ACTIVE ENROLLMENT IN DB")] += 1
            for e in es: x[(key, label.get(e["tpl"], "?") if S.branch_of(e["branch"]) == src else f"(enrolled in other branch {e['branch']})")] += 1
        for (k, v), n in sorted(x.items()): print(f"  {k[0]:16} {k[1]:20} -> {v}  x{n}")
    print("\nCounts only. Nothing was written.")

main()
