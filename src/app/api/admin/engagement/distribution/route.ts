import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getEngagementDistribution } from "@/lib/admin/admin-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const data = await getEngagementDistribution();
  return NextResponse.json({ data });
});
