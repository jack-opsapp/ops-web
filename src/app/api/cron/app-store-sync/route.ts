import { NextRequest, NextResponse } from "next/server";
import { isAppStoreConfigured } from "@/lib/analytics/app-store-client";
import { bootstrapIfNeeded, syncOnce } from "@/lib/admin/app-store-sync";
import { updateAscSyncStatus } from "@/lib/admin/app-store-queries";

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

  try {
    await updateAscSyncStatus("app-store-sync", { status: "running", error: null });
    await bootstrapIfNeeded();
    const result = await syncOnce();
    await updateAscSyncStatus("app-store-sync", {
      status: "complete",
      last_synced_date: result.lastDate,
      error: null,
    });
    return NextResponse.json({ status: "synced", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateAscSyncStatus("app-store-sync", { status: "failed", error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
