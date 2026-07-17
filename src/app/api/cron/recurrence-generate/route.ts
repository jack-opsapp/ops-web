// GET /api/cron/recurrence-generate
//
// Vercel cron: runs every 4 hours (schedule "0 */4 * * *" in vercel.json).
//
// For every active task_recurrences row whose next_generation_at <= NOW(),
// expand the RRULE up to RECURRENCE_HORIZON_DAYS in the future, apply any
// task_recurrence_exceptions, and insert concrete project_tasks. Idempotent:
// the unique index uq_project_tasks_recurrence_origin prevents duplicate
// inserts on repeat runs.
//
// The project_tasks insert trigger writes immutable assignment/schedule proof
// and a durable notification delivery. This route never inserts notification
// rows or sends push directly.

import { NextRequest, NextResponse } from "next/server";
import { RRule } from "rrule";
import { addDays, format } from "date-fns";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

const RECURRENCE_HORIZON_DAYS = 60;
const NEXT_GENERATION_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h

interface RecurrenceRow {
  id: string;
  company_id: string;
  project_id: string | null;
  client_id: string | null;
  task_type_id: string | null;
  title: string;
  team_member_ids: string[];
  rrule: string;
  start_anchor: string;
  end_anchor: string | null;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  duration: number;
  notes: string | null;
}

interface ExceptionRow {
  recurrence_id: string;
  original_date: string;
  action: "skip" | "reschedule";
  new_date: string | null;
  new_start_time: string | null;
  new_end_time: string | null;
  new_team_member_ids: string[] | null;
}

interface ProcessResult {
  recurrenceId: string;
  occurrencesConsidered: number;
  tasksInserted: number;
  error?: string;
}

/**
 * Convert an ISO date (Date) to YYYY-MM-DD using local-clock semantics.
 * RRULE dates returned by rrule.js are JS Dates pinned to UTC midnight at
 * each occurrence — we treat them as date-only.
 */
