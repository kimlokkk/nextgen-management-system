"use client"

import { useMemo, useState } from "react"
import { createEnrollment } from "@/app/(app)/enrollments/actions"

type Student = {
    id: string
    full_name: string
}

type Branch = {
    id: string
    name: string
}

type Programme = {
    id: string
    name: string
}

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

export function EnrollmentForm({
    students,
    branches,
    programmes,
    sessions,
}: EnrollmentFormProps) {
    const [branchId, setBranchId] = useState("")
    const [programmeId, setProgrammeId] = useState("")

    const availableProgrammes = useMemo(() => {
        if (!branchId) return []

        const programmeIds = new Set(
            sessions
                .filter((session) => session.branch_id === branchId)
                .map((session) => session.programme_id)
        )

        return programmes.filter((programme) =>
            programmeIds.has(programme.id)
        )
    }, [branchId, programmes, sessions])

    const availableSessions = useMemo(() => {
        if (!branchId || !programmeId) return []

        return sessions.filter(
            (session) =>
                session.branch_id === branchId &&
                session.programme_id === programmeId
        )
    }, [branchId, programmeId, sessions])

    return (
        <form
            action={createEnrollment}
            className="mt-5 grid gap-4 md:grid-cols-2"
        >
            <div>
                <label className="mb-2 block text-sm font-medium">
                    Student *
                </label>

                <select
                    name="student_id"
                    required
                    defaultValue=""
                    className="h-10 w-full rounded-lg border bg-background px-3"
                >
                    <option value="" disabled>
                        Select student
                    </option>

                    {students.map((student) => (
                        <option key={student.id} value={student.id}>
                            {student.full_name}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label className="mb-2 block text-sm font-medium">
                    Branch *
                </label>

                <select
                    name="branch_id"
                    required
                    value={branchId}
                    onChange={(e) => {
                        setBranchId(e.target.value)
                        setProgrammeId("")
                    }}
                    className="h-10 w-full rounded-lg border bg-background px-3"
                >
                    <option value="" disabled>
                        Select branch
                    </option>

                    {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                            {branch.name}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label className="mb-2 block text-sm font-medium">
                    Programme *
                </label>

                <select
                    name="programme_id"
                    required
                    value={programmeId}
                    disabled={!branchId}
                    onChange={(e) => setProgrammeId(e.target.value)}
                    className="h-10 w-full rounded-lg border bg-background px-3 disabled:opacity-50"
                >
                    <option value="" disabled>
                        {branchId
                            ? "Select programme"
                            : "Select branch first"}
                    </option>

                    {availableProgrammes.map((programme) => (
                        <option key={programme.id} value={programme.id}>
                            {programme.name}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label className="mb-2 block text-sm font-medium">
                    Regular Session *
                </label>

                <select
                    name="default_session_id"
                    required
                    defaultValue=""
                    disabled={!programmeId}
                    className="h-10 w-full rounded-lg border bg-background px-3 disabled:opacity-50"
                >
                    <option value="" disabled>
                        {programmeId
                            ? "Select session"
                            : "Select programme first"}
                    </option>

                    {availableSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                            {session.name}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label className="mb-2 block text-sm font-medium">
                    Frequency *
                </label>

                <select
                    name="frequency_type"
                    required
                    defaultValue="weekly"
                    className="h-10 w-full rounded-lg border bg-background px-3"
                >
                    <option value="weekly">Weekly</option>
                    <option value="twice_monthly">Twice Monthly</option>
                    <option value="custom">Custom</option>
                </select>
            </div>

            <div>
                <label className="mb-2 block text-sm font-medium">
                    Start Date *
                </label>

                <input
                    type="date"
                    name="start_date"
                    required
                    className="h-10 w-full rounded-lg border bg-background px-3"
                />
            </div>

            <div className="md:col-span-2">
                <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                    Add Enrollment
                </button>
            </div>
        </form>
    )
}