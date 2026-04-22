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

  // Auto-create the initial deal at stage=contacted. The DB trigger
  // pmf_log_deal_stage_change fires only on UPDATE so the first row
  // does not log an event — that's fine; the initial state is
  // implicit from the deal's created_at.
  const { error: dealErr } = await sb.from("pmf_deals").insert({
    prospect_id: (prospect as { id: string }).id,
    stage: "contacted",
    deal_type: (prospect as { deal_type: string }).deal_type,
  });

  if (dealErr) {
    return NextResponse.json({ error: dealErr.message }, { status: 500 });
  }

  revalidateTag("pmf-state");
  return NextResponse.json({ prospect });
}

export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
