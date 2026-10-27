#!/usr/bin/env python3
"""Compare the source Google-Sheet exports with the LOCAL database. READ-ONLY, counts only.

  NEXTGEN_LOCAL_DATABASE_URL=... python3 scripts/compare-sources-to-local-db.py \
      [--sources private/sources] [--details private/compare-details.csv]

Needs: psql, python3, openpyxl (pip3 install --user openpyxl).
Prints only counts. `--details` writes a human-review CSV with names; it must live under private/ (git-ignored).
Test hook: --db-csv <file> reads the database extract from a CSV instead of running psql.
"""
import argparse, csv, os, re, subprocess, sys, tempfile, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXTRACT = """
select s.full_name as student, s.status as student_status, coalesce(b.code, b.name) as branch,
       e.status as enr_status, p.full_name as parent, coalesce(nullif(p.phone,''), nullif(p.whatsapp_phone,'')) as phone
from public.students s
left join public.enrollments e on e.student_id = s.id
left join public.branches b on b.id = e.branch_id
left join public.student_guardians g on g.student_id = s.id
left join public.parents p on p.id = g.parent_id
"""

def norm(s): return re.sub(r"[^A-Z0-9 ]", "", re.sub(r"\s+", " ", str(s or "").strip().upper())).strip()
def key(s): return re.sub(r"\b(BIN|BINTI|BT|BTE|B|BNT|BNTI)\b", "", norm(s)).replace(" ", "")
def phone(s):
    d = re.sub(r"\D", "", str(s or ""))
    return d[-9:] if len(d) >= 9 else d
def looks_like_name(v): return bool(re.fullmatch(r"[A-Za-z@'.\-/() ]{5,}", str(v).strip())) and len(str(v).split()) >= 2
def branch_of(label):
    u = str(label or "").upper()
    return "MTDC" if "MTDC" in u else "CYBER" if "CYBER" in u else None

def load_db(args):
    if args.db_csv:
        return list(csv.DictReader(open(args.db_csv, newline="")))
    guard = subprocess.run([sys.executable, str(ROOT / "scripts/local-backup-guard.py"), "source"], capture_output=True, text=True)
    if guard.returncode: sys.exit(guard.stderr.strip() or "Refusing: not the local main database")
    with tempfile.NamedTemporaryFile("w+", suffix=".csv") as tmp:
        env = dict(os.environ, PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=60000")
        r = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--csv", "-d", os.environ["NEXTGEN_LOCAL_DATABASE_URL"],
                            "-c", "begin read only", "-c", EXTRACT, "-c", "rollback"], env=env, stdout=tmp, stderr=subprocess.PIPE, text=True)
        if r.returncode: sys.exit("psql failed: " + r.stderr.strip()[:300])
        tmp.seek(0); return list(csv.DictReader(tmp))