function toDateKey(d: Date): string {
  // rrule.js returns dates in UTC, so use UTC parts to extract the date.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Build an absolute timestamp from a date-key (YYYY-MM-DD) and optional time
 * (HH:mm:ss). When time is null, use 00:00:00 in UTC. The result is what we
 * write to project_tasks.start_date / end_date (`timestamptz`).
 */
function toIsoAt(dateKey: string, time: string | null): string {
  const t = time ?? "00:00:00";
  return new Date(`${dateKey}T${t}Z`).toISOString();
}

async function processRecurrence(
  supabase: SupabaseClient,
  recurrence: RecurrenceRow
): Promise<ProcessResult> {
  const result: ProcessResult = {
    recurrenceId: recurrence.id,
    occurrencesConsidered: 0,
    tasksInserted: 0,
  };

  try {
    // Build the RRULE. Anchor DTSTART at start_anchor as UTC midnight so
    // expansion produces date-only candidates that we can map back to the
    // company's local clock without timezone arithmetic.
    const dtstart = new Date(`${recurrence.start_anchor}T00:00:00Z`);
    const ruleOpts = RRule.parseString(recurrence.rrule);
    ruleOpts.dtstart = dtstart;
    if (recurrence.end_anchor) {
      // Cap the rule at end_anchor (inclusive).
      ruleOpts.until = new Date(`${recurrence.end_anchor}T23:59:59Z`);
    }
    const rule = new RRule(ruleOpts);

    // Window: NOW() through NOW() + horizon. Trim to end_anchor if set.
    const now = new Date();
    const horizonEnd = addDays(now, RECURRENCE_HORIZON_DAYS);
    const occurrences = rule.between(
      new Date(`${format(now, "yyyy-MM-dd")}T00:00:00Z`),
      horizonEnd,
      true
    );
    result.occurrencesConsidered = occurrences.length;

    // Pull all exceptions for this recurrence in one shot.
    const { data: exceptionRows, error: excErr } = await supabase
      .from("task_recurrence_exceptions")
      .select("*")
      .eq("recurrence_id", recurrence.id);
    if (excErr) throw excErr;
    const exceptions = new Map<string, ExceptionRow>();
    for (const row of (exceptionRows ?? []) as ExceptionRow[]) {
      exceptions.set(row.original_date, row);
    }

    // Pull existing generated tasks within the window so we can skip
    // already-generated occurrences (idempotency without relying on conflict
    // races). The unique index is the final guard.
    const { data: existingRows, error: existErr } = await supabase
      .from("project_tasks")
      .select("recurrence_origin_date")
      .eq("recurrence_id", recurrence.id)
      .is("deleted_at", null);
    if (existErr) throw existErr;
    const existingOrigins = new Set<string>(
      (existingRows ?? [])
        .map((r) => r.recurrence_origin_date as string | null)
        .filter((v): v is string => Boolean(v))
    );

    for (const occurrence of occurrences) {
      const originalDate = toDateKey(occurrence);
      if (existingOrigins.has(originalDate)) continue;

      const exception = exceptions.get(originalDate);

      if (exception?.action === "skip") continue;

      // Resolve effective fields (template defaults + exception overrides).
      const effectiveDate = exception?.new_date ?? originalDate;
      const effectiveStartTime =
        exception?.new_start_time ?? recurrence.start_time ?? null;
      const effectiveEndTime =
        exception?.new_end_time ?? recurrence.end_time ?? null;
      const effectiveTeam =
        exception?.new_team_member_ids ?? recurrence.team_member_ids;

      // Compute end_date from duration (in days). Duration of 1 means
      // start and end fall on the same day.
      const durationDays = Math.max(recurrence.duration, 1);
      const endDateKey = format(
        addDays(new Date(`${effectiveDate}T00:00:00Z`), Math.max(durationDays - 1, 0)),
        "yyyy-MM-dd"
      );

      const taskRow = {
        company_id: recurrence.company_id,
        project_id: recurrence.project_id,
        task_type_id: recurrence.task_type_id,
        custom_title: recurrence.title,
        task_notes: recurrence.notes,
        status: "active" as const,
        display_order: 0,
        team_member_ids: effectiveTeam,
        start_date: toIsoAt(effectiveDate, recurrence.all_day ? null : effectiveStartTime),
        end_date: toIsoAt(endDateKey, recurrence.all_day ? null : effectiveEndTime),
        duration: durationDays,
        start_time: recurrence.all_day ? null : effectiveStartTime,
        end_time: recurrence.all_day ? null : effectiveEndTime,
        all_day: recurrence.all_day,
        recurrence_id: recurrence.id,
        recurrence_origin_date: originalDate,
      };

      const { data: insertedTask, error: insertErr } = await supabase
        .from("project_tasks")
        .insert(taskRow)
        .select("id")
        .maybeSingle();

      if (insertErr) {
        // Unique-conflict on (recurrence_id, recurrence_origin_date) means
        // a concurrent run already inserted this — skip silently.
        if ((insertErr as { code?: string }).code === "23505") continue;
        throw insertErr;
      }
      if (!insertedTask) continue;

      result.tasksInserted++;
    }

    // Bump checkpoint regardless — even if we wrote nothing this pass, the
    // window is up to date until next interval.
    const { error: bumpErr } = await supabase
      .from("task_recurrences")
      .update({
        next_generation_at: new Date(
          Date.now() + NEXT_GENERATION_INTERVAL_MS
        ).toISOString(),
      })
      .eq("id", recurrence.id);
    if (bumpErr) throw bumpErr;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(
      `[cron/recurrence-generate] recurrence ${recurrence.id} failed:`,
      result.error
    );
  }

  return result;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const { data: due, error } = await supabase
      .from("task_recurrences")
      .select("*")
      .is("deleted_at", null)
      .lte("next_generation_at", new Date().toISOString())
      .limit(500);
    if (error) throw error;

    const recurrences = (due ?? []) as RecurrenceRow[];

    const results: ProcessResult[] = [];
    for (const r of recurrences) {
      const result = await processRecurrence(supabase, r);
      results.push(result);
    }

    const totalInserted = results.reduce((s, r) => s + r.tasksInserted, 0);
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      recurrences_processed: recurrences.length,
      tasks_generated: totalInserted,
      // Backward-compatible response field. Notification delivery is now
      // asynchronous from immutable task mutation proof.
      notifications_sent: 0,
      errors: errors.length,
      details: results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/recurrence-generate]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
