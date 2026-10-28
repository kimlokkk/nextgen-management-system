"use client"

import { useMemo, useState } from "react"
import { createEnrollment } from "@/app/(app)/enrollments/actions"
import { FormSubmit } from "@/components/form-submit"
import { WeekPicker } from "@/components/enrollment-row-actions"

type Student = { id: string; full_name: string }
type Branch = { id: string; name: string }
type Programme = { id: string; name: string }
type Session = {
    id: string
    name: string
    branch_id: string
    programme_id: string
    start_time: string
    end_time: string
}

type EnrollmentFormProps = {
    students: Student[]
    branches: Branch[]
    programmes: Programme[]
    sessions: Session[]
}

const field = "h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50"

export function EnrollmentForm({ students, branches, programmes, sessions }: EnrollmentFormProps) {
    const [branchId, setBranchId] = useState("")
    const [programmeId, setProgrammeId] = useState("")
    const [sessionId, setSessionId] = useState("")
    const [frequency, setFrequency] = useState("weekly")

    const availableProgrammes = useMemo(() => {
        if (!branchId) return []
        const ids = new Set(sessions.filter((session) => session.branch_id === branchId)
            .map((session) => session.programme_id))
        return programmes.filter((programme) => ids.has(programme.id))
    }, [branchId, programmes, sessions])

    const availableSessions = useMemo(
        () => sessions.filter((session) =>
            session.branch_id === branchId && session.programme_id === programmeId),
        [branchId, programmeId, sessions],
    )

    return (
        <form action={createEnrollment} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
                <label htmlFor="enrollment-student" className="mb-2 block text-sm font-medium">Student <span aria-hidden="true" className="text-destructive">*</span></label>
                <select id="enrollment-student" name="student_id" required defaultValue="" className={field}>
                    <option value="" disabled>Select a student</option>
                    {students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}
                </select>
            </div>
            <div>
                <label htmlFor="enrollment-branch" className="mb-2 block text-sm font-medium">Branch <span aria-hidden="true" className="text-destructive">*</span></label>
                <select id="enrollment-branch" name="branch_id" required value={branchId}
                    onChange={(event) => {
                        setBranchId(event.target.value)
                        setProgrammeId("")
                        setSessionId("")
                    }}
                    className={field}>
                    <option value="" disabled>Select branch</option>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
            </div>
            <div>
                <label htmlFor="enrollment-programme" className="mb-2 block text-sm font-medium">Programme <span aria-hidden="true" className="text-destructive">*</span></label>
                <select id="enrollment-programme" name="programme_id" required value={programmeId}
                    disabled={!branchId}
                    onChange={(event) => { setProgrammeId(event.target.value); setSessionId("") }}
                    className={field}>
                    <option value="" disabled>{branchId ? "Select programme" : "Choose branch first"}</option>
                    {availableProgrammes.map((programme) =>
                        <option key={programme.id} value={programme.id}>{programme.name}</option>)}
                </select>
            </div>
            <div className="sm:col-span-2">
                <label htmlFor="enrollment-session" className="mb-2 block text-sm font-medium">Regular session <span aria-hidden="true" className="text-destructive">*</span></label>
                <select id="enrollment-session" name="default_session_id" required
                    value={sessionId}
                    disabled={!programmeId}
                    onChange={(event) => setSessionId(event.target.value)}
                    className={field}>
                    <option value="" disabled>{programmeId ? "Select class day and time" : "Choose programme first"}</option>
                    {availableSessions.map((session) =>
                        <option key={session.id} value={session.id}>
                            {session.name} · {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}
                        </option>)}
                </select>
                <p className="mt-1.5 text-xs text-muted-foreground">Sessions depend on the branch and programme selected.</p>
            </div>
            <div>
                <label htmlFor="enrollment-frequency" className="mb-2 block text-sm font-medium">Frequency <span aria-hidden="true" className="text-destructive">*</span></label>
                <select id="enrollment-frequency" name="frequency_type" required value={frequency}
                    onChange={(event) => setFrequency(event.target.value)} className={field}>
                    <option value="weekly">Weekly</option>
                    <option value="twice_monthly">Twice monthly</option>
                    <option value="custom">Custom</option>
                </select>
            </div>
            {frequency !== "weekly" && <div className="sm:col-span-2"><WeekPicker defaultWeeks={[]} /></div>}
            <div>
                <label htmlFor="enrollment-start-date" className="mb-2 block text-sm font-medium">Start date <span aria-hidden="true" className="text-destructive">*</span></label>
                <input id="enrollment-start-date" type="date" name="start_date" required className={field} />
            </div>
            <div className="sm:col-span-2 border-t pt-4">
                <FormSubmit>Add enrollment</FormSubmit>
            </div>
        </form>
    )
}
