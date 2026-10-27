# Build a FAKE plan (no real data) and emit the refresh SQL. usage: fake_emit.py v1|v2 out.sql
import sys, importlib.util, pathlib, datetime, tempfile
REPO = pathlib.Path(sys.argv[3]); sys.path.insert(0, str(REPO / "scripts"))
spec = importlib.util.spec_from_file_location("refresh", REPO / "scripts/refresh-data-from-sources.py"); R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
S = R.S; ver = sys.argv[1]; D = datetime.date
def row(b, tab, day, start, block, name, n, remarks="", black=(), labels=("W1","W2","W3","W4"), phone="0123456789", laptop=None):
    return dict(tab=tab, day=day, start=start, end=None, block=block, seat=n, name=name, age="9", contact=phone, laptop=laptop, course=None, weeks=None,
                row=n + 5, remarks=remarks, black_weeks=list(black), week_labels=list(labels))
d = lambda name, parent, phone="0112223333", row=1: dict(name=name, phone=phone, parent=parent, row=row)
mt, dm = [], []
T9, T11 = "SAT 9-10.30AM", "SUN 11-12.30PM"
for i in range(1, 11): mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", f"FAKE-M{i:02d}", i)); dm.append(d(f"FAKE-M{i:02d}", f"FAKE-PARENT-{(i+1)//2:02d}", "0111000%03d" % ((i+1)//2), i))
for i in range(11, 17): mt.append(row("MTDC", T9, "SAT", "09:00", "NEW CLASS", f"FAKE-M{i:02d}", i)); dm.append(d(f"FAKE-M{i:02d}", f"FAKE-PARENT-{i:02d}", "0111000%03d" % i, i))
mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", "FAKE-M17", 17)); dm += [d("FAKE-M17", "FAKE-PARENT-17"), d("FAKE-M17", "FAKE-PARENT-17B")]
mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", "FAKE-M18", 18, remarks="2X W1 W3")); dm.append(d("FAKE-M18", "FAKE-PARENT-18"))
mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", "FAKE-M19", 19, remarks="GRAD")); dm.append(d("FAKE-M19", "FAKE-PARENT-19"))
mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", "FAKE-M20", 20, black=("W1","W2","W3","W4"))); dm.append(d("FAKE-M20", "FAKE-PARENT-20"))
mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", "FAKE-M21", 21, phone="0199999999", laptop="ACADEMY"))
dm.append(d("FAKE-M22", "FAKE-PARENT-22")); dm.append(d("FAKE-M23", ""))
mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", "FAKE-M23", 23)); mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", "FAKE-M24", 24, remarks="2X")); dm.append(d("FAKE-M24", "FAKE-PARENT-24"))
mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", "FAKE-M25", 25)); mt.append(row("MTDC", T11, "SUN", "11:00", "SPACE 2 NEW CLASS", "FAKE-M25", 26)); dm.append(d("FAKE-M25", "FAKE-PARENT-25"))
mt.append(row("MTDC", T11, "SUN", "11:00", "SPACE 2 NEW CLASS", "FAKE-M26", 27, remarks="CUTI")); dm.append(d("FAKE-M26", "FAKE-PARENT-26", "012"))
mt.append(row("MTDC", T9, "SAT", "09:00", "SPACE 1", "FAKE-M27", 28)); dm += [d("FAKE-M27", "FAKE-PARENT-27", "0111000027"), d("FAKE-M27", "FAKE-PARENT-27", "0111000027")]
cy = [row("CYBER", "SAT 11-12.30PM", "SAT", "11:00", "JUNIOR MAKER", f"FAKE-C{i:02d}", i) for i in range(1, 6)]
dc = [d(f"FAKE-C{i:02d}", f"FAKE-CPARENT-{i:02d}", "0122000%03d" % i, i) for i in range(1, 6)]
rep = lambda nm, od, rd, sp=1, st="09:00", n=1: dict(tab="SAT SPACE 1 REPLACEMENT", row=n, name=nm, original_date=od, replacement_date=rd, space=sp, start=st, end="10:30")
reps = [rep("FAKE-M01", D(2026,10,3), D(2026,10,10), n=1), rep("FAKE-GHOST", D(2026,10,3), D(2026,10,10), n=2), rep("FAKE-M02", None, D(2026,10,10), n=3),
        rep("FAKE-M03", D(2026,10,3), D(2026,10,10), st="13:00", n=4), rep("FAKE-M04", D(2026,10,17), D(2026,10,10), n=5),
        rep("FAKE-M05", D(2026,10,8), D(2026,10,10), n=6), rep("FAKE-M22", D(2026,10,3), D(2026,10,10), n=7),
        rep("FAKE-M11", D(2026,10,3), D(2026,10,10), n=8)]
if ver == "v2":
    mt = [r for r in mt if r["name"] not in ("FAKE-M10", "FAKE-M16", "FAKE-M26")]; reps = reps[:3]
S.parse_directory = lambda wb: {"MTDC": dm, "CYBER": dc}
S.parse_roster = lambda wb, b: ({"mtdc-oct.xlsx": mt, "cyber-oct.xlsx": cy, "mtdc-sept.xlsx": [r for r in mt if r["name"] in ("FAKE-M01", "FAKE-M02")]}[wb], [])
S.parse_replacements = lambda wb, b: (reps, [])
import openpyxl
openpyxl.load_workbook = lambda path, **kw: pathlib.Path(path).name
tmp = pathlib.Path(tempfile.mkdtemp())
for f in ("students-parents.xlsx", "mtdc-oct.xlsx", "cyber-oct.xlsx", "mtdc-sept.xlsx"): (tmp / f).write_bytes(b"fake")
plan = R.build_plan(tmp); R.report(plan)
pathlib.Path(sys.argv[2]).write_text(R.emit_sql(plan, meta=False, oct_status="locked", november=(len(sys.argv) < 5 or sys.argv[4] != "nonov")))
