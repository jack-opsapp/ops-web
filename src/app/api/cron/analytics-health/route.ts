import { NextRequest, NextResponse } from "next/server";
import { runAnalyticsHealth } from "@/lib/admin/analytics-health-runner";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getAdminSupabase();
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "analytics-health",
      leaseSeconds: 90,
      work: () => runAnalyticsHealth({ client: supabase }),
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
      ok: controlled.value.evaluation.overall !== "failed",
      ran: true,
      state: controlled.value.evaluation.overall,
      checkedAt: controlled.value.evaluation.checkedAt,
      failedChecks: controlled.value.evaluation.failedChecks,
      sources: controlled.value.evaluation.sources.map((source) => ({
        source: source.source,
        state: source.state,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
