/**
 * GET /api/cron/appointment-reminders
 * Vercel cron: runs HOURLY (`0 * * * *`).
 *
 * Replaces /api/cron/day-before-reminders. Two things changed:
 *   1. Lead time is now per-company configurable (0–7 days) via
 *      `appointment_reminder.lead_days`.
 *   2. Send hour is now per-company configurable (6–20 local) via
 *      `appointment_reminder.send_hour_local`. The cron runs every hour
 *      and each company is only processed when the current wall-clock
 *      hour in its timezone equals its configured send_hour_local.
 *
 * For every phase_c-enabled company with appointment_reminder.enabled whose
 * current local hour matches, picks the right set of tasks and proposes a
 * reminder email for each one. Dedup via source_id = "<taskId>:reminder".
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride, requireSupabase } from "@/lib/supabase/helpers";
import { ClientSchedulingCommsService } from "@/lib/api/services/client-scheduling-comms-service";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

export const maxDuration = 300;

type ReminderResult = {
  companyId: string;
  remindersProposed: number;
  tasksChecked: number;
  leadDays: number;
  skipped?: "wrong_hour" | "disabled";
  error?: string;
};

/** Compute the current wall-clock hour (0-23) in the given IANA timezone. */
function currentHourInTimezone(timezone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) return new Date().getUTCHours();
    const n = Number(hourPart.value);
    // Intl can return "24" for midnight in some locales — normalize to 0.
    return Number.isFinite(n) ? n % 24 : new Date().getUTCHours();
  } catch {
    // Invalid timezone — fall back to UTC so we at least fire somewhere.
    return new Date().getUTCHours();
  }
}

async function findDefaultUserForCompany(
  companyId: string
): Promise<string | null> {
  const supabase = requireSupabase();

  const { data: admin } = await supabase
    .from("users")
    .select("id")
    .eq("company_id", companyId)
    .in("role", ["admin", "owner"])
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (admin?.id) return admin.id as string;

  const { data: anyUser } = await supabase
    .from("users")
    .select("id")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  return (anyUser?.id as string) ?? null;
}

async function processCompany(companyId: string): Promise<ReminderResult> {
  const settings = await ClientSchedulingCommsService.getSettings(companyId);
  const leadDays = settings.appointment_reminder.lead_days;

  if (!settings.appointment_reminder.enabled) {
    return {
      companyId,
      remindersProposed: 0,
      tasksChecked: 0,
      leadDays,
      skipped: "disabled",
    };
  }

  // Per-company timezone hour check — only process if the current local hour
  // matches the configured send_hour_local.
  const supabaseCheck = requireSupabase();
  const { data: companyRow } = await supabaseCheck
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle();
  const timezone =
    (companyRow?.timezone as string) || "America/Vancouver";
  const currentLocalHour = currentHourInTimezone(timezone);
  if (currentLocalHour !== settings.appointment_reminder.send_hour_local) {
    return {
      companyId,
      remindersProposed: 0,
      tasksChecked: 0,
      leadDays,
      skipped: "wrong_hour",
    };
  }

  const userId = await findDefaultUserForCompany(companyId);
  if (!userId) {
    return { companyId, remindersProposed: 0, tasksChecked: 0, leadDays };
  }

  const supabase = requireSupabase();

  const candidateTasks =
    await ClientSchedulingCommsService.listTasksScheduledForLeadDays(
      companyId,
      leadDays
    );

  if (candidateTasks.length === 0) {
    return { companyId, remindersProposed: 0, tasksChecked: 0, leadDays };
  }

  // Skip tasks that already have a pending/approved/executed reminder
  // action. Dedupe against BOTH the new and legacy source_id / action_type
  // so migration can't create duplicate proposals. Legacy rows still
  // deserialize via the SendDayBeforeReminderActionData alias.
  const newSourceIds = candidateTasks.map((t) => `${t.taskId}:reminder`);
  const legacySourceIds = candidateTasks.map((t) => `${t.taskId}:day_before`);
  const { data: existingActions } = await supabase
    .from("agent_actions")
    .select("source_id, status")
    .eq("company_id", companyId)
    .in("action_type", ["send_appointment_reminder", "send_day_before_reminder"])
    .in("source_id", [...newSourceIds, ...legacySourceIds]);

  const skipTaskIds = new Set<string>();
  for (const row of existingActions ?? []) {
    const status = row.status as string;
    if (["pending", "approved", "executed"].includes(status)) {
      const sid = row.source_id as string;
      // Strip the suffix to get the taskId
      const taskId = sid.replace(/:reminder$|:day_before$/, "");
      skipTaskIds.add(taskId);
    }
  }

  let proposed = 0;
  for (const { taskId } of candidateTasks) {
    if (skipTaskIds.has(taskId)) continue;
    try {
      const actionId = await ClientSchedulingCommsService.sendAppointmentReminder(
        companyId,
        taskId,
        userId
      );
      if (actionId) proposed++;
    } catch (err) {
      console.error(
        `[cron/appointment-reminders] task ${taskId} failed:`,
        err
      );
    }
  }

  return {
    companyId,
    remindersProposed: proposed,
    tasksChecked: candidateTasks.length,
    leadDays,
  };
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
    const { data: companies, error } = await supabase
      .from("companies")
      .select("id")
      .limit(500);

    if (error) throw error;

    const allCompanyIds = (companies ?? []).map((c) => c.id as string);

    const phaseCChecks = await Promise.allSettled(
      allCompanyIds.map(async (companyId) => {
        const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
          companyId,
          "phase_c"
        );
        return { companyId, enabled };
      })
    );
    const phaseCCompanyIds = phaseCChecks
      .filter(
        (r): r is PromiseFulfilledResult<{ companyId: string; enabled: boolean }> =>
          r.status === "fulfilled" && r.value.enabled
      )
      .map((r) => r.value.companyId);

    const CHUNK_SIZE = 10;
    const results: ReminderResult[] = [];

    for (let i = 0; i < phaseCCompanyIds.length; i += CHUNK_SIZE) {
      const chunk = phaseCCompanyIds.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map((companyId) => processCompany(companyId))
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const r = chunkResults[j];
        if (r.status === "fulfilled") {
          // Only log actionable results — skip "wrong_hour" (noisy every hour)
          if (r.value.skipped === "wrong_hour") continue;
          if (
            r.value.remindersProposed > 0 ||
            r.value.tasksChecked > 0 ||
            r.value.skipped === "disabled"
          ) {
            results.push(r.value);
          }
        } else {
          results.push({
            companyId: chunk[j],
            remindersProposed: 0,
            tasksChecked: 0,
            leadDays: 0,
            error: r.reason?.message ?? "Unknown error",
          });
        }
      }
    }

    const totalReminders = results.reduce((s, r) => s + r.remindersProposed, 0);
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      companiesProcessed: phaseCCompanyIds.length,
      totalReminders,
      errors: errors.length,
      details: results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/appointment-reminders]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
