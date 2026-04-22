/**
 * OPS Web — Inbox Commitment Resolve
 *
 * PATCH /api/inbox/commitments/{id}
 *   Body: { resolvedAt: string | null }
 *   - ISO-8601 string → mark resolved at that timestamp (usually `new Date().toISOString()`)
 *   - null              → clear resolved_at (reopen the commitment)
 *
 * Backs the Resolve affordance in the thread detail view and any future
 * bulk-resolve UI. Only touches agent_memories rows where:
 *   - category = 'commitment'
 *   - company_id matches the caller's company
 *
 * The DB trigger from migration 077 recomputes the denormalized
 * email_threads.next_commitment_due_at / has_unresolved_commitments
 * when resolved_at changes, which means the COMMITMENTS rail drops or
 * re-adds the parent thread automatically on this write.
 *
 * Auth: Firebase JWT + `inbox.view` permission. Resolve is a
 * per-user triage action, not an admin operation, so we keep the
 * permission gate the same as reading the inbox.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";

interface ResolveBody {
  resolvedAt: string | null;
}

function isValidIsoOrNull(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = user.id as string;
  const companyId = user.company_id as string;

  const canView = await checkPermissionById(userId, "inbox.view");
  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as ResolveBody | null;
  if (!body || !("resolvedAt" in body) || !isValidIsoOrNull(body.resolvedAt)) {
    return NextResponse.json(
      { error: "Body must include resolvedAt: ISO-8601 string | null" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();

  // Verify ownership: the memory must belong to the caller's company AND be
  // a commitment. Non-commitment rows shouldn't flow through this route.
  const { data: memory, error: fetchError } = await supabase
    .from("agent_memories")
    .select("id, category")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();

  if (fetchError || !memory) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (memory.category !== "commitment") {
    return NextResponse.json(
      { error: "Only commitment memories can be resolved via this endpoint" },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase
    .from("agent_memories")
    .update({ resolved_at: body.resolvedAt })
    .eq("id", id)
    .eq("company_id", companyId);

  if (updateError) {
    console.error("[/api/inbox/commitments/:id] update failed:", updateError.message);
    return NextResponse.json(
      { error: `Update failed: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
