/**
 * OPS Admin — PMF Prospect (detail / update / delete)
 *
 * GET    /api/admin/pmf/prospects/[id]
 *   → returns the prospect with deals + each deal's events nested.
 *     404 when not found.
 *
 * PATCH  /api/admin/pmf/prospects/[id]
 *   → partial update; body validated by ProspectUpdateSchema.
 *
 * DELETE /api/admin/pmf/prospects/[id]
 *   → cascade-deletes deals + events via FK on delete cascade.
 *
 * Uses the manual try/catch wrapper instead of withAdmin because the
 * Next.js dynamic-route handler signature ({ params }) doesn't match
 * the (req) → Promise<NextResponse> shape that withAdmin enforces.
 * Behaviour is identical: requireAdmin throws a NextResponse on
 * 401/403 and we re-return it from catch.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { ProspectUpdateSchema } from "@/lib/pmf/schemas";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const sb = getAdminSupabase();
    const { data, error } = await sb
      .from("pmf_prospects")
      .select("*, pmf_deals(*, pmf_deal_events(*))")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error("[pmf-prospects-id]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

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

    const parsed = ProspectUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const sb = getAdminSupabase();
    const { data, error } = await sb
      .from("pmf_prospects")
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
    console.error("[pmf-prospects-id]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);

    // Confirmation guard — DELETE cascades through pmf_deals →
    // pmf_deal_events via FK on delete cascade. A typo'd UUID could
    // wipe months of pipeline history. Until a UI confirmation modal
    // exists, require an explicit ?confirm=1 query param to proceed.
    const url = new URL(req.url);
    if (url.searchParams.get("confirm") !== "1") {
      return NextResponse.json(
        { error: "missing ?confirm=1 — DELETE cascades to deals + events" },
        { status: 400 }
      );
    }

    const { id } = await params;

    const sb = getAdminSupabase();
    const { error } = await sb
      .from("pmf_prospects")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    revalidateTag("pmf-state");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error("[pmf-prospects-id]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
