import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin/api-auth";
import { getSyncStatus } from "@/lib/admin/ads-history-queries";

export const GET = withAdmin(async (_req: NextRequest) => {
  const [dailySync, backfill] = await Promise.all([
    getSyncStatus("daily-sync"),
    getSyncStatus("backfill"),
  ]);

  return NextResponse.json({ dailySync, backfill });
});
