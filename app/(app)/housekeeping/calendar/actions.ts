"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { generateClassSessions, getMonthlyDatesForDay, type CalendarException, type SessionTemplate } from "@/lib/scheduling"

const dateSchema = z.iso.date()
const createSchema = z.object({
    branch_id: z.uuid(),
    closed_on: dateSchema,
    title: z.string().trim().min(3).max(160),
    event_type: z.enum(["holiday", "event", "closure"]),
    notes: z.string().trim().max(1000).optional(),
})
const decisionSchema = z.object({
    id: z.uuid(),
    decision: z.enum(["pending", "move", "skip", "withdrawn"]),
    target_on: z.union([dateSchema, z.literal("")]).optional(),
})

async function requireCalendarAdmin() {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) throw new Error("Please sign in to manage the Academic Calendar.")

    const { data: profile, error: profileError } = await supabase.from("profiles")
        .select("role, is_active").eq("id", user.id).single()
    if (profileError || !profile?.is_active || !["admin", "super_admin"].includes(profile.role)) {
        throw new Error("Only active administrators can change the Academic Calendar.")
    }
    return { supabase, user }
}

function calendarUrl(branch: string, month: string) {
    return `/housekeeping/calendar?branch=${encodeURIComponent(branch)}&month=${encodeURIComponent(month)}`
}

async function ensureMonthEditable(
    supabase: Awaited<ReturnType<typeof createClient>>,
    branchId: string,
    date: string
) {
    const { data, error } = await supabase.from("schedule_batches")
        .select("id, status")
        .eq("branch_id", branchId)
        .eq("schedule_month", date.slice(0, 7) + "-01")
        .in("status", ["approved", "locked"])
        .limit(1)

    if (error) throw new Error(error.message)
    if (data?.length) {
        throw new Error("This branch/month is already approved or locked. Existing classes cannot be changed from the calendar.")
    }
}

export async function createCalendarEvent(formData: FormData) {
    const { supabase, user } = await requireCalendarAdmin()
    const parsed = createSchema.safeParse({
        branch_id: formData.get("branch_id"),
        closed_on: formData.get("closed_on"),
        title: formData.get("title"),
        event_type: formData.get("event_type"),
        notes: formData.get("notes"),
    })
    if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid calendar event.")
    }

    const data = parsed.data
    await ensureMonthEditable(supabase, data.branch_id, data.closed_on)
    const { error } = await supabase.from("academic_calendar_exceptions").insert({
        branch_id: data.branch_id,
        closed_on: data.closed_on,
        title: data.title,
        event_type: data.event_type,
        notes: data.notes || null,
        decision: "pending",
        created_by: user.id,
    })
    if (error) throw new Error(error.message)

    revalidatePath("/housekeeping/calendar")
    revalidatePath("/schedule")
    redirect(calendarUrl(data.branch_id, data.closed_on.slice(0, 7)))
}

export async function setCalendarDecision(formData: FormData) {
    const { supabase } = await requireCalendarAdmin()
    const parsed = decisionSchema.safeParse({
        id: formData.get("id"),
        decision: formData.get("decision"),
        target_on: formData.get("target_on") || "",
    })
    if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid calendar decision.")
    }

    const { data: current, error: lookupError } = await supabase
        .from("academic_calendar_exceptions")
        .select("id, branch_id, closed_on, decision, target_on")
        .eq("id", parsed.data.id).single()
    if (lookupError || !current) throw new Error(lookupError?.message ?? "Event not found.")
    await ensureMonthEditable(supabase, current.branch_id, current.closed_on)

    const { decision } = parsed.data
    const target = decision === "move" ? parsed.data.target_on || null : null

    if (decision === "move") {
        if (!target || target <= current.closed_on || target.slice(0, 7) !== current.closed_on.slice(0, 7)
            || new Date(`${target}T00:00:00Z`).getUTCDay() !== new Date(`${current.closed_on}T00:00:00Z`).getUTCDay()) {
            throw new Error("Choose a later date in the same month and on the same weekday.")
        }
    }
    if (decision === "skip" && formData.get("confirm_skip") !== "yes") {
        throw new Error("Confirm that no regular class will be generated for this date.")
    }

    // Preview the updated resolution first. Ignore unrelated pending events
    // while validating this particular decision; they still block final
    // schedule generation until every affected date has been decided.
    const year = Number(current.closed_on.slice(0, 4))
    const month = Number(current.closed_on.slice(5, 7))
    const monthEnd = `${current.closed_on.slice(0, 7)}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`
    const [eventsResult, templatesResult] = await Promise.all([
        supabase.from("academic_calendar_exceptions")
            .select("id, closed_on, decision, target_on")
            .eq("branch_id", current.branch_id)
            .gte("closed_on", current.closed_on.slice(0, 7) + "-01")
            .lte("closed_on", monthEnd),
        supabase.from("session_templates")
            .select("id, branch_id, programme_id, day_of_week, start_time, end_time, regular_capacity, replacement_capacity")
            .eq("branch_id", current.branch_id).eq("is_active", true),
    ])
    if (eventsResult.error || templatesResult.error) {
        throw new Error(eventsResult.error?.message ?? templatesResult.error?.message)
    }

    const templates = (templatesResult.data ?? []) as SessionTemplate[]
    if (decision === "move" && !templates.some((session) =>
        getMonthlyDatesForDay(year, month, session.day_of_week).slice(0, 4).includes(current.closed_on)
    )) {
        throw new Error("No regular class is planned on this date. A class move is not applicable.")
    }

    const proposed: CalendarException[] = (eventsResult.data ?? []).map((event) =>
        event.id === current.id
            ? { closed_on: event.closed_on, decision, target_on: target }
            : {
                closed_on: event.closed_on,
                decision: event.decision as CalendarException["decision"],
                target_on: event.target_on,
            }
    ).filter((event) => event.decision !== "pending")

    generateClassSessions(templates, year, month, proposed)

    const { error: updateError } = await supabase
        .from("academic_calendar_exceptions")
        .update({ decision, target_on: target })
        .eq("id", current.id)
    if (updateError) throw new Error(updateError.message)

    revalidatePath("/housekeeping/calendar")
    revalidatePath("/schedule")
    redirect(calendarUrl(current.branch_id, current.closed_on.slice(0, 7)))
}
