import { NextRequest, NextResponse } from "next/server";
import { runAnalyticsHealth } from "@/lib/admin/analytics-health-runner";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { drainTryopsHealthNotifications } from "@/lib/pmf/tryops-health-delivery";

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
      work: async () => {
        // Drain first so a GA/source outage cannot strand its own health alerts.
        // The bounded consumer reports failures without aborting other checks.
        const tryopsHealth = await drainTryopsHealthNotifications({ client: supabase });
        return { ...await runAnalyticsHealth({ client: supabase }), tryopsHealth };
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

    const deliveryFailed = controlled.value.tryopsHealth.status === "unavailable" ||
      controlled.value.tryopsHealth.failed > 0;
    return NextResponse.json({
      ok: controlled.value.evaluation.overall !== "failed" && !deliveryFailed,
      ran: true,
      state: controlled.value.evaluation.overall,
      aggregateState: controlled.value.evaluation.overall === "failed" ? "failed"
        : deliveryFailed ? "degraded" : controlled.value.evaluation.overall,
      checkedAt: controlled.value.evaluation.checkedAt,
      failedChecks: controlled.value.evaluation.failedChecks,
      tryopsHealth: controlled.value.tryopsHealth,
      sources: controlled.value.evaluation.sources.map((source) => ({
        source: source.source,
        state: source.state,
      })),
    }, { status: deliveryFailed ? 503 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
