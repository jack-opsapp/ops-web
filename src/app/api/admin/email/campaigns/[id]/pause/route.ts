import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { pauseCampaign } from "@/lib/email/campaigns";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

const Body = z.object({ reason: z.string().min(1).max(200) });

export const POST = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  const user = await requireAdmin(req);
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const tag = user.email ? ` [by ${user.email}]` : "";
  const c = await pauseCampaign(id, `${parsed.data.reason}${tag}`);
  return NextResponse.json({ campaign: c });
});
