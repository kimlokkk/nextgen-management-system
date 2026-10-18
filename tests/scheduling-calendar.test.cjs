// Offline unit checks for the calendar-aware generator (no Supabase data).
// This is a Node CommonJS test harness, so require() is intentional here.
/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")

// Keep tests dependency-free beyond the repo's existing TypeScript dev dep.
const source = fs.readFileSync("lib/scheduling.ts", "utf8")
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
const moduleStub = { exports: {} }
vm.runInNewContext(outputText, { module: moduleStub, exports: moduleStub.exports, Date, Set, Map, String, Number })
const { generateClassSessions, getMonthlyDatesForDay, getMonthlyTeachingCycle } = moduleStub.exports

const cyberjayaSat = [{
    id: "session-1", branch_id: "cyberjaya", programme_id: "jm",
    day_of_week: 6, start_time: "09:00", end_time: "10:30",
    regular_capacity: 10, replacement_capacity: 5,
}]
const baseline = () => generateClassSessions(cyberjayaSat, 2026, 10)
const closure = (decision, target_on = null) =>
    [{ closed_on: "2026-10-24", decision, target_on }]

test("October 2026 Saturday dates include a fifth Saturday", () => {
    assert.deepEqual(Array.from(getMonthlyDatesForDay(2026, 10, 6)),
        ["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"])
})

test("default stays W1-W4 on October 3/10/17/24", () => {
    assert.deepEqual(Array.from(baseline(), item => item.class_date),
        ["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24"])
    assert.deepEqual(Array.from(baseline(), item => item.week_number), [1, 2, 3, 4])
})

test("admin move 24 to 31 preserves lesson W4 rather than creating makeup", () => {
    const rows = generateClassSessions(cyberjayaSat, 2026, 10, closure("move", "2026-10-31"))
    assert.equal(rows.length, 4)
    assert.equal(rows[3].class_date, "2026-10-31")
    assert.equal(rows[3].week_number, 4)
    assert.equal(rows[3].regular_capacity, 10)
    assert.equal(rows.filter(row => row.class_date === "2026-10-24").length, 0)
})

test("skip cancels W4 without inventing another class or replacement", () => {
    const rows = generateClassSessions(cyberjayaSat, 2026, 10, closure("skip"))
    assert.deepEqual(Array.from(rows, row => row.week_number), [1, 2, 3])
    assert.equal(rows.length, 3)
})

test("pending closure on teaching day blocks generation", () => {
    assert.throws(() => generateClassSessions(cyberjayaSat, 2026, 10, closure("pending")),
        /pending/)
})

test("withdrawn event restores original W4", () => {
    assert.deepEqual(Array.from(generateClassSessions(cyberjayaSat, 2026, 10, closure("withdrawn")), x => x.class_date),
        Array.from(baseline(), x => x.class_date))
})

test("moving into an existing W2 class date is rejected", () => {
    assert.throws(() => generateClassSessions(cyberjayaSat, 2026, 10, [{
        closed_on: "2026-10-03", decision: "move", target_on: "2026-10-10",
    }]), /already used/)
})

test("cannot move onto another closure, even a pending event", () => {
    assert.throws(() => generateClassSessions(cyberjayaSat, 2026, 10, [
        ...closure("move", "2026-10-31"),
        { closed_on: "2026-10-31", decision: "pending", target_on: null },
    ]), /destination has a calendar event/)
})

test("cannot move to a Friday or another month", () => {
    for (const target of ["2026-10-30", "2026-11-07"]) {
        assert.throws(() => generateClassSessions(cyberjayaSat, 2026, 10, closure("move", target)),
            /Invalid move date/)
    }
})

test("branch-specific programmes sharing a slot move consistently", () => {
    const yc = { ...cyberjayaSat[0], id: "session-2", programme_id: "yc" }
    const rows = generateClassSessions([cyberjayaSat[0], yc], 2026, 10, closure("move", "2026-10-31"))
    assert.equal(rows.length, 8)
    assert.equal(rows.filter(x => x.class_date === "2026-10-31").length, 2)
})

test("October Saturday W5 is an administrative transition, not an automatic fifth class", () => {
    const cycle = getMonthlyTeachingCycle(2026, 10, 6)
    assert.equal(cycle.transitionWeek, 5)
    assert.equal(cycle.transitionDate, "2026-10-31")
    assert.equal(cycle.transitionOnly, true)
    assert.equal(cycle.nextMonth, "2026-11")
    assert.equal(cycle.regularDates.length, 4)
    assert.equal(baseline().length, 4)
    assert.equal(baseline().some(x => x.week_number === 5), false)
})

test("October Sunday W4 is both a regular week and the transition week", () => {
    const cycle = getMonthlyTeachingCycle(2026, 10, 0)
    assert.equal(cycle.transitionWeek, 4)
    assert.equal(cycle.transitionDate, "2026-10-25")
    assert.equal(cycle.transitionOnly, false)
    assert.deepEqual(Array.from(cycle.regularDates), [
        "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25",
    ])
})

test("transition week works for four-week months and December year rollover", () => {
    const feb = getMonthlyTeachingCycle(2026, 2, 6)
    assert.equal(feb.transitionWeek, 4)
    assert.equal(feb.transitionDate, "2026-02-28")
    assert.equal(feb.transitionOnly, false)
    assert.equal(getMonthlyTeachingCycle(2026, 12, 6).nextMonth, "2027-01")
})

test("an explicit W4 move onto a transition-only W5 date keeps W4 lesson identity", () => {
    const cycle = getMonthlyTeachingCycle(2026, 10, 6)
    const moved = generateClassSessions(cyberjayaSat, 2026, 10, closure("move", cycle.transitionDate))
    assert.equal(cycle.transitionWeek, 5)
    assert.equal(moved.length, 4)
    assert.equal(moved[3].week_number, 4)
    assert.equal(moved[3].class_date, "2026-10-31")
})
