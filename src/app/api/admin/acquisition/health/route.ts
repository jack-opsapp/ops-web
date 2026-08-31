import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import {
  getCachedGrowthHealth,
  parseGrowthFilters,
} from "@/lib/admin/growth-analytics-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  try {
    const filters = parseGrowthFilters(new URL(req.url).searchParams);
    return NextResponse.json(await getCachedGrowthHealth(filters));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid growth filters" },
      { status: 400 }
    );
  }
});