def load_sheets(src):
    try: import openpyxl
    except ImportError: sys.exit("Missing openpyxl. Run: pip3 install --user openpyxl")
    d = openpyxl.load_workbook(src / "students-parents.xlsx", data_only=True)
    directory = {}
    for ws in d.worksheets:
        b = branch_of(ws.title)
        directory[b] = [(ws.cell(r, 2).value, ws.cell(r, 3).value, ws.cell(r, 4).value)
                        for r in range(2, ws.max_row + 1) if ws.cell(r, 2).value]
    rosters = {}
    for fname, b in (("mtdc-oct.xlsx", "MTDC"), ("cyber-oct.xlsx", "CYBER")):
        wb = openpyxl.load_workbook(src / fname, data_only=True); names = []
        for ws in wb.worksheets:
            if "REPLACEMENT" in ws.title.upper(): continue
            h = next((r for r in range(1, 41) if any(norm(ws.cell(r, c).value) == "STUDENT NAME" for c in range(1, 13))), None)
            if not h: continue
            ci = next(c for c in range(1, 13) if norm(ws.cell(h, c).value) == "STUDENT NAME")
            names += [ws.cell(r, ci).value for r in range(h + 1, ws.max_row + 1) if looks_like_name(ws.cell(r, ci).value or "")]
        rosters[b] = names
    return directory, rosters

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default=str(ROOT / "private/sources")); ap.add_argument("--details"); ap.add_argument("--db-csv")
    a = ap.parse_args()
    if a.details:
        p = pathlib.Path(a.details).resolve()
        if (ROOT / "private") not in p.parents: sys.exit("--details must be inside private/ (git-ignored)")
    db = load_db(a); directory, rosters = load_sheets(pathlib.Path(a.sources))
    students = {}
    for r in db:
        s = students.setdefault(key(r["student"]), {"name": r["student"], "branches": set(), "parents": {}, "phones": set(), "status": r["student_status"]})
        if r["branch"] and r["enr_status"] == "active": s["branches"].add(branch_of(r["branch"]))
        if r["parent"]: s["parents"][key(r["parent"])] = r["parent"]
        if r["phone"]: s["phones"].add(phone(r["phone"]))
    details = []
    print(f"Database: {len(students)} distinct students (loose-name match; spelling variants count as different)")
    for b in ("MTDC", "CYBER"):
        d = directory.get(b, []); dk = {key(n): (n, ph, par) for n, ph, par in d}
        print(f"\n== {b} ==")
        miss = [k for k in dk if k not in students]
        print(f"directory sheet: {len(dk)} students | not in DB at all: {len(miss)}")
        db_branch = {k for k, s in students.items() if b in s["branches"]}
        extra = db_branch - set(dk)
        print(f"DB students with active {b} enrollment: {len(db_branch)} | not in directory sheet: {len(extra)} (DB has MORE than the sheet)")
        pm = pd = pn = ph_same = ph_diff = ph_sheet_empty = ph_db_empty = 0
        for k, (n, ph, par) in dk.items():
            s = students.get(k)
            if not s: continue
            if not s["parents"]: pn += 1; details.append((b, "db_has_no_guardian", n, par or ""))
            elif key(par) in s["parents"]: pm += 1
            else: pd += 1; details.append((b, "parent_name_differs", n, par or ""))
            sp = phone(ph)
            if not sp: ph_sheet_empty += 1
            elif not s["phones"]: ph_db_empty += 1; details.append((b, "db_has_no_phone", n, ""))
            elif sp in s["phones"]: ph_same += 1
            else: ph_diff += 1; details.append((b, "phone_differs", n, ""))
        print(f"parent name vs DB guardian: same {pm} | differs {pd} | DB has no guardian {pn}")
        print(f"phone vs DB parent phone: same {ph_same} | differs {ph_diff} | sheet empty {ph_sheet_empty} | DB empty but sheet has one {ph_db_empty}")
        rk = {key(n) for n in rosters.get(b, [])}
        print(f"October roster: {len(rk)} distinct | in DB with active {b} enrollment: {len(rk & db_branch)} | in DB but NO active {b} enrollment: {len({k for k in rk if k in students} - db_branch)} | not in DB at all: {len([k for k in rk if k not in students])}")
        print(f"DB active {b} enrollments whose student is NOT in the October roster: {len(db_branch - rk)}")
        for k in rk - db_branch: details.append((b, "in_roster_but_not_enrolled_in_db", (students.get(k) or {}).get("name", k), ""))
        for k in db_branch - rk: details.append((b, "enrolled_in_db_but_not_in_oct_roster", students[k]["name"], ""))
    if a.details:
        with open(a.details, "w", newline="") as f:
            os.chmod(a.details, 0o600); w = csv.writer(f); w.writerow(["branch", "issue", "student", "sheet_parent"]); w.writerows(details)
        print(f"\nReview file written (contains names): {a.details} [{len(details)} rows]")
    print("\nCounts only above. Nothing was written to the database.")

main()
