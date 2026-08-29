import { NextRequest, NextResponse } from "next/server";
import { syncDay } from "@/lib/admin/ads-history-sync";
import { getSyncStatus, updateSyncStatus } from "@/lib/admin/ads-history-queries";
import { dispatchBackfillChunk } from "@/lib/admin/ads-backfill-dispatch";
import {
  classifyGoogleAdsAccessFailure,
  reportAdsProviderHealth,
} from "@/lib/admin/ads-provider-health";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const maxDuration = 60;

/** A `running` backfill whose heartbeat is older than this is stalled. */
const BACKFILL_STALE_MS = 10 * 60 * 1000;

/**
 * Watchdog: revive a stalled backfill chain. The chunk worker heartbeats
 * after every chunk, so a `running` row with an old `updated_at` means the
 * chain died between invocations. Re-dispatching resumes from the stored
 * currentDate (chunk upserts are idempotent). Never throws — the daily sync
 * must run regardless.
 */
async function reviveStalledBackfill(request: NextRequest): Promise<boolean> {
  try {
    const status = await getSyncStatus("backfill");
    if (!status || status.status !== "running" || !status.backfill_progress) {
      return false;
    }
    const heartbeatAge = Date.now() - new Date(status.updated_at).getTime();
    if (heartbeatAge < BACKFILL_STALE_MS) return false;

    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return false;

    console.warn(
      `[ads-sync] backfill heartbeat is ${Math.round(heartbeatAge / 1000)}s old — re-dispatching chunk worker`
    );
    const chunkUrl = new URL(
      "/api/admin/google-ads/backfill/chunk",
      request.url
    ).toString();
    const result = await dispatchBackfillChunk(chunkUrl, cronSecret);
    return result.ok;
  } catch (err) {
    console.error("[ads-sync] backfill watchdog failed:", err);
    return false;
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const revivedBackfill = await reviveStalledBackfill(request);

  try {
    const supabase = getAdminSupabase();
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "ads-history-sync",
      leaseSeconds: 120,
      work: async () => {
        try {
          await updateSyncStatus("daily-sync", { status: "running" });

          // Sync yesterday (Google Ads finalizes data ~24h after).
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          await syncDay(yesterday);

          const dateStr = yesterday.toISOString().split("T")[0];
          await updateSyncStatus("daily-sync", {
            status: "complete",
            last_synced_date: dateStr,
            error: null,
          });

          await reportAdsProviderHealth(supabase, { blocked: false });
          return { date: dateStr, degraded: null as string | null };
        } catch (error) {
          if (error instanceof CronDatabaseOperationError) {
            throw error;
          }
          // A blocked account/token is a standing operator condition, not a
          // defect: record it truthfully and degrade instead of 500ing on
          // every scheduled run (bug 964cf782).
          const accessReason = classifyGoogleAdsAccessFailure(error);
          if (accessReason) {
            await updateSyncStatus("daily-sync", {
              status: "failed",
              error: accessReason,
            });
            await reportAdsProviderHealth(supabase, {
              blocked: true,
              reason: accessReason,
            });
            return { date: null, degraded: accessReason };
          }
          const message =
            error instanceof Error ? error.message : String(error);
          await updateSyncStatus("daily-sync", {
            status: "failed",
            error: message,
          });
          throw error;
        }
      },
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          status: alreadyRunning ? "already_running" : "unavailable",
          ran: false,
          reason: controlled.reason,
          revivedBackfill,
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    if (controlled.value.degraded) {
      return NextResponse.json(
        {
          status: "degraded",
          ran: true,
          reason: controlled.value.degraded,
          revivedBackfill,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      status: "synced",
      ran: true,
      date: controlled.value.date,
      revivedBackfill,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
