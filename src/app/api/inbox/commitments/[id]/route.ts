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
 * Auth: canonical OPS actor + current `pipeline.edit` ∩ `inbox.view`
 * authority for the lead linked to the commitment's source thread.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";

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
  const { id } = await params;
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;

  const body = (await request.json().catch(() => null)) as ResolveBody | null;
  if (!body || !("resolvedAt" in body) || !isValidIsoOrNull(body.resolvedAt)) {
    return NextResponse.json(
      { error: "Body must include resolvedAt: ISO-8601 string | null" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const { data: resolved, error: updateError } = await supabase.rpc(
    "resolve_email_commitment_as_system",
    {
      p_actor_user_id: actorResolution.actor.userId,
      p_memory_id: id,
      p_resolved_at: body.resolvedAt,
    }
  );
  if (updateError) {
    console.error(
      "[/api/inbox/commitments/:id] update failed:",
      updateError.message
    );
    return NextResponse.json(
      { error: `Update failed: ${updateError.message}` },
      { status: 500 }
    );
  }
  if (resolved !== true) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
