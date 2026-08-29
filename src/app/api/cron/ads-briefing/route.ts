import { NextRequest, NextResponse } from "next/server";
import { generateBriefing } from "@/lib/admin/briefing-agent";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  classifyGoogleAdsAccessFailure,
  reportAdsProviderHealth,
} from "@/lib/admin/ads-provider-health";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getAdminSupabase();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase: sb,
      workloadKey: "ads-briefing",
      leaseSeconds: 360,
      work: () => generateBriefing("cron"),
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          status: alreadyRunning ? "already_running" : "unavailable",
          ran: false,
          reason: controlled.reason,
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    await reportAdsProviderHealth(sb, { blocked: false });

    return NextResponse.json({
      id: controlled.value,
      status: "started",
      ran: true,
    });
  } catch (err) {
    // generateBriefing already persisted the failed briefing row with the full
    // provider message and rethrew, so the truthful record exists either way.
    // A blocked account/token is a standing operator condition, not a defect.
    const accessReason = classifyGoogleAdsAccessFailure(err);
    if (accessReason) {
      await reportAdsProviderHealth(sb, {
        blocked: true,
        reason: accessReason,
      });
      return NextResponse.json(
        { status: "degraded", ran: true, reason: accessReason },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
