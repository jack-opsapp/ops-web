import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { scheduleCampaign } from "@/lib/email/campaigns";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

const Body = z.object({ scheduledFor: z.string().datetime() });

export const POST = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const when = new Date(parsed.data.scheduledFor);
  // Allow up to 60s clock skew so an admin scheduling for "now" doesn't get
  // rejected by a stale browser clock.
  if (when.getTime() < Date.now() - 60_000) {
    return NextResponse.json(
      { error: "scheduled_for must be in the future" },
      { status: 400 }
    );
  }
  const c = await scheduleCampaign(id, when);
  return NextResponse.json({ campaign: c });
});
