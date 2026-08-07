/**
 * POST /api/cron/project-health
 * Vercel cron: runs daily at 8am UTC.
 * Detects overdue tasks and closable (complete + paid) projects for all phase_c companies.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ProjectLifecycleService } from "@/lib/api/services/project-lifecycle-service";
import { runBoundedPhaseCCompanyFanout } from "@/lib/api/services/cron-company-fanout-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";

export const maxDuration = 300;

const WORKLOAD_KEY = "project-health";
const COMPANY_LIMIT = 5;

type HealthResult = {
  companyId: string;
  overdueTasks: number;
  closableProjects: number;
  error?: string;
};

function reportableHealthResults(results: HealthResult[]): HealthResult[] {
  return results.filter(
    (result) =>
      result.overdueTasks > 0 || result.closableProjects > 0 || result.error
  );
}

class ProjectHealthRunError extends Error {
  readonly results: HealthResult[];

  constructor(results: HealthResult[]) {
    const failedCount = results.filter((result) => result.error).length;
    super(
      `Project health failed for ${failedCount} of ${results.length} companies`
    );
    this.name = "ProjectHealthRunError";
    this.results = reportableHealthResults(results);
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
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: async (lease) => {
        const fanout = await runBoundedPhaseCCompanyFanout<HealthResult>({
          supabase,
          workloadKey: WORKLOAD_KEY,
          lease,
          companyLimit: COMPANY_LIMIT,
          processCompany: async (companyId) => {
            const overdueTasks =
              await ProjectLifecycleService.detectOverdueTasks(companyId);
            const closableProjects =
              await ProjectLifecycleService.detectClosableProjects(companyId);
            return { companyId, overdueTasks, closableProjects };
          },
          onCompanyError: (companyId, error) => {
            const message =
              error instanceof Error ? error.message : "Unknown error";
            console.error(
              `[project-health] Error for company ${companyId}:`,
              message
            );
            return {
              companyId,
              overdueTasks: 0,
              closableProjects: 0,
              error: message,
            };
          },
        });

        if (fanout.results.some((result) => result.error)) {
          throw new ProjectHealthRunError(fanout.results);
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

    const results = reportableHealthResults(controlled.value.results);

    console.log(
      `[project-health] Processed ${controlled.value.companyIds.length} companies; ${results.length} had findings or errors`
    );

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    if (err instanceof ProjectHealthRunError) {
      console.error("[project-health] Failed:", err.message);
      return NextResponse.json(
        { ok: false, error: err.message, results: err.results },
        { status: 500 }
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[project-health] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
