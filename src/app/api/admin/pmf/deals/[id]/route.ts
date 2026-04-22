/**
 * OPS Admin — PMF Deal update
 *
 * PATCH /api/admin/pmf/deals/[id]
 *   → partial update of any pmf_deals column (stage, sow/deposit/
 *     delivered/closed fields, etc.). Body validated by DealUpdateSchema.
 *
 *   When `stage` changes the DB trigger pmf_log_deal_stage_change
 *   automatically inserts a `pmf_deal_events` row of type 'stage_change'
 *   and updates `stage_entered_at`. We do NOT touch either field
 *   from this handler.
 *
 * Uses the manual try/catch wrapper instead of withAdmin — see the
 * sibling /prospects/[id]/route.ts header for rationale.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { DealUpdateSchema } from "@/lib/pmf/schemas";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = DealUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const sb = getAdminSupabase();
    const { data, error } = await sb
      .from("pmf_deals")
      .update(parsed.data)
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
    console.error("[pmf-deals-id]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
