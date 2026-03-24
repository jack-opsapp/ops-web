import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/api-auth";
import { syncDateRange } from "@/lib/admin/ads-history-sync";
import { getSyncStatus, updateSyncStatus } from "@/lib/admin/ads-history-queries";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if already running
  const current = await getSyncStatus("backfill");
  if (current?.status === "running") {
    return NextResponse.json({ error: "Backfill already in progress" }, { status: 409 });
  }

  // Default: 2 years ago → yesterday
  const body = await req.json().catch(() => ({}));
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const startDate = body.startDate ? new Date(body.startDate) : twoYearsAgo;
  const endDate = body.endDate ? new Date(body.endDate) : yesterday;

  try {
    await updateSyncStatus("backfill", {
      status: "running",
      error: null,
      backfill_progress: {
        currentDate: startDate.toISOString().split("T")[0],
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        totalDays: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
        completedDays: 0,
      },
    });

    const result = await syncDateRange(startDate, endDate, {
      trackProgress: true,
      rateLimitMs: 150,
    });

    await updateSyncStatus("backfill", {
      status: "complete",
      last_synced_date: endDate.toISOString().split("T")[0],
      error: null,
    });

    return NextResponse.json({ status: "complete", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncStatus("backfill", { status: "failed", error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
