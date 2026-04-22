/**
 * OPS Admin — PMF Deal stage fast path
 *
 * PATCH /api/admin/pmf/deals/[id]/stage
 *   → body { stage: <DealStageSchema> }, updates ONLY the stage
 *     column. The DB trigger pmf_log_deal_stage_change auto-logs the
 *     stage_change event into pmf_deal_events and updates
 *     stage_entered_at — do not duplicate that work here.
 *
 * Same dynamic-route try/catch wrapper as the sibling routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { DealStageSchema } from "@/lib/pmf/schemas";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    let body: { stage?: unknown };
    try {
      body = (await req.json()) as { stage?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = DealStageSchema.safeParse(body?.stage);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid stage", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const sb = getAdminSupabase();
    const { data, error } = await sb
      .from("pmf_deals")
      .update({ stage: parsed.data })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    revalidateTag("pmf-state");
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error("[pmf-deals-stage]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
