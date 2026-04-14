/**
 * GET /api/agent/comms-wizard/gating
 *
 * Returns the two numbers the wizard needs to decide whether FULL AUTO
 * appointment confirmation is available:
 *   - writingProfileConfidence (0-1)
 *   - priorConfirmationsSent (integer)
 *
 * FULL AUTO is unlocked when confidence >= 0.85 AND priorConfirmationsSent >= 50.
 * Any phase_c-enabled caller can read this.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  isErrorResponse,
  requireAdminOrOwner,
} from "../../_lib/auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

const FULL_AUTO_MIN_CONFIDENCE = 0.85;
const FULL_AUTO_MIN_PRIORS = 50;

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    const roleErr = requireAdminOrOwner(auth);
    if (roleErr) return roleErr;

    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      auth.companyId,
      "phase_c"
    );

    const supabase = getServiceRoleClient();

    // Writing profile confidence — take the max across all profile types
    const { data: profiles } = await supabase
      .from("agent_writing_profiles")
      .select("emails_analyzed")
      .eq("company_id", auth.companyId);

    const maxEmailsAnalyzed = (profiles ?? []).reduce(
      (max, p) => Math.max(max, (p.emails_analyzed as number) ?? 0),
      0
    );
    // Must match WritingProfileService.getConfidence
    const writingProfileConfidence = Math.min(
      1,
      Math.log10(maxEmailsAnalyzed + 1) / 2
    );

    // Prior successful appointment confirmations
    const { count: priorConfirmationsSent } = await supabase
      .from("agent_actions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", auth.companyId)
      .eq("action_type", "send_appointment_confirmation")
      .eq("status", "executed");

    const fullAutoUnlocked =
      writingProfileConfidence >= FULL_AUTO_MIN_CONFIDENCE &&
      (priorConfirmationsSent ?? 0) >= FULL_AUTO_MIN_PRIORS;

    return NextResponse.json({
      phaseCEnabled,
      writingProfileConfidence,
      priorConfirmationsSent: priorConfirmationsSent ?? 0,
      fullAutoUnlocked,
      thresholds: {
        minConfidence: FULL_AUTO_MIN_CONFIDENCE,
        minPriors: FULL_AUTO_MIN_PRIORS,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/comms-wizard/gating]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
