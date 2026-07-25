/**
 * GET /api/cron/memory-decay
 * Bounded daily memory maintenance guarded by a durable workload lease.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runMemoryDecayMaintenance } from "@/lib/api/services/memory-decay-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";

export const maxDuration = 300;

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
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const supabase = getServiceRoleClient();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "memory-decay",
      leaseSeconds: 360,
      work: (lease) => runMemoryDecayMaintenance(supabase, lease),
    });

    if (controlled.status === "skipped") {
      if (controlled.reason === "lease_held") {
        return NextResponse.json({
          ok: true,
          ran: false,
          reason: "already_running",
        });
      }
      return NextResponse.json(
        { ok: false, ran: false, reason: controlled.reason },
        { status: 503 }
      );
    }

    return NextResponse.json({
      ok: controlled.value.errors.length === 0,
      ...controlled.value,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[memory-decay] Fatal error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
