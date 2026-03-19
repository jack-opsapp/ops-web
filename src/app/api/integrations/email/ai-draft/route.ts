/**
 * POST /api/integrations/email/ai-draft
 *
 * Generate an AI draft email using writing profile + thread context.
 * NOT gated by phase_c — any user with email connected can use this.
 * Memory context is used when available (phase_c) but not required.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { AIDraftService } from "@/lib/api/services/ai-draft-service";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const {
      companyId,
      userId,
      connectionId,
      opportunityId,
      threadId,
      recipientEmail,
      recipientName,
      userInstruction,
    } = body;

    if (!companyId || !userId || !connectionId) {
      return NextResponse.json(
        { error: "companyId, userId, and connectionId are required" },
        { status: 400 }
      );
    }

    const result = await AIDraftService.generateDraft({
      companyId,
      userId,
      connectionId,
      opportunityId,
      threadId,
      recipientEmail,
      recipientName,
      userInstruction,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai-draft]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate draft" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
