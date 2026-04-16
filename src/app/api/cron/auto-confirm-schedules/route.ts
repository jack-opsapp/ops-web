/**
 * GET /api/cron/auto-confirm-schedules
 *
 * Vercel cron: runs HOURLY (`15 * * * *`). The spec originally called for a
 * daily cron, but hourly gives us finer-grained grace-period resolution —
 * if a user sets auto_confirm_after_hours to 4, a daily cron could make the
 * effective window anywhere from 4h to 28h depending on when the cron lands.
 * Hourly narrows the uncertainty to <= 1h and costs ~24x daily, still
 * trivial relative to other crons.
 *
 * For every phase_c-enabled company whose appointment_confirmation settings
 * are set to `confirm_mode = "automatic"`, finds tasks that have been stable
 * (unchanged updated_at) longer than the configured grace period and marks
 * them as schedule_confirmed — firing onTaskScheduleConfirmed which in turn
 * proposes a confirmation email per the company's autonomy level.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride, requireSupabase } from "@/lib/supabase/helpers";
import { ClientSchedulingCommsService } from "@/lib/api/services/client-scheduling-comms-service";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

export const maxDuration = 300;

type Result = {
  companyId: string;
  tasksChecked: number;
  tasksConfirmed: number;
  error?: string;
};

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

async function processCompany(companyId: string): Promise<Result> {
  const userId = await findDefaultUserForCompany(companyId);
  if (!userId) {
    return { companyId, tasksChecked: 0, tasksConfirmed: 0 };
  }

  const candidates =
    await ClientSchedulingCommsService.listAutoConfirmCandidates(companyId);

  if (candidates.length === 0) {
    return { companyId, tasksChecked: 0, tasksConfirmed: 0 };
  }

  const supabase = requireSupabase();
  let confirmedCount = 0;

  for (const { taskId } of candidates) {
    try {
      // Double-check the task is still unconfirmed — if another path confirmed
      // it between listing and updating, skip.
      const { data: current } = await supabase
        .from("project_tasks")
        .select("schedule_confirmed_at")
        .eq("id", taskId)
        .eq("company_id", companyId)
        .maybeSingle();

      if (current?.schedule_confirmed_at) continue;

      await supabase
        .from("project_tasks")
        .update({
          schedule_confirmed_at: new Date().toISOString(),
          schedule_confirmed_by: null, // null = auto-confirmed
        })
        .eq("id", taskId)
        .eq("company_id", companyId);

      await ClientSchedulingCommsService.onTaskScheduleConfirmed(
        companyId,
        userId,
        taskId
      );
      confirmedCount++;
    } catch (err) {
      console.error(
        `[cron/auto-confirm-schedules] task ${taskId} failed:`,
        err
      );
    }
  }

  // Audit trail: fire a non-persistent notification to the company admin so
  // owners can see cron activity in the notification rail. Only fire when
  // we actually stamped something — avoid rail noise when the cron was
  // effectively a no-op.
  if (confirmedCount > 0) {
    try {
      const { NotificationService } = await import(
        "@/lib/api/services/notification-service"
      );
      await NotificationService.create({
        userId,
        companyId,
        type: "mention",
        title: "notification.autoConfirmedTasks.title",
        body: `${confirmedCount} task${confirmedCount === 1 ? "" : "s"} auto-confirmed`,
        persistent: false,
        actionUrl: "/calendar",
        actionLabel: "notification.autoConfirmedTasks.action",
      });
    } catch (err) {
      console.error(
        "[cron/auto-confirm-schedules] audit notification failed:",
        err
      );
    }
  }

  return {
    companyId,
    tasksChecked: candidates.length,
    tasksConfirmed: confirmedCount,
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
    const results: Result[] = [];

    for (let i = 0; i < phaseCCompanyIds.length; i += CHUNK_SIZE) {
      const chunk = phaseCCompanyIds.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map((companyId) => processCompany(companyId))
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const r = chunkResults[j];
        if (r.status === "fulfilled") {
          if (r.value.tasksChecked > 0 || r.value.tasksConfirmed > 0) {
            results.push(r.value);
          }
        } else {
          results.push({
            companyId: chunk[j],
            tasksChecked: 0,
            tasksConfirmed: 0,
            error: r.reason?.message ?? "Unknown error",
          });
        }
      }
    }

    const totalConfirmed = results.reduce((s, r) => s + r.tasksConfirmed, 0);
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      companiesProcessed: phaseCCompanyIds.length,
      totalConfirmed,
      errors: errors.length,
      details: results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/auto-confirm-schedules]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
