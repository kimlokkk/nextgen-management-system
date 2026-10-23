/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs")
const code=fs.readFileSync("app/(app)/schedule/actions.ts","utf8")
const ui=fs.readFileSync("app/(app)/schedule/page.tsx","utf8")
test("existing batches fail closed before schedule writes",()=>{
 const guard=code.indexOf("if (existingBatch) {")
 const write=code.indexOf(".from(\"schedule_batches\")\n        .insert(")
 assert.ok(guard>=0 && write>guard)
 assert.match(code.slice(guard,write),/Regeneration is disabled/)
})
test("old destructive regen branch and UI checkbox are removed",()=>{
 assert.ok(!code.includes('formData.get("confirm_regenerate")'))
 assert.ok(!ui.includes('name="confirm_regenerate"'))
 assert.ok(!code.includes(".eq(\"id\", existingBatch.id)"))
})
test("failed fresh batch cleanup targets only newly generated draft",()=>{
 assert.match(code,/\.eq\("id", batch.id\)\s*\.eq\("status", "draft"\)/)
 assert.match(code,/if \(cleanupError\)/)
})
test("generation requires an active admin",()=>{
 assert.match(code,/Only active admins may generate a schedule/)
})
