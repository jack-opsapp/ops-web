import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getActiveUsers } from "@/lib/admin/app-analytics-queries";
import type { AppAnalyticsPlatform } from "@/lib/admin/types";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
  const to = searchParams.get("to") ?? new Date().toISOString();
  const platform = (searchParams.get("platform") ?? "all") as AppAnalyticsPlatform;

  const data = await getActiveUsers(from, to, platform);
  return NextResponse.json({ data });
});
