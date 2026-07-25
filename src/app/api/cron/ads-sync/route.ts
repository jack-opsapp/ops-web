import { NextRequest, NextResponse } from "next/server";
import { syncDay } from "@/lib/admin/ads-history-sync";
import { updateSyncStatus } from "@/lib/admin/ads-history-queries";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

          return { date: dateStr };
        } catch (error) {
          if (error instanceof CronDatabaseOperationError) {
            throw error;
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
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    return NextResponse.json({
      status: "synced",
      ran: true,
      date: controlled.value.date,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
