/**
 * GET /api/admin/email/campaigns/[id]
 *
 * Returns a campaign + paginated slice of its email_jobs.
 * Used by the campaign detail modal at 5s polling cadence while
 * the campaign is in_flight or scheduled.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { getCampaignStats } from "@/lib/email/campaigns";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  await requireAdmin(req);
  const { id } = await ctx.params;

  const c = await getCampaignStats(id);
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const jobLimit = Math.min(
    Math.max(Number(sp.get("jobLimit") ?? 50), 1),
    200
  );
  const jobOffset = Math.max(Number(sp.get("jobOffset") ?? 0), 0);

  const db = getServiceRoleClient();
  const { data: jobs, count } = await db
    .from("email_jobs")
    .select(
      "id, recipient_email, status, sent_at, last_error, retry_count, sg_message_id",
      { count: "exact" }
    )
    .eq("campaign_id", id)
    .order("created_at", { ascending: false })
    .range(jobOffset, jobOffset + jobLimit - 1);

  return NextResponse.json({
    campaign: c,
    jobs: jobs ?? [],
    jobsTotal: count ?? 0,
  });
});
