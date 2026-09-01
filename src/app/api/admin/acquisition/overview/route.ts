import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { buildGrowthOverviewCsv } from "@/lib/admin/growth-analytics-export";
import {
  getCachedGrowthOverview,
  parseGrowthFilters,
} from "@/lib/admin/growth-analytics-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  let filters;
  try {
    filters = parseGrowthFilters(new URL(req.url).searchParams);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid growth filters" },
      { status: 400 }
    );
  }

  const data = await getCachedGrowthOverview(filters);
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const filename = `ops-growth-${filters.startDate}-${filters.endDate}.csv`;
    return new NextResponse(buildGrowthOverviewCsv(data), {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }
  return NextResponse.json(data);
});
