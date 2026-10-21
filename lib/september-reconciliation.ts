
/** Text-only candidate comparison; never determine attendance, identity or entitlement. */
export type SeptemberEvidence = {
    source_ref: string
    source_tab: string
    source_row: number
    evidence_kind: "regular_roster" | "legacy_replacement"
    student_name: string
    class_date: string
    start_time: string
    end_time: string
    space_label: string | null
    course: string | null
    module_raw: string | null
    attendance_raw: string | null
    original_date: string | null
}
export type SeptemberComparison = {
    roster: SeptemberEvidence[]
    possibleNameVariation: SeptemberEvidence[]
    sameOriginReplacement: SeptemberEvidence[]
}
const key = (value: string) => value.normalize("NFKC").toUpperCase()
    .replace(/\*\*NEW\s*SEP/gi, "").replace(/[^A-Z0-9]/g, "")
function isNameVariation(a: string,b: string) {
    const x=key(a),y=key(b)
    return x !== y && Math.min(x.length,y.length) >= 8
        && (x.startsWith(y) || y.startsWith(x))
}
export function compareSeptemberEvidence(
    studentName: string, originalDate: string | null,
    evidence: SeptemberEvidence[],
): SeptemberComparison {
    const empty = {roster:[],possibleNameVariation:[],sameOriginReplacement:[]}
    if (!originalDate || !originalDate.startsWith("2026-09-")) return empty
    return {
        roster: evidence.filter(x=>x.evidence_kind==="regular_roster"
            && x.class_date===originalDate && key(x.student_name)===key(studentName)),
        possibleNameVariation: evidence.filter(x=>x.evidence_kind==="regular_roster"
            && x.class_date===originalDate && isNameVariation(x.student_name,studentName)),
        sameOriginReplacement: evidence.filter(x=>x.evidence_kind==="legacy_replacement"
            && x.original_date===originalDate && key(x.student_name)===key(studentName)),
    }
}
