# Drives main() for `apply` with FAKE sheets and every external call (guards, psql, node) stubbed. No database is touched.
import sys, importlib.util, pathlib, tempfile, hashlib, os, time, io, contextlib, types, shutil
REPO = pathlib.Path(sys.argv[1]); sys.path.insert(0, str(REPO / "scripts"))
fe = REPO / "tests/rehearsal/refresh-fake-emit.py"
src = fe.read_text().split("plan = R.build_plan(tmp)")[0].replace("sys.argv[1]", "'v1'").replace("pathlib.Path(sys.argv[3])", "REPO_")
ns = {"REPO_": REPO, "__name__": "x"}; sys.argv = ["x", "v1", "/dev/null", str(REPO)]; exec(src, ns); R, tmp = ns["R"], ns["tmp"]
calls = []; R.run_guard = lambda k: calls.append(("guard", k))
R.psql_rows = lambda sql, url: ([dict(branch="Cyberjaya", dow="6", start="11:00", programme="JR_MAKER", cap="20")] if "regular_capacity" in sql else [])
os.environ["NEXTGEN_LOCAL_DATABASE_URL"] = "postgres://x"; os.environ["NEXTGEN_RESTORE_DRILL_URL"] = "postgres://drill"
class P: returncode = 0; stdout = "ok"; stderr = ""
def fake_run(cmd, **kw):
    calls.append(("run", cmd[0], cmd[-1].endswith("refresh.sql") and "sql" or "other")); return P()
R.subprocess.run = fake_run
snapdir = REPO / ".local-backups" / "zz-test-snapshot"; snapdir.mkdir(parents=True, exist_ok=True)
(snapdir / "database.dump").write_bytes(b"dump"); (snapdir / "sha256.txt").write_text(hashlib.sha256(b"dump").hexdigest() + "  database.dump\n")
def run(*args):
    sys.argv = ["x", "apply", "--sources", str(tmp), *args]; calls.clear(); out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try: R.main(); code = 0
        except SystemExit as e: code = e.code or 0
    return code, out.getvalue()
try:
    c, o = run("--target", "main"); assert "Refusing" in str(c), c
    c, o = run("--target", "main", "--confirm", "WIPE LOCAL BUSINESS DATA"); assert "--backup-snapshot" in str(c), c
    c, o = run("--target", "main", "--confirm", "WIPE LOCAL BUSINESS DATA", "--backup-snapshot", str(snapdir)); assert c == 0 and ("run", "psql", "sql") in calls and "Import committed" in o, (c, o[-300:], calls)
    assert calls[0] == ("guard", "source"), calls
    (snapdir / "sha256.txt").write_text("0" * 64 + "  x\n"); c, o = run("--target", "main", "--confirm", "WIPE LOCAL BUSINESS DATA", "--backup-snapshot", str(snapdir)); assert "checksum" in str(c) and not any(x[2:] == ("sql",) for x in calls), c
    (snapdir / "sha256.txt").write_text(hashlib.sha256(b"dump").hexdigest() + "  database.dump\n"); old = time.time() - 30 * 3600; os.utime(snapdir / "database.dump", (old, old))
    c, o = run("--target", "main", "--confirm", "WIPE LOCAL BUSINESS DATA", "--backup-snapshot", str(snapdir)); assert "older than 24" in str(c), c
    c, o = run("--target", "drill"); assert c == 0 and ("guard", "restore") in calls and ("run", "psql", "sql") in calls, (c, calls)
    print("apply-path checks passed")
finally: shutil.rmtree(snapdir, ignore_errors=True)
