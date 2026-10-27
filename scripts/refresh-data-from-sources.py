#!/usr/bin/env python3
"""Rebuild the LOCAL business data from the source sheets (private/sources). Counts only on screen.

  python3 scripts/refresh-data-from-sources.py plan                       # parse + checks, no database writes
  python3 scripts/refresh-data-from-sources.py plan --compare-old-db      # also compare the plan with the current DB (read-only)
  python3 scripts/refresh-data-from-sources.py emit --sql private/refresh.sql
  python3 scripts/refresh-data-from-sources.py apply --target drill       # into a nextgen_restore_drill_* database
  python3 scripts/refresh-data-from-sources.py apply --target main --backup-snapshot .local-backups/<fresh snapshot> \
        --confirm "WIPE LOCAL BUSINESS DATA"

Scope of the wipe: students, parents, guardians, enrollments, schedules, classes, bookings, obligations and the
legacy/September/reconciliation/capacity-decision tables. KEPT: branches, programmes, session_templates, profiles,
academic_calendar_exceptions and the schema. Everything runs in ONE transaction: any error leaves the database untouched.
Free-text remarks in the sheets are read in memory only to derive flags; they are never printed or stored.
"""
import argparse, collections, csv, hashlib, os, pathlib, re, subprocess, sys, tempfile, time, uuid
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import nextgen_sources as S

