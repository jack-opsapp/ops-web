/**
 * POST /api/integrations/email/draft
 * Generate a draft reply for a pipeline lead using AI memory + writing profile.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { DraftGenerator } from "@/lib/api/services/draft-generator";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import { WritingProfileService } from "@/lib/api/services/writing-profile-service";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const { companyId, userId, opportunityId, checkOnly } = body;

    if (!companyId || !userId || !opportunityId) {
      return NextResponse.json(
        { error: "companyId, userId, and opportunityId required" },
        { status: 400 }
      );
    }

    // Quick availability check — no AI calls
    if (checkOnly) {
      const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
        companyId,
        "phase_c"
      );
      if (!enabled) {
        return NextResponse.json({ available: false, confidence: 0, draft: "", sources: [], reason: "Phase C not enabled" });
      }
      const profile = await WritingProfileService.getProfile(companyId, userId);
      const confidence = WritingProfileService.getConfidence(
        (profile?.emails_analyzed as number) || 0
      );
      return NextResponse.json({
        available: confidence >= 0.5,
        confidence,
        draft: "",
        sources: [],
        reason: confidence < 0.5
          ? `Need more email data (${(profile?.emails_analyzed as number) || 0}/100 emails, confidence: ${(confidence * 100).toFixed(0)}%)`
          : undefined,
      });
    }

    // Fetch opportunity + client
    const { data: opp } = await supabase
      .from("opportunities")
      .select("*, clients!inner(name, email)")
      .eq("id", opportunityId)
      .single();

    if (!opp) {
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 }
      );
    }

    // Fetch last inbound email activity
    const { data: lastActivity } = await supabase
      .from("activities")
      .select("subject, content")
      .eq("opportunity_id", opportunityId)
      .eq("type", "email")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1);

    const client = opp.clients as Record<string, unknown>;

    const result = await DraftGenerator.generateDraft(companyId, userId, {
      clientName: (client.name as string) || "",
      clientEmail: (client.email as string) || "",
      projectDescription: (opp.title as string) || "",
      lastInboundSubject: (lastActivity?.[0]?.subject as string) || "",
      lastInboundBody: (lastActivity?.[0]?.content as string) || "",
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[draft-generator]", err);
    return NextResponse.json(
      { error: "Failed to generate draft" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
