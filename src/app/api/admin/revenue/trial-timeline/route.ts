import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getTrialExpirationTimeline } from "@/lib/admin/admin-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get("days") ?? "30", 10);

  const data = await getTrialExpirationTimeline(days);
  return NextResponse.json({ data });
});
