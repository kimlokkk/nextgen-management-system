/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")

const source = fs.readFileSync("lib/yellow-seat-usage.ts", "utf8")
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
const moduleStub = { exports: {} }
vm.runInNewContext(outputText, { module: moduleStub, exports: moduleStub.exports })
const { getYellowSeatUsage } = moduleStub.exports

const classId = "test-class"

test("81 Excel bookings are included in yellow occupancy, not attendance", () => {
    const legacy = Array.from({ length: 6 }, () => ({
        target_class_id: classId, review_state: "pending", linked_active_booking_id: null,
    }))
    const count = getYellowSeatUsage(classId, 5, [], legacy)
    assert.equal(count.active, 0)
    assert.equal(count.legacy, 6)
    assert.equal(count.occupied, 6)
    assert.equal(count.overBy, 1)
    assert.equal(count.available, 0)
})

test("modern booking and unrelated legacy reservation are both counted", () => {
    const bookings = [{
        id: "modern", class_session_id: classId, booking_type: "replacement",
        attendance_status: "upcoming",
    }]
    const legacy = [{
        target_class_id: classId, review_state: "pending", linked_active_booking_id: null,
    }]
    const count = getYellowSeatUsage(classId, 5, bookings, legacy)
    assert.equal(count.occupied, 2)
    assert.equal(count.active, 1)
    assert.equal(count.legacy, 1)
})

test("explicitly linked modern and Excel bookings count as one reservation", () => {
    const bookings = [{
        id: "modern", class_session_id: classId, booking_type: "replacement",
        attendance_status: "present",
    }]
    const legacy = [{
        target_class_id: classId, review_state: "pending", linked_active_booking_id: "modern",
    }]
    const count = getYellowSeatUsage(classId, 5, bookings, legacy)
    assert.equal(count.occupied, 1)
    assert.equal(count.legacy, 0)
})

test("cancelled linked modern booking reactivates historical reservation", () => {
    const bookings = [{
        id: "modern", class_session_id: classId, booking_type: "replacement",
        attendance_status: "cancelled",
    }]
    const legacy = [{
        target_class_id: classId, review_state: "pending", linked_active_booking_id: "modern",
    }]
    const count = getYellowSeatUsage(classId, 5, bookings, legacy)
    assert.equal(count.occupied, 1)
    assert.equal(count.active, 0)
    assert.equal(count.legacy, 1)
})

test("excluded and unrelated target records do not reserve seats", () => {
    const legacy = [
        { target_class_id: classId, review_state: "excluded", linked_active_booking_id: null },
        { target_class_id: "other", review_state: "pending", linked_active_booking_id: null },
    ]
    const count = getYellowSeatUsage(classId, 5, [], legacy)
    assert.equal(count.occupied, 0)
    assert.equal(count.available, 5)
})
