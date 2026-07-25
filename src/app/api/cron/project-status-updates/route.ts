/**
 * POST /api/cron/project-status-updates
 * Vercel cron: runs weekly (Monday 9am UTC).
 * Generates status update email drafts for active projects.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ProjectLifecycleService } from "@/lib/api/services/project-lifecycle-service";
import { runBoundedPhaseCCompanyFanout } from "@/lib/api/services/cron-company-fanout-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";

export const maxDuration = 300;

const WORKLOAD_KEY = "project-status-updates";
const COMPANY_LIMIT = 3;

type StatusResult = {
  companyId: string;
  proposed: number;
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
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: (lease) =>
        runBoundedPhaseCCompanyFanout<StatusResult>({
          supabase,
          workloadKey: WORKLOAD_KEY,
          lease,
          companyLimit: COMPANY_LIMIT,
          processCompany: async (companyId) => ({
            companyId,
            proposed:
              await ProjectLifecycleService.scheduleStatusUpdates(companyId),
          }),
          onCompanyError: (companyId, error) => {
            const message =
              error instanceof Error ? error.message : "Unknown error";
            console.error(
              `[project-status-updates] Error for company ${companyId}:`,
              message
            );
            return { companyId, proposed: 0, error: message };
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

    const results = controlled.value.results.filter(
      (result) => result.proposed > 0 || result.error
    );

    console.log(
      `[project-status-updates] Proposed ${results.reduce((s, r) => s + r.proposed, 0)} status updates across ${results.length} companies`
    );

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[project-status-updates] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
