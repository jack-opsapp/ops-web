/**
 * GET /api/admin/email/templates/[type]/versions/compare?a=1.0.0&b=1.1.0&since=ISO
 *   Returns side-by-side metrics for two template versions of the same email_type.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getTemplateVersionCompare } from "@/lib/admin/email-campaign-queries";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ type: string }> };

export const GET = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  await requireAdmin(req);
  const { type } = await ctx.params;
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const b = url.searchParams.get("b");
  const since = url.searchParams.get("since") ?? undefined;
  if (!a || !b) {
    return NextResponse.json(
      { ok: false, error: "a and b query params required" },
      { status: 400 }
    );
  }
  const result = await getTemplateVersionCompare(type, a, b, since);
  return NextResponse.json(
    { ok: true, result },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
});
