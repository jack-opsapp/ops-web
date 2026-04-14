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
      "id, company_id, role"
    );
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Only admin/owner users may record draft feedback — this writes to
    // the writing profile training data, and crew/operator users must not
    // be able to corrupt it.
    const role = (user.role as string) ?? "unassigned";
    if (!["admin", "owner"].includes(role)) {
      return NextResponse.json(
        { error: "Admin or owner access required for this action" },
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
