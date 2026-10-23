/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")

const source = fs.readFileSync("lib/legacy-source-comparison.ts", "utf8")
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
const moduleStub = { exports: {} }
vm.runInNewContext(outputText, { module: moduleStub, exports: moduleStub.exports })
const { compareLegacyOriginalCandidate } = moduleStub.exports

const candidate = {
    studentName: "Aisha Binti Ali",
    classDate: "2026-09-13",
    startTime: "11:00:00",
    endTime: "12:00:00",
    bookingType: "regular",
    attendanceStatus: "upcoming",
}

test("literal match is only a comparison, not entitlement approval", () => {
    const compared = compareLegacyOriginalCandidate(" aisha   binti ali ", "2026-09-13", candidate)
    assert.equal(compared.name, "same_text")
    assert.equal(compared.date, "same_text")
    assert.equal(compared.originalMarkedPresent, false)
    assert.equal(Object.hasOwn(compared, "approved"), false)
    assert.equal(Object.hasOwn(compared, "entitlement"), false)
})

test("mismatch is displayed as a discrepancy rather than auto-rejected", () => {
    const compared = compareLegacyOriginalCandidate("Different Student", "2026-09-20", candidate)
    assert.equal(compared.name, "different_text")
    assert.equal(compared.date, "different_text")
})

test("missing origin fields are explicitly unavailable", () => {
    const compared = compareLegacyOriginalCandidate("Someone", null, {
        ...candidate, studentName: null, classDate: null,
    })
    assert.equal(compared.name, "unavailable")
    assert.equal(compared.date, "unavailable")
})

test("marked present source prompts human review; no new attendance is produced", () => {
    const compared = compareLegacyOriginalCandidate("Aisha Binti Ali", "2026-09-13", {
        ...candidate, attendanceStatus: "present",
    })
    assert.equal(compared.originalMarkedPresent, true)
    assert.equal(Object.hasOwn(compared, "targetAttendanceStatus"), false)
})
