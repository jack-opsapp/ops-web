/**
 * POST /api/cron/expire-actions
 * Vercel cron: runs daily. Expires stale pending agent actions past their expires_at.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const maxDuration = 60;

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

  console.log("[expire-actions] Starting expiry cycle");

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "expire-agent-actions",
      leaseSeconds: 120,
      work: async () => {
        const { data, error } = (await supabase.rpc(
          "expire_agent_actions_batch_as_system" as never,
          {
            p_batch_size: 500,
            p_now: new Date().toISOString(),
          } as never
        )) as unknown as { data: unknown; error: unknown };

        if (error) {
          throw new CronDatabaseOperationError(
            "agent action expiry batch failed",
            { cause: error }
          );
        }
        if (
          typeof data !== "number" ||
          !Number.isSafeInteger(data) ||
          data < 0 ||
          data > 500
        ) {
          throw new CronDatabaseOperationError(
            "agent action expiry returned an invalid count",
            { cause: new Error("invalid expiry batch result") }
          );
        }
        return { expired: data };
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

    const { expired } = controlled.value;
    console.log(`[expire-actions] Expired ${expired} stale actions`);

    return NextResponse.json({ ok: true, ran: true, expired });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[expire-actions] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
