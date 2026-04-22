/**
 * OPS Admin — PMF Prospects (list + create)
 *
 * GET  /api/admin/pmf/prospects[?deal_type=tier_a|base_saas]
 *   → list prospects with their deals embedded; orders by first_contact_at desc
 *
 * POST /api/admin/pmf/prospects
 *   → create a prospect AND auto-create an initial pmf_deals row at
 *     stage="contacted". Body validated by ProspectCreateSchema.
 *
 * All writes invalidate the "pmf-state" cache tag so the cached
 * dashboard query (lib/admin/pmf-queries.ts) picks up changes on the
 * next request.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { ProspectCreateSchema } from "@/lib/pmf/schemas";

async function handleGET(req: NextRequest) {
  await requireAdmin(req);

  const url = new URL(req.url);
  const dealType = url.searchParams.get("deal_type");

  const sb = getAdminSupabase();
  let q = sb
    .from("pmf_prospects")
    .select(
      "*, pmf_deals!inner(id, stage, stage_entered_at, deal_type)"
    )
    .order("first_contact_at", { ascending: false });

  if (dealType) {
    q = q.eq("deal_type", dealType);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

async function handlePOST(req: NextRequest) {
  await requireAdmin(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ProspectCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const sb = getAdminSupabase();
  const { data: prospect, error } = await sb
    .from("pmf_prospects")
    .insert(parsed.data)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const prospectRow = prospect as { id: string; deal_type: string };

  // Auto-create the initial deal at stage=contacted. The DB trigger
  // pmf_log_deal_stage_change fires only on UPDATE so the first row
  // does not log an event — that's fine; the initial state is
  // implicit from the deal's created_at.
  const { error: dealErr } = await sb.from("pmf_deals").insert({
    prospect_id: prospectRow.id,
    stage: "contacted",
    deal_type: prospectRow.deal_type,
  });

  if (dealErr) {
    // Compensating delete: the prospect was inserted but its required
    // companion deal failed. The list GET uses pmf_deals!inner so the
    // orphan would be invisible — silent corruption. Roll back the
    // prospect to keep the two-row write atomic from the caller's
    // perspective.
    console.error(
      "[pmf-prospects] deal insert failed for prospect",
      prospectRow.id,
      "— compensating delete:",
      dealErr.message
    );
    const { error: delErr } = await sb
      .from("pmf_prospects")
      .delete()
      .eq("id", prospectRow.id);
    if (delErr) {
      console.error(
        "[pmf-prospects] CRITICAL: compensating delete also failed for prospect",
        prospectRow.id,
        "— orphan exists:",
        delErr.message
      );
    }
    return NextResponse.json(
      { error: "deal insert failed; prospect rolled back" },
      { status: 500 }
    );
  }

  revalidateTag("pmf-state");
  return NextResponse.json({ data: prospect });
}

export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
