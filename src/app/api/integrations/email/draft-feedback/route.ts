/**
 * POST /api/integrations/email/draft-feedback
 *
 * Record the outcome of an AI-drafted email:
 * - "sent" with the final version (for edit tracking)
 * - "discarded" if user deleted the draft
 *
 * Computes edit distance and feeds changes back into writing profile.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { AIDraftService } from "@/lib/api/services/ai-draft-service";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const { draftHistoryId, companyId, userId, outcome, finalVersion } = body;

    if (!draftHistoryId || !companyId || !userId || !outcome) {
      return NextResponse.json(
        { error: "draftHistoryId, companyId, userId, and outcome are required" },
        { status: 400 }
      );
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
