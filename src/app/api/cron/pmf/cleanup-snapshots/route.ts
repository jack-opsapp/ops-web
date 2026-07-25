/**
 * GET /api/cron/pmf/cleanup-snapshots
 *
 * Vercel cron: `4 11 * * *` — isolated daily maintenance window.
 *
 * Deletes `pmf_threshold_snapshots` rows older than 30 days. The snapshot
 * table is append-only (one row every 15 minutes from the threshold-check
 * cron) — without pruning it would grow at ~2,880 rows/month indefinitely.
 * Thirty days is plenty of history for diff-and-forensics use cases.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_DAYS = 30;

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

  try {
    const sb = getAdminSupabase();
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 86_400_000
    ).toISOString();

    const controlled = await runWithCronWorkloadControl({
      supabase: sb,
      workloadKey: "pmf-cleanup-snapshots",
      leaseSeconds: 120,
      work: async () => {
        const { data, error } = (await sb.rpc(
          "cleanup_pmf_threshold_snapshots_batch_as_system" as never,
          {
            p_cutoff: cutoff,
            p_batch_size: 250,
          } as never
        )) as unknown as { data: unknown; error: unknown };

        if (error) {
          throw new CronDatabaseOperationError(
            "PMF snapshot cleanup batch failed",
            { cause: error }
          );
        }
        if (
          typeof data !== "number" ||
          !Number.isSafeInteger(data) ||
          data < 0 ||
          data > 250
        ) {
          throw new CronDatabaseOperationError(
            "PMF snapshot cleanup returned an invalid count",
            { cause: new Error("invalid snapshot cleanup result") }
          );
        }
        return { pruned: data };
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

    return NextResponse.json({
      ok: true,
      ran: true,
      pruned: controlled.value.pruned,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "snapshot cleanup failed";
    console.error("[pmf-cleanup-snapshots] failed:", message, err);
    return NextResponse.json(
      { error: "snapshot cleanup failed" },
      { status: 500 }
    );
  }
}
