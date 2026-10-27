/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert"), fs = require("fs"), path = require("path")
const root = path.join(__dirname, ".."), src = fs.readFileSync(path.join(root, "scripts/refresh-data-from-sources.py"), "utf8")
const migrations = fs.readdirSync(path.join(root, "supabase/migrations")).filter(f => f.endsWith(".sql")).sort().map(f => fs.readFileSync(path.join(root, "supabase/migrations", f), "utf8")).join("\n")
const list = name => JSON.parse(src.match(new RegExp(name + " = (\\[[\\s\\S]*?\\])\\n")) [1].replace(/\s+/g, " "))
test("every table created by migrations is classified WIPE or KEEP", () => {
  const created = new Set([...migrations.matchAll(/create table\s+(?:if not exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)].map(m => m[1].toLowerCase()))
  for (const m of migrations.matchAll(/drop table\s+(?:if exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) created.delete(m[1].toLowerCase())
  const known = new Set([...list("WIPE"), ...list("KEEP")])
  assert.deepEqual([...created].filter(t => !known.has(t)), [])
})
test("configuration and identity tables are kept, never wiped", () => {
  const wipe = list("WIPE")
  for (const t of ["branches", "programmes", "session_templates", "profiles", "academic_calendar_exceptions"]) assert.ok(!wipe.includes(t) && list("KEEP").includes(t), t)
})
test("importer never resets or drops and keeps destructive work in one transaction with a preflight", () => {
  assert.doesNotMatch(src, /\bdrop\s+(table|schema|database)\b|\btruncate\b|db reset|supabase\s+db\s+reset/i)
  assert.match(src, /A\("begin;"\)/); assert.match(src, /A\("commit;"\)/); assert.match(src, /ON_ERROR_STOP=1/)
  assert.match(src, /unclassified public tables/); assert.match(src, /Apply migrations 025-027 first/); assert.match(src, /Calendar decisions still pending/)
})
test("apply to the main database needs guard, fresh checksummed backup and typed confirmation", () => {
  for (const s of ['run_guard("source")', "WIPE LOCAL BUSINESS DATA", "--backup-snapshot", "sha256.txt", "24 * 3600", "inside_private"]) assert.ok(src.includes(s), s)
  assert.match(src, /run_guard\("restore"\)/)
})
test("report and notices avoid copying remark text and keep names in private files", () => {
  assert.doesNotMatch(src, /notices\.append\([^)]*r\["remarks"\]/); assert.doesNotMatch(src, /print\([^)]*\["name"\]/)
  assert.match(src, /chmod\(p, 0o600\)/)
})
test("colour-based decisions use the audited RPC only and never create entitlements", () => {
  assert.match(src, /record_legacy_reconciliation_decision\(/)
  assert.doesNotMatch(src, /insert into public\.legacy_reconciliation_decisions/i)
  assert.doesNotMatch(src, /insert into public\.makeup_obligations/i)
  assert.match(src, /Client sheet colour code/)
  assert.match(src, /never creates an entitlement/i)
  // anything the colours cannot confirm stays a human review item
  for (const code of ["NO_STUDENT", "OUTSIDE_SHEETS", "DATE_NOT_BEFORE", "ATTENDED_NOT_RED", "BLACK_NOT_CLOSURE", "BLANK_NOT_RED"]) assert.ok(src.includes(`"${code}"`), code)
})
