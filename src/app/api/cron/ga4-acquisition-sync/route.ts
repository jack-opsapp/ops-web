import { NextRequest, NextResponse } from "next/server";
import { runGA4AcquisitionSync } from "@/lib/admin/ga4-acquisition-sync";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const maxDuration = 300;

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
      workloadKey: "ga4-acquisition-sync",
      leaseSeconds: 120,
      work: (lease) => runGA4AcquisitionSync({ signal: lease.signal }),
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
    return NextResponse.json({ ok: true, ran: true, ...controlled.value });
  } catch (error) {
    // The runner throws an AggregateError carrying one cause per property, so
    // expanding it restores the exact per-property message (e.g. the
    // "7 PERMISSION_DENIED" line) to both the log and the response body
    // (bugs 6d61591c + f3c0f556).
    console.error("[cron/ga4-acquisition-sync]", error);
    const failures =
      error instanceof AggregateError
        ? error.errors.map((cause) =>
            cause instanceof Error ? cause.message : String(cause)
          )
        : undefined;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        ...(failures ? { failures } : {}),
      },
      { status: 500 }
    );
  }
}
