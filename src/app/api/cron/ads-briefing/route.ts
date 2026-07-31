import { NextRequest, NextResponse } from "next/server";
import { generateBriefing } from "@/lib/admin/briefing-agent";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase: getAdminSupabase(),
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

    return NextResponse.json({
      id: controlled.value,
      status: "started",
      ran: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
