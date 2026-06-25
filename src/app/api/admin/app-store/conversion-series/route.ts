import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { parseRange } from "@/lib/admin/app-store-range";
import { getAscConversionSeries } from "@/lib/admin/app-store-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const { from, to, granularity } = parseRange(req);
  const data = await getAscConversionSeries(from, to, granularity);
  return NextResponse.json({ data });
});
