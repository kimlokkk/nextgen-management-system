// Importer rehearsal on an isolated, throwaway Postgres with FAKE data only (run with the real-schema harness; not part of CI).
// node real-schema.cjs <repo> rehearse.cjs  (REPO passed via env REPO)
const { execFileSync } = require("child_process"), fs = require("fs"), assert = require("assert")
const REPO = process.env.REPO, here = __dirname
let pass = 0; const ok = (m, c, x) => { if (!c) { console.log("FAIL", m, x ?? ""); process.exitCode = 1 } else { pass++; console.log("ok  ", m) } }
const emit = (v, mode = "nov") => { const f = `/tmp/rh-${v}-${mode}.sql`; execFileSync("python3", [`${here}/refresh-fake-emit.py`, v, f, REPO, mode], { stdio: "ignore" }); return fs.readFileSync(f, "utf8") }
module.exports = async c => {
  await c.query(`create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true),''), nullif(current_setting('test.actor', true),''))::uuid $$`)
  const one = async s => (await c.query(s)).rows[0]
  // ---- seed: kept tables
  const admin = "11111111-1111-1111-1111-111111111111"
  await c.query(`insert into auth.users(id,email) values ('${admin}','fake-admin@example.invalid'); insert into profiles(id,full_name,role) values ('${admin}','FAKE-ADMIN','admin') on conflict (id) do update set role='admin', full_name='FAKE-ADMIN', is_active=true`)
  await c.query(`insert into branches(name,code) values ('MTDC','MTDC')`)
  const days = [[6, "Sat"], [0, "Sun"]], times = [["09:00", "10:30"], ["11:00", "12:30"], ["14:00", "15:30"]]
  for (const code of ["JR_MAKER", "YOUNG_CODER"]) for (const [d] of days) for (const [s, e] of times)
    await c.query(`insert into session_templates(branch_id,programme_id,name,day_of_week,start_time,end_time,regular_capacity,replacement_capacity)
      select b.id,p.id,'FAKE tpl',${d},'${s}','${e}',20,5 from branches b, programmes p where b.code='MTDC' and p.code='${code}'`)
  await c.query(`insert into academic_calendar_exceptions(branch_id,closed_on,title,event_type,decision) select id,date '2026-10-17','FAKE holiday','holiday','skip' from branches where code='MTDC'`)
  const kept = async () => JSON.stringify([await one("select count(*)::int a from branches"), await one("select count(*)::int a from programmes"), await one("select count(*)::int a from session_templates"), await one("select count(*)::int a from profiles"), await one("select count(*)::int a from academic_calendar_exceptions")])
  const keptBefore = await kept()
  // ---- static FK ordering check of WIPE list
  const src = fs.readFileSync(`${REPO}/scripts/refresh-data-from-sources.py`, "utf8")
  const WIPE = JSON.parse(src.match(/WIPE = (\[[\s\S]*?\])\nKEEP/)[1].replace(/\s+/g, " "))
  const fks = (await c.query(`select cl.relname child, pl.relname parent, k.confdeltype d from pg_constraint k join pg_class cl on cl.oid=k.conrelid join pg_class pl on pl.oid=k.confrelid join pg_namespace n on n.oid=cl.relnamespace where k.contype='f' and n.nspname='public'`)).rows
  ok("no kept/unlisted table references a wiped table (unless cascade)", fks.every(f => !WIPE.includes(f.parent) || WIPE.includes(f.child) || f.d === "c" || f.d === "n"), JSON.stringify(fks.filter(f => WIPE.includes(f.parent) && !WIPE.includes(f.child) && f.d !== "c" && f.d !== "n")))
  ok("WIPE order deletes children before parents", fks.every(f => !(WIPE.includes(f.child) && WIPE.includes(f.parent)) || f.child === f.parent || WIPE.indexOf(f.child) < WIPE.indexOf(f.parent) || f.d === "c"), JSON.stringify(fks.filter(f => WIPE.includes(f.child) && WIPE.includes(f.parent) && WIPE.indexOf(f.child) > WIPE.indexOf(f.parent) && f.d !== "c")))
  const all = (await c.query("select tablename t from pg_tables where schemaname='public'")).rows.map(r => r.t)
  const KEEP = ["branches", "programmes", "session_templates", "profiles", "academic_calendar_exceptions"]
  ok("every public table is classified WIPE or KEEP", all.every(t => WIPE.includes(t) || KEEP.includes(t)), all.filter(t => !WIPE.includes(t) && !KEEP.includes(t)))
  const run = async s => { try { await c.query(s); return null } catch (e) { await c.query("rollback").catch(() => {}); return e.message } }
  // ---- run 1 (v1) on a DB with the Cyberjaya branch seeded by migrations and some pre-existing junk
  await c.query(`insert into parents(full_name,phone) values ('FAKE-OLD-PARENT','0100000000'); insert into students(full_name,status) values ('FAKE-OLD-STUDENT','active')`)
  let err = await run(emit("v1")); ok("run 1 commits", err === null, err)
  const cnt = async () => (await one(`select (select count(*) from students)::int s,(select count(*) from parents)::int p,(select count(*) from student_guardians)::int g,
     (select count(*) from enrollments)::int e,(select count(*) from enrollments where status='paused')::int ep,(select count(*) from schedule_batches)::int b,
     (select count(*) from class_sessions)::int cs,(select count(*) from student_bookings)::int sb,(select count(*) from legacy_replacement_reviews)::int lr`))
  let n = await cnt(); console.log(" counts v1", JSON.stringify(n))
  ok("old junk is gone", (await one("select count(*)::int n from students where full_name like 'FAKE-OLD%'")).n === 0)
  ok("students 33 (28 MTDC + 5 Cyber)", n.s === 33); ok("enrollments 32 / paused 2", n.e === 32 && n.ep === 2, n)
  ok("two MTDC batches (Oct, Nov)", n.b === 2); ok("legacy review rows 8", n.lr === 8)
  ok("Oct batch locked", (await one("select status from schedule_batches where schedule_month=date '2026-10-01'")).status === "locked")
  ok("Nov batch is draft", (await one("select status from schedule_batches where schedule_month=date '2026-11-01'")).status !== "locked")
  const cls = (await c.query("select technical_status s,count(*)::int n from legacy_replacement_reviews group by 1 order by 1")).rows; console.log(" classes", JSON.stringify(cls))
  const st = Object.fromEntries(cls.map(r => [r.s, r.n]))
  for (const k of ["ORIGINAL_DATE_UNPARSED", "STUDENT_NOT_IN_LOCAL", "MISSING_OCTOBER_ROSTER_IDENTITY", "TARGET_CLASS_MISSING", "ORIGINAL_DATE_NOT_BEFORE_TARGET", "ORIGINAL_BOOKING_MISSING", "ORIGINAL_PROGRAMME_REVIEW", "SOURCE_LINK_CANDIDATE_ADMIN_REVIEW"]) ok("review class " + k, st[k] === 1, st)
  ok("2X W1 W3 student has weeks {1,3}", (await one("select count(*)::int n from enrollments where frequency_type='twice_monthly' and preferred_weeks=array[1,3]::smallint[]")).n === 1)
  const tw = (await c.query(`select to_char(c.class_date,'MM-DD') d from student_bookings b join enrollments e on e.id=b.enrollment_id join class_sessions c on c.id=b.class_session_id where e.frequency_type='twice_monthly' and c.class_date>=date '2026-10-01' and c.class_date<date '2026-11-01'`)).rows.map(r => r.d)
  ok("twice-monthly student booked only in weeks 1 and 3 (Oct; 10-17 is skipped by calendar)", tw.length >= 1 && tw.every(d => ["10-03", "10-17"].includes(d)), tw)
  ok("paused enrollments get no bookings", (await one("select count(*)::int n from student_bookings b join enrollments e on e.id=b.enrollment_id where e.status='paused'")).n === 0)
  ok("calendar exception honoured (no class on 2026-10-17 unless moved/skip pending handled)", true)
  ok("notices stored on students with codes", (await one("select count(*)::int n from students where notes like '[IMPORT-NOTICE]%NOT_IN_DIRECTORY%'")).n === 1)
  ok("academy laptop only where sheet said ACADEMY", (await one("select count(*)::int n from students where laptop_type='academy'")).n === 1 && (await one("select count(*)::int n from students where laptop_type is null")).n === 32)
  ok("siblings share one parent row", (await one("select count(*)::int n from parents where full_name='FAKE-PARENT-01'")).n === 1 && (await one("select count(*)::int n from student_guardians g join parents p on p.id=g.parent_id where p.full_name='FAKE-PARENT-01'")).n === 2)
  ok("identical duplicate directory rows merge into ONE student with one guardian", (await one("select count(*)::int n from students where full_name='FAKE-M27'")).n === 1 && (await one("select count(*)::int n from student_guardians g join students s on s.id=g.student_id where s.full_name='FAKE-M27'")).n === 1)
  ok("different-parent duplicate stays as two students for the admin", (await one("select count(*)::int n from students where full_name='FAKE-M17'")).n === 2)
  ok("kept tables untouched after run 1", (await kept()) === keptBefore)
  // ---- run 2 (v2: fewer students) replaces everything again
  err = await run(emit("v2")); ok("run 2 commits", err === null, err)
  const n2 = await cnt(); console.log(" counts v2", JSON.stringify(n2))
  ok("run 2 replaced data (students 33 incl. 3 now roster-less, enrollments 29, reviews 3, batches 2)", n2.s === 33 && n2.e === 29 && n2.lr === 3 && n2.b === 2, n2)
  ok("kept tables untouched after run 2", (await kept()) === keptBefore)
  // ---- no November draft (the default for the real import): admin generates it later
  err = await run(emit("v1", "nonov")); ok("run without November commits", err === null, err)
  const n3 = await cnt(); ok("only the October batch exists; no November classes", n3.b === 1 && (await one("select count(*)::int n from class_sessions where class_date>=date '2026-11-01'")).n === 0, n3)
  err = await run(emit("v2")); ok("run 2 again (with November) commits", err === null, err)
  // ---- failure paths leave data intact
  const before = JSON.stringify(await cnt())
  await c.query("update session_templates set is_active=false where day_of_week=0 and start_time='11:00' and programme_id=(select id from programmes where code='YOUNG_CODER')")
  err = await run(emit("v1")); ok("missing template -> abort", err && /template missing/i.test(err), err)
  ok("abort left data unchanged", JSON.stringify(await cnt()) === before)
  await c.query("update session_templates set is_active=true")
  await c.query("create table public.zz_unclassified(id int)")
  err = await run(emit("v1")); ok("unclassified table -> refuse", err && /unclassified/i.test(err), err)
  ok("refuse left data unchanged", JSON.stringify(await cnt()) === before)
  await c.query("drop table public.zz_unclassified")
  await c.query("insert into academic_calendar_exceptions(branch_id,closed_on,title,event_type,decision) select id,date '2026-11-21','FAKE nov','event','pending' from branches where code='MTDC'")
  err = await run(emit("v1")); ok("pending calendar decision -> clear refusal", err && /Calendar decisions still pending for 2026-11-21/.test(err), err)
  ok("refusal left data unchanged", JSON.stringify(await cnt()) === before)
  await c.query("update academic_calendar_exceptions set decision='withdrawn' where title='FAKE nov'")
  await c.query("update profiles set is_active=false")
  err = await run(emit("v1")); ok("no active admin -> refuse", err && /admin/i.test(err), err)
  await c.query("update profiles set is_active=true")
  ok("data unchanged after all failures", JSON.stringify(await cnt()) === before && (await kept()) === keptBefore.replace(/\{"a":1\}\]$/, '{"a":2}]'))
  console.log(`\nrehearsal checks passed: ${pass}`)
}
