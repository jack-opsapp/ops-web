// GET /api/cron/recurrence-generate
//
// Vercel cron: runs every 4 hours at minute 59.
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
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
} from "@/lib/api/services/cron-workload-cursor-service";

export const maxDuration = 300;

const RECURRENCE_HORIZON_DAYS = 60;
const NEXT_GENERATION_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
const MAX_RECURRENCES_PER_RUN = 10;
const MAX_OCCURRENCES_PER_RECURRENCE = 25;
const WORKLOAD_KEY = "recurrence-generate";

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
    const windowStartKey = format(now, "yyyy-MM-dd");
    const windowEndKey = format(horizonEnd, "yyyy-MM-dd");
    const allOccurrences = rule.between(
      new Date(`${windowStartKey}T00:00:00Z`),
      horizonEnd,
      true
    );

    // Pull only exceptions inside this generation horizon.
    const { data: exceptionRows, error: excErr } = await supabase
      .from("task_recurrence_exceptions")
      .select("*")
      .eq("recurrence_id", recurrence.id)
      .gte("original_date", windowStartKey)
      .lte("original_date", windowEndKey);
    if (excErr) {
      throw new CronDatabaseOperationError(
        "recurrence exception read failed",
        { cause: excErr }
      );
    }
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
      .is("deleted_at", null)
      .gte("recurrence_origin_date", windowStartKey)
      .lte("recurrence_origin_date", windowEndKey);
    if (existErr) {
      throw new CronDatabaseOperationError(
        "recurrence existing-task read failed",
        { cause: existErr }
      );
    }
    const existingOrigins = new Set<string>(
      (existingRows ?? [])
        .map((r) => r.recurrence_origin_date as string | null)
        .filter((v): v is string => Boolean(v))
    );

    const pendingOccurrences = allOccurrences.filter((occurrence) => {
      const originalDate = toDateKey(occurrence);
      return (
        !existingOrigins.has(originalDate) &&
        exceptions.get(originalDate)?.action !== "skip"
      );
    });
    const occurrences = pendingOccurrences.slice(
      0,
      MAX_OCCURRENCES_PER_RECURRENCE
    );
    const hasMore = pendingOccurrences.length > occurrences.length;
    result.occurrencesConsidered = occurrences.length;

    for (const occurrence of occurrences) {
      const originalDate = toDateKey(occurrence);
      const exception = exceptions.get(originalDate);

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
        throw new CronDatabaseOperationError(
          "recurrence task insert failed",
          { cause: insertErr }
        );
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
          Date.now() + (hasMore ? 0 : NEXT_GENERATION_INTERVAL_MS)
        ).toISOString(),
      })
      .eq("id", recurrence.id);
    if (bumpErr) {
      throw new CronDatabaseOperationError(
        "recurrence checkpoint update failed",
        { cause: bumpErr }
      );
    }
  } catch (err) {
    if (
      err instanceof CronDatabaseOperationError ||
      isDatabasePressureError(err)
    ) {
      throw err;
    }
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
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: async (lease) => {
        const cursor = await readCronWorkloadCursor(
          supabase,
          WORKLOAD_KEY,
          lease
        );
        const dueAt = new Date().toISOString();

        async function readPage(afterId: string | null) {
          let query = supabase
            .from("task_recurrences")
            .select("*")
            .is("deleted_at", null)
            .lte("next_generation_at", dueAt)
            .order("id", { ascending: true });
          if (afterId) query = query.gt("id", afterId);
          return query.limit(MAX_RECURRENCES_PER_RUN);
        }

        let page = await readPage(cursor);
        if (page.error) {
          throw new CronDatabaseOperationError(
            "due recurrence page read failed",
            { cause: page.error }
          );
        }
        let recurrences = (page.data ?? []) as RecurrenceRow[];
        if (recurrences.length === 0 && cursor) {
          page = await readPage(null);
          if (page.error) {
            throw new CronDatabaseOperationError(
              "wrapped recurrence page read failed",
              { cause: page.error }
            );
          }
          recurrences = (page.data ?? []) as RecurrenceRow[];
        }

        const results: ProcessResult[] = [];
        for (const recurrence of recurrences) {
          results.push(await processRecurrence(supabase, recurrence));
        }

        await advanceCronWorkloadCursor(
          supabase,
          WORKLOAD_KEY,
          lease,
          cursor,
          recurrences.length === MAX_RECURRENCES_PER_RUN
            ? recurrences[recurrences.length - 1].id
            : null
        );

        const totalInserted = results.reduce(
          (sum, result) => sum + result.tasksInserted,
          0
        );
        const errors = results.filter((result) => result.error);
        return {
          recurrences,
          results,
          totalInserted,
          errors,
        };
      },
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: alreadyRunning,
          ran: false,
          reason: alreadyRunning ? "already_running" : controlled.reason,
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    return NextResponse.json({
      ok: true,
      ran: true,
      recurrences_processed: controlled.value.recurrences.length,
      tasks_generated: controlled.value.totalInserted,
      // Backward-compatible response field. Notification delivery is now
      // asynchronous from immutable task mutation proof.
      notifications_sent: 0,
      errors: controlled.value.errors.length,
      details: controlled.value.results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/recurrence-generate]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
