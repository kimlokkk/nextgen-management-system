import { generateClassSessions, type CalendarException, type SessionTemplate } from "@/lib/scheduling"

export type PreviewEnrollment = {
    id: string
    student_id: string
    branch_id: string
    programme_id: string
    default_session_id: string | null
    frequency_type: string
    preferred_weeks: number[] | null
    start_date: string
    end_date: string | null
    status: string
}
export type PreviewStudent = { id: string; status: string }
export type PreviewBatch = { id: string; status: string }
export type PreviewInput = {
    templates: SessionTemplate[]
    enrollments: PreviewEnrollment[]
    students: PreviewStudent[]
    calendar: CalendarException[]
    existingBatch: PreviewBatch | null
}
export type PreviewIssue = {
    level: "blocker" | "review"
    code: string
    detail: string
}
export type ClassPreview = {
    templateId: string
    programmeId: string
    date: string
    week: number
    start: string
    end: string
    regularCapacity: number
    expectedRegular: number
}
export type NovemberPreflight = {
    classes: ClassPreview[]
    issues: PreviewIssue[]
    activeEnrollments: number
    expectedBookings: number
    classCount: number
    overloadedClasses: number
    unmatchedEnrollments: number
    canGenerateNewDraft: boolean
}

/**
 * Mirrors the EXISTING regular-booking generator's date/frequency eligibility
 * as a preview, and adds stricter data-quality blocks before first production use.
 * Does not insert, update, delete or approve any session, booking or entitlement.
 */
export function isEligibleForPlannedClass(e: PreviewEnrollment, cls: {
    session_template_id: string; class_date: string; week_number: number
}) {
    if (e.status !== "active") return false
    if (e.default_session_id !== cls.session_template_id) return false
    if (e.start_date > cls.class_date || (e.end_date && e.end_date < cls.class_date)) return false
    if (e.frequency_type === "weekly") return true
    return (e.preferred_weeks ?? []).includes(cls.week_number)
}

export function buildNovemberPreflight(input: PreviewInput): NovemberPreflight {
    const issues: PreviewIssue[]=[]
    const issue = (level:PreviewIssue["level"], code:string, detail:string) =>
        issues.push({level,code,detail})
    const active = input.enrollments.filter(e=>e.status==="active")
    const templateById = new Map(input.templates.map(t=>[t.id,t]))
    const studentById = new Map(input.students.map(s=>[s.id,s]))
    let classes:ClassPreview[]=[]
    if (!input.templates.length) issue("blocker","NO_TEMPLATES","No active MTDC class templates found.")
    if (input.existingBatch) issue("blocker","BATCH_EXISTS",
        `A November batch already exists (${input.existingBatch.status}). Do not regenerate: the current generator deletes and rebuilds drafts.`)

    const missingTemplate = active.filter(e=>!e.default_session_id ||
       !templateById.has(e.default_session_id) ||
       templateById.get(e.default_session_id)?.branch_id !== e.branch_id ||
       templateById.get(e.default_session_id)?.programme_id !== e.programme_id).length
    if(missingTemplate)issue("blocker","ENROLLMENT_TEMPLATE_MISMATCH",
        `${missingTemplate} active enrollment(s) are missing an active or matching class template.`)
    const inactiveStudent = active.filter(e=>studentById.get(e.student_id)?.status!=="active").length
    if(inactiveStudent)issue("blocker","INACTIVE_STUDENT",
        `${inactiveStudent} active enrollment(s) refer to an inactive or missing student.`)
    const missingWeeks = active.filter(e=>e.frequency_type!=="weekly" &&
        !(e.preferred_weeks??[]).some(w=>[1,2,3,4].includes(w))).length
    if(missingWeeks)issue("blocker","MISSING_PREFERRED_WEEKS",
        `${missingWeeks} non-weekly enrollment(s) have no valid teaching week from W1 to W4.`)

    let generated:ReturnType<typeof generateClassSessions>=[]
    if(input.templates.length) {
        try {
            generated=generateClassSessions(input.templates,2026,11,input.calendar)
        } catch(error) {
            issue("blocker","ACADEMIC_CALENDAR",
                error instanceof Error ? error.message : "Unable to generate calendar dates.")
        }
    }
    const matched=new Set<string>()
    let bookings=0
    let overloaded=0
    for(const session of generated) {
        const qualified=active.filter(e=>isEligibleForPlannedClass(e,session))
        const uniqueStudents=new Set(qualified.map(e=>e.student_id))
        if(uniqueStudents.size!==qualified.length)issue("blocker","DOUBLE_BOOKED_STUDENT",
            `${session.class_date} ${session.start_time}: multiple enrollment rows assign the same student to this class.`)
        for(const e of qualified)matched.add(e.id)
        if(qualified.length>session.regular_capacity){
            overloaded++
            issue("blocker","REGULAR_CAPACITY",
                `${session.class_date} ${session.start_time}: ${qualified.length} expected regular bookings exceed capacity ${session.regular_capacity}.`)
        }
        bookings+=qualified.length
        classes.push({
            templateId:session.session_template_id,
            programmeId:session.programme_id,
            date:session.class_date,
            week:session.week_number,
            start:session.start_time,
            end:session.end_time,
            regularCapacity:session.regular_capacity,
            expectedRegular:qualified.length,
        })
    }
    const unmatched=active.filter(e=>!matched.has(e.id)).length
    if(unmatched&&generated.length)issue("review","NO_NOVEMBER_BOOKINGS",
        `${unmatched} active enrollment(s) would receive zero bookings in November. Verify dates, frequency and class assignment.`)
    if(!active.length) issue("blocker","NO_ACTIVE_ENROLLMENTS","No active MTDC enrollments found.")
    if(!generated.length && !issues.some(x=>x.code==="ACADEMIC_CALENDAR"))
        issue("blocker","NO_CLASSES","No November class sessions are projected.")
    classes=classes.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.templateId.localeCompare(b.templateId))
    return {
        classes,issues,activeEnrollments:active.length,expectedBookings:bookings,
        classCount:classes.length,overloadedClasses:overloaded,unmatchedEnrollments:unmatched,
        canGenerateNewDraft:issues.every(x=>x.level!=="blocker"),
    }
}
