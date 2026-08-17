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
import {
  runBoundedPhaseCCompanyFanout,
  type CronCompanyFanoutRetryState,
} from "@/lib/api/services/cron-company-fanout-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getCompanyManagerUserIds } from "@/lib/api/services/company-managers";

export const maxDuration = 300;

const WORKLOAD_KEY = "schedule-optimization";
const COMPANY_LIMIT = 3;

type OptResult = {
  companyId: string;
  today: { proposed: number; conflicts: number; unassigned: number } | null;
  tomorrow: { proposed: number; conflicts: number; unassigned: number } | null;
  disposition: "success" | "not_actionable" | "retryable";
  reason?: "no_admin_user";
  error?: string;
};

function reportableOptimizationResults(results: OptResult[]): OptResult[] {
  return results.filter(
    (result) =>
      (result.today?.proposed ?? 0) > 0 ||
      (result.tomorrow?.proposed ?? 0) > 0 ||
      result.disposition === "not_actionable" ||
      result.error
  );
}

class ScheduleOptimizationRunError extends Error {
  readonly results: OptResult[];
  readonly retry: CronCompanyFanoutRetryState;

  constructor(
    results: OptResult[],
    retry: CronCompanyFanoutRetryState,
    cause?: unknown
  ) {
    const failedCount = results.filter(
      (result) => result.disposition === "retryable"
    ).length;
    super(
      `Schedule optimization failed for ${failedCount} of ${results.length} companies`,
      cause === undefined ? undefined : { cause }
    );
    this.name = "ScheduleOptimizationRunError";
    this.results = reportableOptimizationResults(results);
    this.retry = retry;
  }
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
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: async (lease) => {
        const fanout = await runBoundedPhaseCCompanyFanout<OptResult>({
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
                disposition: "not_actionable",
                reason: "no_admin_user",
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
              disposition: "success",
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
              disposition: "retryable",
              error: message,
            };
          },
          retryPolicy: {
            maxAttempts: 3,
            classifyResult: (result) =>
              result.disposition === "not_actionable"
                ? "permanent"
                : result.disposition,
          },
        });

        if (fanout.retry?.status === "scheduled") {
          throw new ScheduleOptimizationRunError(
            fanout.results,
            fanout.retry,
            fanout.failureCause
          );
        }

        return fanout;
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

    const results = controlled.value.results;
    const totalProposed = results.reduce(
      (sum, r) => sum + (r.today?.proposed ?? 0) + (r.tomorrow?.proposed ?? 0),
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
    const errors = results.filter((r) => r.disposition === "retryable");
    const nonActionable = results.filter(
      (r) => r.disposition === "not_actionable"
    ).length;

    return NextResponse.json({
      ok: controlled.value.retry?.status !== "exhausted",
      companiesProcessed: controlled.value.companyIds.length,
      optimizationsProposed: totalProposed,
      conflictsFound: totalConflicts,
      unassignedFound: totalUnassigned,
      errors: errors.length,
      nonActionable,
      retry: controlled.value.retry,
      details: reportableOptimizationResults(results),
    });
  } catch (err) {
    if (err instanceof ScheduleOptimizationRunError) {
      console.error("[cron/schedule-optimization]", err.message);
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          retry: err.retry,
          results: err.results,
        },
        { status: 500 }
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/schedule-optimization]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
