import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getFeatureAdoption } from "@/lib/admin/admin-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const data = await getFeatureAdoption();
  return NextResponse.json({ data });
});
