import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { parseRange } from "@/lib/admin/app-store-range";
import { getAscSourceBreakdown } from "@/lib/admin/app-store-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const { from, to } = parseRange(req);
  const data = await getAscSourceBreakdown(from, to);
  return NextResponse.json({ data });
});
