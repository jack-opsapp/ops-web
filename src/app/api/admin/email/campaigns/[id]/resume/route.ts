import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { resumeCampaign } from "@/lib/email/campaigns";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const c = await resumeCampaign(id);
  return NextResponse.json({ campaign: c });
});
