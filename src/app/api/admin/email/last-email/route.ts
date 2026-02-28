import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getLastEmailByType } from "@/lib/admin/email-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const type = req.nextUrl.searchParams.get("type");
  if (!type) {
    return NextResponse.json({ error: "Missing ?type= parameter" }, { status: 400 });
  }

  const entry = await getLastEmailByType(type);
  return NextResponse.json({ entry });
});
