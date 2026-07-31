/**
 * GET /api/cron/schedule-optimization
 * Vercel cron: runs daily at 5am UTC (before crews start their day).
 * Analyzes schedules for today and tomorrow, proposing optimizations
 * for phase_c companies.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ScheduleOptimizationService } from "@/lib/api/services/schedule-optimization-service";
import { runBoundedPhaseCCompanyFanout } from "@/lib/api/services/cron-company-fanout-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getCompanyManagerUserIds } from "@/lib/api/services/company-managers";

export const maxDuration = 300;

const WORKLOAD_KEY = "schedule-optimization";
const COMPANY_LIMIT = 3;

type OptResult = {
  companyId: string;
  today: { proposed: number; conflicts: number; unassigned: number } | null;
  tomorrow: { proposed: number; conflicts: number; unassigned: number } | null;
  error?: string;
};

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
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: (lease) =>
        runBoundedPhaseCCompanyFanout<OptResult>({
          supabase,
          workloadKey: WORKLOAD_KEY,
          lease,
          companyLimit: COMPANY_LIMIT,
          processCompany: async (companyId) => {
            const adminUserId = (
              await getCompanyManagerUserIds(supabase, companyId)
            )[0];
            if (!adminUserId) {
              console.warn(
                `[cron/schedule-optimization] company ${companyId}: no admin user found`
              );
              return {
                companyId,
                today: null,
                tomorrow: null,
                error: "No admin user found",
              };
            }

            const todayResult =
              await ScheduleOptimizationService.suggestScheduleOptimizations(
                companyId,
                adminUserId,
                today
              );
            const tomorrowResult =
              await ScheduleOptimizationService.suggestScheduleOptimizations(
                companyId,
                adminUserId,
                tomorrow
              );

            console.log(
              `[cron/schedule-optimization] ${companyId}: ` +
                `today=${todayResult.proposed} (conflicts=${todayResult.conflicts}, unassigned=${todayResult.unassigned}) ` +
                `tomorrow=${tomorrowResult.proposed} (conflicts=${tomorrowResult.conflicts}, unassigned=${tomorrowResult.unassigned})`
            );

            return {
              companyId,
              today: todayResult,
              tomorrow: tomorrowResult,
            };
          },
          onCompanyError: (companyId, error) => {
            const message =
              error instanceof Error ? error.message : "Unknown error";
            console.warn(
              `[cron/schedule-optimization] ${companyId} failed:`,
              message
            );
            return {
              companyId,
              today: null,
              tomorrow: null,
              error: message,
            };
          },
        }),
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

    const results = controlled.value.results;
    const totalProposed = results.reduce(
      (sum, r) =>
        sum + (r.today?.proposed ?? 0) + (r.tomorrow?.proposed ?? 0),
      0
    );
    const totalConflicts = results.reduce(
      (sum, r) =>
        sum + (r.today?.conflicts ?? 0) + (r.tomorrow?.conflicts ?? 0),
      0
    );
    const totalUnassigned = results.reduce(
      (sum, r) =>
        sum + (r.today?.unassigned ?? 0) + (r.tomorrow?.unassigned ?? 0),
      0
    );
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      companiesProcessed: controlled.value.companyIds.length,
      optimizationsProposed: totalProposed,
      conflictsFound: totalConflicts,
      unassignedFound: totalUnassigned,
      errors: errors.length,
      details: results.filter(
        (r) =>
          (r.today?.proposed ?? 0) > 0 ||
          (r.tomorrow?.proposed ?? 0) > 0 ||
          r.error
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/schedule-optimization]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
