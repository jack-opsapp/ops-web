/**
 * GET /api/admin/email/campaigns/[id]/engagement
 *   Returns aggregated engagement stats + funnel stages for a campaign.
 *   60s Cache-Control — analytics doesn't need real-time accuracy.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import {
  getCampaignEngagementStats,
  getCampaignFunnelStages,
} from "@/lib/admin/email-campaign-queries";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { ok: false, error: "invalid campaign id" },
      { status: 400 }
    );
  }
  const [stats, funnel] = await Promise.all([
    getCampaignEngagementStats(id),
    getCampaignFunnelStages(id),
  ]);
  if (!stats) {
    return NextResponse.json(
      { ok: false, error: "campaign not found" },
      { status: 404 }
    );
  }
  return NextResponse.json(
    { ok: true, stats, funnel },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
});
