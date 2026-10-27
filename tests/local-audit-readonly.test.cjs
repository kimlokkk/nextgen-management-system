const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "scripts/sql/local-readiness-audit.sql"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "scripts/audit-local-readiness.sh"), "utf8");

function executableSql(text) {
  return text.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
}

test("local readiness audit SQL contains only read statements", () => {
  const code = executableSql(sql);
  assert.doesNotMatch(code, /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|merge|call|do)\b/i);
  assert.match(code, /^\s*with\b/i);
});

test("local readiness audit never outputs personal columns directly", () => {
  const code = executableSql(sql)
    .replace(/md5\([^)]*\)/gi, "md5()")
    .replace(/count\([^)]*\)/gi, "count()");
  // Personal columns may appear in grouping / hashing, never as a bare output column of a select list.
  for (const col of ["full_name", "student_name", "phone", "whatsapp_phone", "email", "notes", "review_note"]) {
    assert.doesNotMatch(code, new RegExp(`\\bselect\\s+${col}\\s*(,|from\\b)`, "i"), `${col} must not be a direct output column`);
  }
});

test("audit wrapper is guarded, read-only and local-only", () => {
  assert.match(wrapper, /local-backup-guard\.py"? source/);
  assert.match(wrapper, /default_transaction_read_only=on/);
  assert.match(wrapper, /begin read only/);
  assert.doesNotMatch(wrapper, /supabase\.co/i);
  assert.doesNotMatch(wrapper, /\b(pg_restore|dropdb|createdb|supabase db reset)\b/i);
});
