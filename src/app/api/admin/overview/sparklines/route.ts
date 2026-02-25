import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import {
  getCompanySparkline,
  getTasksCreatedSparkline,
  getActiveUsersTimeline,
} from "@/lib/admin/admin-queries";
import { listAllAuthUsers } from "@/lib/firebase/admin-sdk";
import { PLAN_PRICES } from "@/lib/admin/types";
import type { Granularity } from "@/lib/admin/types";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? new Date(Date.now() - 12 * 7 * 86_400_000).toISOString();
  const to = searchParams.get("to") ?? new Date().toISOString();
  const granularity = (searchParams.get("granularity") ?? "weekly") as Granularity;

  // Compute weeks from date range for legacy sparkline functions
  const diffMs = new Date(to).getTime() - new Date(from).getTime();
  const weeks = Math.max(1, Math.round(diffMs / (7 * 86_400_000)));

  const [companySparkline, taskSparkline, authUsers] = await Promise.all([
    getCompanySparkline(weeks),
    getTasksCreatedSparkline(weeks),
    listAllAuthUsers(),
  ]);

  const activeUsersSparkline = getActiveUsersTimeline(authUsers, from, to, granularity);

  // Revenue sparkline approximation
  const avgPrice =
    Object.values(PLAN_PRICES).reduce((a, b) => a + b, 0) /
    Object.keys(PLAN_PRICES).length;
  const revenueSparkline = companySparkline.map((d) => ({
    label: d.label,
    value: Math.round(d.value * avgPrice),
  }));

  return NextResponse.json({
    companies: companySparkline,
    tasks: taskSparkline,
    activeUsers: activeUsersSparkline,
    revenue: revenueSparkline,
  });
});
