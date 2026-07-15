/**
 * POST /api/integrations/email/draft-feedback
 *
 * Record abandonment of an AI-drafted email.
 *
 * Sent outcomes are deliberately owned by the confirmed-delivery learning
 * queue. Accepting a client-reported "sent" event here would allow an
 * unconfirmed preview/edit to train the writing profile.
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
    const canRecord = await checkPermissionById(
      user.id as string,
      "inbox.send"
    );
    if (!canRecord) {
      return NextResponse.json(
        { error: "You don't have permission to record draft feedback" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { draftHistoryId, companyId, userId, outcome } = body;

    if (!draftHistoryId || !companyId || !userId || !outcome) {
      return NextResponse.json(
        {
          error: "draftHistoryId, companyId, userId, and outcome are required",
        },
        { status: 400 }
      );
    }

    // Validate company ownership
    if (companyId !== user.company_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: ownedDraft, error: draftError } = await supabase
      .from("ai_draft_history")
      .select("id")
      .eq("id", draftHistoryId)
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (draftError) {
      throw new Error(
        `Failed to validate draft feedback ownership: ${draftError.message}`
      );
    }
    if (!ownedDraft) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (outcome !== "discarded") {
      return NextResponse.json(
        { error: "Only discarded draft feedback is accepted here" },
        { status: 400 }
      );
    }

    await AIDraftService.recordDraftOutcome(
      draftHistoryId,
      companyId,
      userId,
      "discarded"
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[draft-feedback]", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to record feedback",
      },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
