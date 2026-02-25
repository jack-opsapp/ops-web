import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getMRRGrowth } from "@/lib/admin/admin-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const { searchParams } = new URL(req.url);
  const months = parseInt(searchParams.get("months") ?? "12", 10);

  const data = await getMRRGrowth(months);
  return NextResponse.json({ data });
});
