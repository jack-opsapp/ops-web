/**
 * POST /api/integrations/email/draft-feedback
 *
 * Record the outcome of an AI-drafted email:
 * - "sent" with the final version (for edit tracking)
 * - "discarded" if user deleted the draft
 *
 * Computes edit distance and feeds changes back into writing profile.
 * Authenticated: requires Firebase auth + company_id validation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { AIDraftService } from "@/lib/api/services/ai-draft-service";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await findUserByAuth(
      authUser.uid,
      authUser.email,
      "id, company_id"
    );
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Recording draft feedback writes to writing-profile training data, so it
    // is gated on the granular `inbox.send` permission (the same capability
    // that lets a user send the draft whose outcome this records) — never on
    // a coarse role check. Admins/account-holders bypass inside has_permission.
    const canRecord = await checkPermissionById(user.id as string, "inbox.send");
    if (!canRecord) {
      return NextResponse.json(
        { error: "You don't have permission to record draft feedback" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { draftHistoryId, companyId, userId, outcome, finalVersion } = body;

    if (!draftHistoryId || !companyId || !userId || !outcome) {
      return NextResponse.json(
        { error: "draftHistoryId, companyId, userId, and outcome are required" },
        { status: 400 }
      );
    }

    // Validate company ownership
    if (companyId !== user.company_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (outcome !== "sent" && outcome !== "discarded") {
      return NextResponse.json(
        { error: "outcome must be 'sent' or 'discarded'" },
        { status: 400 }
      );
    }

    await AIDraftService.recordDraftOutcome(
      draftHistoryId,
      companyId,
      userId,
      outcome,
      finalVersion
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[draft-feedback]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to record feedback" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
