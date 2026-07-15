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
import { AIDraftService } from "@/lib/api/services/ai-draft-service";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
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
      subject,
      configuredSubject,
    } = body;

    if (!companyId || !userId || !connectionId) {
      return NextResponse.json(
        { error: "companyId, userId, and connectionId are required" },
        { status: 400 }
      );
    }
    const authError = await requireEmailCompanyAccess(
      request,
      companyId,
      "inbox.send",
      userId
    );
    if (authError) return authError;

    const { data: ownedConnection, error: connectionError } = await supabase
      .from("email_connections")
      .select("id")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (connectionError) {
      throw new Error(
        `Failed to validate email connection: ${connectionError.message}`
      );
    }
    if (!ownedConnection) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (opportunityId) {
      const { data: ownedOpportunity, error: opportunityError } = await supabase
        .from("opportunities")
        .select("id")
        .eq("id", opportunityId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (opportunityError) {
        throw new Error(
          `Failed to validate opportunity: ${opportunityError.message}`
        );
      }
      if (!ownedOpportunity) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (threadId) {
      const { data: ownedThread, error: threadError } = await supabase
        .from("email_threads")
        .select("id, opportunity_id")
        .eq("company_id", companyId)
        .eq("connection_id", connectionId)
        .eq("provider_thread_id", threadId)
        .maybeSingle();
      if (threadError) {
        throw new Error(
          `Failed to validate email thread: ${threadError.message}`
        );
      }
      if (
        !ownedThread ||
        (opportunityId && ownedThread.opportunity_id !== opportunityId)
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
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
      subject,
      configuredSubject,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai-draft]", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to generate draft",
      },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
