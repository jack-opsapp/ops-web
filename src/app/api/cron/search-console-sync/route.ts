import { NextRequest, NextResponse } from "next/server";
import { runSearchConsoleSync } from "@/lib/admin/search-console-sync";
import {
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
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
      workloadKey: "search-console-sync",
      leaseSeconds: 120,
      work: (lease) => runSearchConsoleSync({ signal: lease.signal }),
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
