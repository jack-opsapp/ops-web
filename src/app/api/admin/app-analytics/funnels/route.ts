import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getFunnelData } from "@/lib/admin/app-analytics-queries";
import type { AppAnalyticsPlatform } from "@/lib/admin/types";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = searchParams.get("to") ?? new Date().toISOString();
  const platform = (searchParams.get("platform") ?? "all") as AppAnalyticsPlatform;
  const stepsParam = searchParams.get("steps") ?? "sign_up,complete_onboarding,project_created,task_created";
  const steps = stepsParam.split(",").map((s) => s.trim()).filter(Boolean);

  const data = await getFunnelData(from, to, platform, steps);
  return NextResponse.json({ data });
});
