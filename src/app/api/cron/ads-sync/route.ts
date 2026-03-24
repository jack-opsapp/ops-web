import { NextRequest, NextResponse } from "next/server";
import { syncDay } from "@/lib/admin/ads-history-sync";
import { updateSyncStatus } from "@/lib/admin/ads-history-queries";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await updateSyncStatus("daily-sync", { status: "running" });

    // Sync yesterday (Google Ads finalizes data ~24h after)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await syncDay(yesterday);

    const dateStr = yesterday.toISOString().split("T")[0];
    await updateSyncStatus("daily-sync", {
      status: "complete",
      last_synced_date: dateStr,
      error: null,
    });

    return NextResponse.json({ status: "synced", date: dateStr });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncStatus("daily-sync", { status: "failed", error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