ROOT = pathlib.Path(__file__).resolve().parent.parent
TODAY = "2026-10-27"
NOTE_TAG = "[IMPORT-NOTICE]"
DOW = {"SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6}
DB_BRANCH = {"MTDC": "MTDC", "CYBER": "CYBERJAYA"}
STOP = re.compile(r"\b(GRAD\w*|STOP|BERHENTI|TAMAT)\b")
TWOX = re.compile(r"\b2\s*X\b")
WKS = re.compile(r"(?:\bW(?:EEK)?\s*|\bMINGGU\s*(?:KE\s*)?)([1-4])\b")
REVIEW_TOKENS = re.compile(r"\b(CUTI|TUKAR|START|JOIN|BALIK|PINDAH|SABTU|AHAD|JAN|2027|SEKOLAH)\b")
WIPE = ["legacy_reconciliation_decision_audit", "legacy_reconciliation_decisions", "legacy_replacement_review_audit",
        "legacy_replacement_reviews", "class_replacement_capacity_audit", "class_replacement_capacity_reviews",
        "makeup_obligations", "student_bookings", "class_sessions", "schedule_batches", "student_guardian_link_audit",
        "student_guardians", "enrollments", "students", "parents", "legacy_september_evidence"]
KEEP = ["branches", "programmes", "session_templates", "profiles", "academic_calendar_exceptions"]

def programme_of(block):
    b = (block or "").upper()
    if "YOUNG" in b or "NEW CLASS" in b or "SPACE 2" in b: return "YOUNG_CODER"
    if "JUNIOR" in b or "SPACE 1" in b: return "JR_MAKER"
    return None

def digits(s): return re.sub(r"\D", "", str(s or ""))

def row_flags(r):
    """Per roster row (= one enrollment). Returns dict(status, freq, weeks, notices[list of (code, text)])."""
    rem = r["remarks"]; n = []
    stop = bool(STOP.search(rem))
    allblack = len(r["week_labels"]) >= 3 and len(r["black_weeks"]) == len(r["week_labels"])
    two = bool(TWOX.search(rem)); wk = sorted({int(x) for x in WKS.findall(rem)})
    status, freq, weeks = "active", "weekly", None
    if stop: status = "paused"; n.append(("PAUSED_STOP_REMARK", "Sheet remark suggests the student stopped or graduated; enrollment paused for admin to confirm"))
    elif allblack: status = "paused"; n.append(("PAUSED_ALL_WEEKS_BLACK", "All week cells are blacked out in the sheet; enrollment paused for admin to confirm"))
    if two and len(wk) == 2: freq, weeks = "twice_monthly", wk
    elif two: n.append(("FREQUENCY_2X_UNRESOLVED", "Sheet says twice a month without two clear weeks; imported as weekly, admin to set W1-W4"))
    if rem and REVIEW_TOKENS.search(rem) and not stop: n.append(("REMARK_REVIEW", "Sheet remark mentions a change or leave; admin to review"))
    return dict(status=status, freq=freq, weeks=weeks, notices=n)

def clean_phone(s): return digits(s)

def build_plan(src):
    import openpyxl
    load = lambda f: openpyxl.load_workbook(src / f, data_only=True)
    plan = dict(warnings=[], sha={})
    for f in ("students-parents.xlsx", "mtdc-oct.xlsx", "cyber-oct.xlsx", "mtdc-sept.xlsx"):
        plan["sha"][f] = hashlib.sha256((src / f).read_bytes()).hexdigest()[:16]
    directory = S.parse_directory(load("students-parents.xlsx"))
    rosters, repl = {}, []
    for f, b in (("mtdc-oct.xlsx", "MTDC"), ("cyber-oct.xlsx", "CYBER")):
        wb = load(f); rows, w = S.parse_roster(wb, b); rosters[b] = rows; plan["warnings"] += w
        if b == "MTDC":
            repl, w2 = S.parse_replacements(wb, b); plan["warnings"] += w2
    sept_rows, _ = S.parse_roster(load("mtdc-sept.xlsx"), "MTDC")
    sept_keys = {S.name_key(r["name"]) for r in sept_rows}
    students, parents, guardians, enrollments = [], {}, [], []
    by_key = {}
    def new_student(b, name, notices, laptop=None):
        st = dict(id=str(uuid.uuid4()), branch=b, name=name, laptop=laptop, notices=list(notices), extra=[], key=S.name_key(name))
        students.append(st); return st
    for b in ("MTDC", "CYBER"):
        drows, rrows = directory.get(b, []), rosters[b]
        order, seen = [], set()
        for x in drows + rrows:
            k = S.name_key(x["name"])
            if k not in seen: seen.add(k); order.append(k)
        for k in order:
            ds = [d for d in drows if S.name_key(d["name"]) == k]; rs = [r for r in rrows if S.name_key(r["name"]) == k]
            laptop = "academy" if any(r["laptop"] == "ACADEMY" for r in rs) else None
            st = new_student(b, (ds[0]["name"] if ds else rs[0]["name"]), [], laptop)
            by_key[(b, k)] = st
            ages = [digits(r["age"]) for r in rs if digits(r["age"])]
            if ages: st["extra"].append(f"Age in Oct 2026 sheet: {ages[0]}")
            if len(ds) > 1:
                st["notices"].append(("NAME_DUPLICATE_IN_DIRECTORY", "Two directory rows share this name; only the first is linked to the roster"))
                for d in ds[1:]:
                    dup = new_student(b, d["name"], [("NAME_DUPLICATE_IN_DIRECTORY", "Duplicate-name directory row; admin to confirm whether this is a different child")])
                    attach_parent(parents, guardians, dup, d, rs, plan)
            if ds: attach_parent(parents, guardians, st, ds[0], rs, plan)
            else:
                contact = next((digits(r["contact"]) for r in rs if digits(r["contact"])), "")
                st["notices"].append(("NOT_IN_DIRECTORY", "Not in the students/parents directory sheet; no guardian recorded"))
                st["extra"].append(f"Roster phone: {contact}" if contact else "No phone in roster")
            if not rs: st["notices"].append(("NOT_IN_OCT_ROSTER", "In the directory sheet but not on any October roster; no enrollment created"))
            groups = collections.OrderedDict()
            for r in rs:
                prog = programme_of(r["block"])
                if not prog or r["start"] is None or r["day"] not in DOW:
                    plan["warnings"].append(f"{b}/{r['tab']} row {r['row']}: cannot resolve programme/slot; row skipped"); continue
                tkey = f"{DB_BRANCH[b]}|{DOW[r['day']]}|{r['start']}|{prog}"
                fl = row_flags(r)
                if tkey in groups:
                    g = groups[tkey]
                    for c in fl["notices"]:
                        if c not in g["notices"]: g["notices"].append(c)
                    continue
                groups[tkey] = dict(tkey=tkey, branch=b, prog=prog, tab=r["tab"].strip(), row=r["row"], **fl)
            for g in groups.values():
                enrollments.append(dict(id=str(uuid.uuid4()), student=st, start="2026-09-01" if k in sept_keys and b == "MTDC" else "2026-10-01", **g))
    plan.update(students=students, parents=list(parents.values()), guardians=guardians, enrollments=enrollments,
                directory=directory, rosters=rosters, sept_keys=sept_keys)
    # historical yellow-seat source rows (MTDC October)
    reviews = []
    for e in repl:
        st = by_key.get(("MTDC", S.name_key(e["name"])))
        reviews.append(dict(id=str(uuid.uuid4()), ref=f"mtdc-2026-10:{e['tab'].strip()}:r{e['row']}", tab=e["tab"].strip(), row=e["row"],
                            student=st, name=e["name"], original=e["original_date"], replacement=e["replacement_date"],
                            prog="JR_MAKER" if e["space"] == 1 else "YOUNG_CODER", space=e["space"], start=e["start"], end=e["end"]))
    plan["reviews"] = reviews
    for en in enrollments:
        for code, text in en["notices"]: en["student"]["notices"].append((code, f"{en['tab']} row {en['row']}: {text}"))
    return plan

def attach_parent(parents, guardians, st, d, rs, plan):
    pname = d["parent"]
    if not pname:
        st["notices"].append(("NO_GUARDIAN", "Directory row has no parent name; no guardian recorded")); return
    phone = clean_phone(d["phone"]); pnote = None
    if not phone:
        phone = next((digits(r["contact"]) for r in rs if digits(r["contact"])), "")
        if phone: pnote = "Phone taken from the October roster (directory phone empty)"
    key = (S.name_key(pname), S.phone_key(phone) if phone else f"nophone-{st['id']}")
    p = parents.get(key)
    if not p:
        p = dict(id=str(uuid.uuid4()), name=pname, phone=phone or None, notes=pnote); parents[key] = p
    if not phone: st["notices"].append(("PARENT_NO_PHONE", "Parent has no phone in directory or roster; needed for manual WhatsApp"))
    elif len(phone) < 9 or len(phone) > 12: st["notices"].append(("PHONE_FORMAT_REVIEW", "Parent phone has an unusual length; admin to verify"))
    guardians.append(dict(student=st, parent=p))

# ----------------------------------------------------------------------------- SQL emission
def q(v): return "null::text" if v is None else "'" + str(v).replace("'", "''") + "'"
def qd(v): return "null::date" if v is None else f"date '{v}'"
def qa(w): return "null::smallint[]" if not w else "array[" + ",".join(str(int(x)) for x in w) + "]::smallint[]"
def qu(v): return "null::uuid" if v is None else f"'{v}'::uuid"
def chunks(xs, n=150):
    for i in range(0, len(xs), n): yield xs[i:i + n]

def note_of(st):
    parts = []
    if st["notices"]: parts.append(f"{NOTE_TAG} {TODAY} " + " | ".join(f"{c}: {t}" for c, t in st["notices"]))
    parts += st["extra"]
    return "\n".join(parts) if parts else None

def emit_sql(plan, meta=True, oct_status="locked"):
    o = []
    A = o.append
    if meta: A("\\set ON_ERROR_STOP on")
    A("begin;")
    tkeys = sorted({e["tkey"] for e in plan["enrollments"]})
    all_tables = ",".join("'" + t + "'" for t in WIPE + KEEP)
    A("do $pre$ declare v_missing text[]; begin\n"
      "  select array_agg(n) into v_missing from unnest(array['generate_monthly_schedule_atomic','initiate_reschedule_obligation','assign_reschedule_slot',"
      "'reopen_reschedule_assignment','cancel_reschedule','legacy_reserved_yellow_seats']) n where not exists (select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname=n);\n"
      "  if v_missing is not null then raise exception 'Apply migrations 025-027 first; missing functions: %', v_missing; end if;\n"
      "  if not exists (select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='guard_profile_privileged_columns') then raise exception 'Apply migration 026 first'; end if;\n"
      "  if not exists (select 1 from public.profiles where is_active and role in ('admin','super_admin')) then raise exception 'No active admin profile exists'; end if;\n"
      f"  select array_agg(tablename::text) into v_missing from pg_tables where schemaname='public' and tablename::text <> all(array[{all_tables}]);\n"
      "  if v_missing is not null then raise exception 'Refusing: unclassified public tables %', v_missing; end if;\n"
      "end $pre$;")
    A("create temporary table branch_map(code text primary key, id uuid not null) on commit drop;")
    A("insert into branch_map(code,id) select 'MTDC', id from public.branches where lower(name) like '%mtdc%' or lower(coalesce(code,''))='mtdc';")
    A("insert into branch_map(code,id) select 'CYBERJAYA', id from public.branches where lower(name) like '%cyberjaya%' or lower(coalesce(code,''))='cyberjaya';")
    A("do $bm$ begin if (select count(*) from branch_map) <> 2 then raise exception 'MTDC and Cyberjaya branches must each match exactly one row'; end if; end $bm$;")
    A("do $cal$ declare v text; begin\n"
      "  select string_agg(to_char(closed_on,'YYYY-MM-DD'),', ' order by closed_on) into v from public.academic_calendar_exceptions\n"
      "   where decision='pending' and branch_id in (select id from branch_map) and closed_on>=date '2026-10-01' and closed_on<date '2026-12-01';\n"
      "  if v is not null then raise exception 'Calendar decisions still pending for % - the admin must set move/skip/withdrawn in the Calendar page first; nothing was changed', v; end if;\n"
      "end $cal$;")
    A("create temporary table tpl_map(tkey text primary key, id uuid not null) on commit drop;")
    A("do $tm$ declare k text; parts text[]; ids uuid[]; begin\n"
      f"  foreach k in array array[{','.join(q(k) for k in tkeys)}] loop\n"
      "    parts := string_to_array(k,'|');\n"
      "    select array_agg(t.id) into ids from public.session_templates t join public.programmes p on p.id=t.programme_id\n"
      "     where t.is_active and t.branch_id=(select id from branch_map where code=parts[1]) and t.day_of_week=parts[2]::int\n"
      "       and t.start_time=parts[3]::time and p.code=parts[4];\n"
      "    if ids is null or cardinality(ids)<>1 then raise exception 'Session template missing or ambiguous: %', k; end if;\n"
      "    insert into tpl_map values (k, ids[1]);\n"
      "  end loop;\nend $tm$;")
    for t in WIPE: A(f"delete from public.{t};")
    for c in chunks(plan["parents"]):
        A("insert into public.parents(id,full_name,phone,notes) values\n" + ",\n".join(f"({qu(p['id'])},{q(p['name'])},{q(p['phone'])},{q(p['notes'])})" for p in c) + ";")
    for c in chunks(plan["students"]):
        A("insert into public.students(id,full_name,status,laptop_type,notes) values\n" + ",\n".join(f"({qu(s['id'])},{q(s['name'])},'active',{q(s['laptop'])},{q(note_of(s))})" for s in c) + ";")
    for c in chunks(plan["guardians"]):
        A("insert into public.student_guardians(student_id,parent_id,relationship,is_primary) values\n" + ",\n".join(f"({qu(g['student']['id'])},{qu(g['parent']['id'])},'guardian',true)" for g in c) + ";")
    for c in chunks(plan["enrollments"]):
        vals = ",\n".join("(%s,%s,%s,%s,%s,%s,%s,%s,%s)" % (qu(e["id"]), qu(e["student"]["id"]), q(DB_BRANCH[e["branch"]]), q(e["prog"]), q(e["tkey"]),
                                                           q(e["freq"]), qa(e["weeks"]), qd(e["start"]), q(e["status"])) for e in c)
        A("insert into public.enrollments(id,student_id,branch_id,programme_id,default_session_id,frequency_type,preferred_weeks,start_date,status)\n"
          "select v.id,v.sid,bm.id,p.id,tm.id,v.freq,v.weeks,v.start,v.status from (values\n" + vals + "\n) v(id,sid,branch,prog,tkey,freq,weeks,start,status)\n"
          "join branch_map bm on bm.code=v.branch join public.programmes p on p.code=v.prog join tpl_map tm on tm.tkey=v.tkey;")
    en_notes = [(e, "; ".join(f"{c}: {t}" for c, t in e["notices"])) for e in plan["enrollments"] if e["notices"]]
    for e, txt in en_notes:
        A(f"update public.enrollments set notes={q(NOTE_TAG + ' ' + TODAY + ' ' + txt)} where id={qu(e['id'])};")
    A("select set_config('request.jwt.claim.sub',(select id::text from public.profiles where is_active and role in ('admin','super_admin') order by created_at,id limit 1),true);")
    A("select set_config('request.jwt.claims',json_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);")
    A("select public.generate_monthly_schedule_atomic((select id from branch_map where code='MTDC'), date '2026-10-01') as october_batch;")
    if oct_status != "draft":
        A(f"update public.schedule_batches set status='{oct_status}', approved_at=now(), locked_at={'now()' if oct_status == 'locked' else 'null'} "
          "where branch_id=(select id from branch_map where code='MTDC') and schedule_month=date '2026-10-01';")
    A("create temporary table incoming_review(id uuid, ref text, tab text, row int, student_id uuid, name text, original_date date, replacement_date date, prog text, space int, start_time time, end_time time) on commit drop;")
    for c in chunks(plan["reviews"]):
        A("insert into incoming_review values\n" + ",\n".join("(%s,%s,%s,%d,%s,%s,%s,%s,%s,%d,%s::time,%s::time)" % (
            qu(r["id"]), q(r["ref"]), q(r["tab"]), r["row"], qu(r["student"]["id"] if r["student"] else None), q(r["name"]), qd(r["original"]),
            qd(r["replacement"]), q(r["prog"]), r["space"], q(r["start"]), q(r["end"])) for r in c) + ";")
    A("insert into public.legacy_replacement_reviews(id,source_batch,source_ref,branch_id,student_name,source_tab,source_row,original_date,replacement_date,programme_code,space_number,start_time,end_time,technical_status,original_booking_id,target_class_id,source_booking_candidates,target_class_candidates)\n"
      "select i.id,'mtdc-2026-10',i.ref,bm.id,i.name,i.tab,i.row,i.original_date,i.replacement_date,i.prog,i.space,i.start_time,i.end_time,\n"
      " case when i.original_date is null then 'ORIGINAL_DATE_UNPARSED'\n"
      "  when i.student_id is null then 'STUDENT_NOT_IN_LOCAL'\n"
      "  when not exists (select 1 from public.student_bookings sb join public.class_sessions sc on sc.id=sb.class_session_id where sb.student_id=i.student_id and sb.booking_type='regular' and sc.branch_id=bm.id and sc.class_date>=date '2026-10-01' and sc.class_date<date '2026-11-01') then 'MISSING_OCTOBER_ROSTER_IDENTITY'\n"
      "  when tc.n=0 then 'TARGET_CLASS_MISSING' when tc.n>1 then 'TARGET_CLASS_AMBIGUOUS'\n"
      "  when i.original_date>=i.replacement_date then 'ORIGINAL_DATE_NOT_BEFORE_TARGET'\n"
      "  when ob.n=0 then 'ORIGINAL_BOOKING_MISSING' when ob.n>1 then 'ORIGINAL_BOOKING_AMBIGUOUS'\n"
      "  when ob.prog is distinct from i.prog then 'ORIGINAL_PROGRAMME_REVIEW'\n"
      "  when ob.att='present' then 'ORIGINAL_MARKED_PRESENT_REVIEW'\n"
      "  else 'SOURCE_LINK_CANDIDATE_ADMIN_REVIEW' end,\n"
      " case when ob.n=1 then ob.id end, case when tc.n=1 then tc.id end, ob.n, tc.n\n"
      "from incoming_review i cross join (select id from branch_map where code='MTDC') bm\n"
      "cross join lateral (select count(*)::int n,(array_agg(c.id))[1] id from public.class_sessions c join public.programmes p on p.id=c.programme_id where c.branch_id=bm.id and c.class_date=i.replacement_date and c.start_time=i.start_time and p.code=i.prog) tc\n"
      "cross join lateral (select count(*)::int n,(array_agg(sb.id))[1] id,(array_agg(p.code))[1] prog,(array_agg(sb.attendance_status))[1] att from public.student_bookings sb join public.class_sessions sc on sc.id=sb.class_session_id join public.programmes p on p.id=sc.programme_id where sb.student_id=i.student_id and sb.booking_type='regular' and sc.branch_id=bm.id and sc.class_date=i.original_date) ob;")
    A("update public.legacy_replacement_reviews r set over_capacity=true from public.class_sessions c where r.target_class_id=c.id and r.source_batch='mtdc-2026-10'\n"
      " and (select count(*) from public.student_bookings b where b.class_session_id=c.id and b.booking_type='replacement' and b.attendance_status not in ('cancelled','not_scheduled')) + public.legacy_reserved_yellow_seats(c.id) > c.replacement_capacity;")
    A("select public.generate_monthly_schedule_atomic((select id from branch_map where code='MTDC'), date '2026-11-01') as november_batch;")
    A("do $san$ declare n int; begin\n"
      "  select count(*) into n from public.student_bookings b join public.enrollments e on e.id=b.enrollment_id where e.student_id<>b.student_id; if n>0 then raise exception 'Sanity: % bookings point at another student''s enrollment', n; end if;\n"
      "  select count(*) into n from public.student_bookings where enrollment_id is null; if n>0 then raise exception 'Sanity: % bookings without enrollment', n; end if;\n"
      "  select count(*) into n from public.student_bookings b join public.enrollments e on e.id=b.enrollment_id join public.class_sessions c on c.id=b.class_session_id where b.booking_type='regular' and e.default_session_id is distinct from c.session_template_id; if n>0 then raise exception 'Sanity: % bookings outside the enrollment default session', n; end if;\n"
      "  select count(*) into n from public.schedule_batches where branch_id=(select id from branch_map where code='MTDC'); if n<>2 then raise exception 'Sanity: expected 2 MTDC batches, found %', n; end if;\n"
      "end $san$;")
    A("commit;")
    return "\n".join(o) + "\n"

# ----------------------------------------------------------------------------- read-only DB helpers
Q_TPL = """select coalesce(b.code,b.name) as branch, t.day_of_week as dow, to_char(t.start_time,'HH24:MI') as start, p.code as programme,
 t.regular_capacity as cap from public.session_templates t join public.branches b on b.id=t.branch_id
 join public.programmes p on p.id=t.programme_id where t.is_active"""
Q_OLD = """select s.full_name as student, coalesce(b.code,b.name) as branch, e.status, e.frequency_type as freq,
 coalesce(array_to_string(e.preferred_weeks,','),'') as weeks, t.day_of_week as dow, to_char(t.start_time,'HH24:MI') as start, p.code as programme
 from public.enrollments e join public.students s on s.id=e.student_id join public.branches b on b.id=e.branch_id
 join public.programmes p on p.id=e.programme_id left join public.session_templates t on t.id=e.default_session_id"""

def nb(x): return DB_BRANCH.get(S.branch_of(x), x)

def run_guard(kind):
    g = subprocess.run([sys.executable, str(ROOT / "scripts/local-backup-guard.py"), kind], capture_output=True, text=True)
    if g.returncode: sys.exit(g.stderr.strip() or "Refusing: not a permitted local database")

def psql_rows(sql, url):
    with tempfile.NamedTemporaryFile("w+", suffix=".csv") as tmp:
        env = dict(os.environ, PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=60000")
        r = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--csv", "-d", url, "-c", "begin read only", "-c", sql, "-c", "rollback"],
                           env=env, stdout=tmp, stderr=subprocess.PIPE, text=True)
        if r.returncode: sys.exit("psql failed: " + r.stderr.strip()[:300])
        tmp.seek(0); return list(csv.DictReader(tmp))

def local_url():
    run_guard("source")
    return os.environ["NEXTGEN_LOCAL_DATABASE_URL"]

# ----------------------------------------------------------------------------- reports (counts only)
def report(plan, templates=None, old=None):
    P = print
    P("== sources (sha256 prefixes) ==  " + ", ".join(f"{k}:{v}" for k, v in plan["sha"].items()))
    if plan["warnings"]: P("== parser warnings (no personal data) ==\n  " + "\n  ".join(plan["warnings"]))
    st = plan["students"]; en = plan["enrollments"]
    P("\n== planned records ==")
    for b in ("MTDC", "CYBER"):
        bs = [s for s in st if s["branch"] == b]; be = [e for e in en if e["branch"] == b]
        P(f"  {b}: students {len(bs)} | enrollments {len(be)} (active {sum(1 for e in be if e['status']=='active')}, paused {sum(1 for e in be if e['status']=='paused')}) "
          f"| frequency {dict(collections.Counter(e['freq'] for e in be))} | distinct students enrolled {len({e['student']['id'] for e in be})}")
    gs = {g["student"]["id"] for g in plan["guardians"]}
    P(f"  parents {len(plan['parents'])} | guardian links {len(plan['guardians'])} | students WITHOUT guardian {sum(1 for s in st if s['id'] not in gs)}")
    P(f"  historical yellow-seat source rows (MTDC Oct): {len(plan['reviews'])} | matched to a student {sum(1 for r in plan['reviews'] if r['student'])}")
    codes = collections.Counter(c for s in st for c, _ in s["notices"])
    P("\n== admin notices that will be written into notes (count per code) ==\n  " + (", ".join(f"{k}={v}" for k, v in sorted(codes.items())) or "none"))
    # planned weekly load per template/week, vs capacity if known
    load = collections.Counter()
    for e in en:
        if e["status"] != "active": continue
        for w in (e["weeks"] or [1, 2, 3, 4]): load[(e["tkey"], w)] += 1
    P("\n== planned regular load per class (max over weeks 1-4) ==")
    over = []
    for tkey in sorted({k for k, _ in load}):
        mx = max(load[(tkey, w)] for w in (1, 2, 3, 4))
        cap = (templates or {}).get(tkey)
        flag = "" if cap is None else (" OVER CAPACITY" if mx > cap else "")
        if flag: over.append((tkey, mx, cap))
        P(f"  {tkey:30} max {mx:2d}" + ("" if cap is None else f" / capacity {cap}{flag}"))
    if templates is None: P("  (capacity not checked: no database connection given)")
    plan["over_capacity"] = over
    if old is not None: compare_old(plan, old)

def compare_old(plan, old):
    keyed = collections.defaultdict(list)
    for r in old:
        if r["status"] == "active" and r["dow"] != "": keyed[(S.branch_of(r["branch"]), S.name_key(r["student"]))].append(r)
    allold = {S.name_key(r["student"]) for r in old}
    c = collections.Counter(); planned_active = set()
    for e in plan["enrollments"]:
        k = (e["branch"], e["student"]["key"]); olds = keyed.get(k, [])
        tk = lambda r: f"{nb(r['branch'])}|{r['dow']}|{r['start']}|{r['programme']}"
        same = [r for r in olds if tk(r) == e["tkey"]]
        if e["status"] == "active":
            planned_active.add((k, e["tkey"]))
            if same:
                r = same[0]; ow = [int(x) for x in r["weeks"].split(",")] if r["weeks"] else None
                c["active: same slot" + (", same frequency" if (r["freq"] == "weekly") == (e["freq"] == "weekly") and (ow or None) == (e["weeks"] or None) else ", FREQUENCY differs")] += 1
            elif olds: c["active: DIFFERENT slot than old DB"] += 1
            elif e["student"]["key"] in allold: c["active: old DB had no active enrollment for this student"] += 1
            else: c["active: student not in old DB"] += 1
        else:
            c["paused in plan: old DB had it active" if same else "paused in plan: old DB also had no active enrollment"] += 1
    gone = [1 for k, rs in keyed.items() for r in rs if (k, f"{nb(r['branch'])}|{r['dow']}|{r['start']}|{r['programme']}") not in planned_active]
    c["old active enrollments NOT in the plan (will be dropped)"] = len(gone)
    print("\n== plan vs current (old) database, enrollments (counts only) ==")
    for k, v in sorted(c.items()): print(f"  {k}: {v}")

# ----------------------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["plan", "emit", "apply"])
    ap.add_argument("--sources", default=str(ROOT / "private/sources"))
    ap.add_argument("--compare-old-db", action="store_true", help="read-only comparison with the current local database")
    ap.add_argument("--sql", help="emit: output file (must be inside private/)")
    ap.add_argument("--notices-csv", help="write per-student notices (contains names) to a file inside private/")
    ap.add_argument("--oct-batch-status", default="locked", choices=["draft", "approved", "locked"])
    ap.add_argument("--target", choices=["main", "drill"])
    ap.add_argument("--backup-snapshot"); ap.add_argument("--confirm")
    a = ap.parse_args()
    try:
        import openpyxl  # noqa: F401
    except ImportError: sys.exit("Missing openpyxl. Run: pip3 install --user openpyxl")
    def inside_private(p):
        p = pathlib.Path(p).resolve()
        if (ROOT / "private") not in p.parents: sys.exit(f"{p} must be inside private/ (git-ignored)")
        return p
    plan = build_plan(pathlib.Path(a.sources))
    templates = old = None
    if a.compare_old_db or a.cmd == "apply" and a.target == "main":
        url = local_url()
        templates = {f"{nb(r['branch'])}|{r['dow']}|{r['start']}|{r['programme']}": int(r["cap"]) for r in psql_rows(Q_TPL, url)}
        if a.compare_old_db: old = psql_rows(Q_OLD, url)
    report(plan, templates, old)
    if a.notices_csv:
        p = inside_private(a.notices_csv)
        with open(p, "w", newline="") as f:
            os.chmod(p, 0o600); w = csv.writer(f); w.writerow(["branch", "student", "code", "text"])
            for s in plan["students"]:
                for c, t in s["notices"]: w.writerow([s["branch"], s["name"], c, t])
        print(f"\nNotices file (contains names): {p}")
    if a.cmd == "plan":
        print("\nPlan only. Nothing was written to any database."); return
    sql = emit_sql(plan, meta=True, oct_status=a.oct_batch_status)
    if a.cmd == "emit":
        if not a.sql: sys.exit("--sql <file inside private/> is required")
        p = inside_private(a.sql); p.write_text(sql); os.chmod(p, 0o600)
        print(f"\nSQL written (contains personal data): {p}"); return
    # ---- apply
    if not a.target: sys.exit("--target main|drill is required")
    if any(w.startswith(tuple(f"{b}/") for b in ("MTDC", "CYBER")) and "skipped" in w for w in plan["warnings"]):
        sys.exit("Refusing: some roster rows could not be resolved (see warnings)")
    if plan.get("over_capacity"): sys.exit("Refusing: planned classes exceed template capacity; the admin must decide who moves first")
    if a.target == "drill":
        run_guard("restore"); url = os.environ["NEXTGEN_RESTORE_DRILL_URL"]
    else:
        url = local_url()
        if a.confirm != "WIPE LOCAL BUSINESS DATA": sys.exit('Refusing: pass --confirm "WIPE LOCAL BUSINESS DATA"')
        if not a.backup_snapshot: sys.exit("Refusing: --backup-snapshot .local-backups/<fresh snapshot> is required")
        snap = pathlib.Path(a.backup_snapshot).resolve()
        if (ROOT / ".local-backups") not in snap.parents or not (snap / "database.dump").is_file() or not (snap / "sha256.txt").is_file():
            sys.exit("Refusing: snapshot must be a complete directory inside .local-backups")
        if hashlib.sha256((snap / "database.dump").read_bytes()).hexdigest() != (snap / "sha256.txt").read_text().split()[0]:
            sys.exit("Refusing: snapshot checksum mismatch")
        if time.time() - (snap / "database.dump").stat().st_mtime > 24 * 3600: sys.exit("Refusing: snapshot is older than 24 hours; take a fresh backup")
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d) / "refresh.sql"; f.write_text(sql); os.chmod(f, 0o600)
        r = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", url, "-f", str(f)], capture_output=True, text=True)
    if r.returncode:
        print("psql FAILED; the transaction was rolled back and the database is unchanged.\n" + r.stderr.strip()[:1500]); sys.exit(1)
    print("\nImport committed.\n" + r.stdout.strip()[:800])
    sept = ROOT / "private/NextGen_MTDC_September2026_PRIVATE_Evidence.csv"
    env = dict(os.environ, NEXTGEN_LOCAL_DATABASE_URL=url)
    r2 = subprocess.run(["node", str(ROOT / "scripts/import-mtdc-september-local.mjs"), str(sept), "--confirm-local"], env=env, capture_output=True, text=True)
    print("September evidence import: " + ("OK\n" + r2.stdout.strip()[:400] if r2.returncode == 0 else "FAILED (rerun it alone; it is idempotent)\n" + r2.stderr.strip()[:400]))
    print("\nNext: bash scripts/audit-local-readiness.sh docs/release-evidence/nextgen-local-readiness-after-refresh.md")

if __name__ == "__main__":
    main()
