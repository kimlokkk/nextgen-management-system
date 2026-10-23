/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")

const source = fs.readFileSync("lib/schedule-display.ts", "utf8")
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
const moduleStub = { exports: {} }
vm.runInNewContext(outputText, { module: moduleStub, exports: moduleStub.exports })
const { compactSessionTemplateLabel } = moduleStub.exports

test("MTDC space 1 label drops duplicated day/time/programme", () => {
    assert.equal(compactSessionTemplateLabel("MTDC Source Space 1 SAT 14:00 - Junior Maker"),
        "MTDC Source Space 1")
})

test("MTDC space 2 keeps room identity, not repeat the slot label", () => {
    assert.equal(compactSessionTemplateLabel("MTDC Source Space 2 SUN 09:00 - Young Coder"),
        "MTDC Source Space 2")
})

test("non-MTDC template names are preserved for other branches", () => {
    assert.equal(compactSessionTemplateLabel("Saturday Beginners - 09:00"), "Saturday Beginners - 09:00")
})
