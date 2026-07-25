import { NextRequest, NextResponse } from "next/server";
import { isAppStoreConfigured } from "@/lib/analytics/app-store-client";
import { bootstrapIfNeeded, syncOnce } from "@/lib/admin/app-store-sync";
import { updateAscSyncStatus } from "@/lib/admin/app-store-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAppStoreConfigured()) {
    return NextResponse.json({ skipped: true, reason: "App Store Connect not configured" });
  }

  const supabase = getAdminSupabase();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "app-store-sync",
      leaseSeconds: 90,
      work: async (lease) => {
        try {
          await updateAscSyncStatus(
            "app-store-sync",
            { status: "running", error: null },
            supabase
          );
          await bootstrapIfNeeded(supabase);
          const result = await syncOnce(supabase, lease);
          await updateAscSyncStatus(
            "app-store-sync",
            {
              status: "complete",
              last_synced_date: result.lastDate,
              error: null,
            },
            supabase
          );
          return result;
        } catch (error) {
          if (isDatabasePressureError(error)) throw error;

          const message =
            error instanceof Error ? error.message : String(error);
          await updateAscSyncStatus(
            "app-store-sync",
            { status: "failed", error: message },
            supabase
          );
          throw error;
        }
      },
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
      status: "synced",
      ...controlled.value,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
