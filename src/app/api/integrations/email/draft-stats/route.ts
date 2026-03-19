/**
 * GET /api/integrations/email/draft-stats
 *
 * Returns AI draft approval rate stats for the current user.
 * Used by the compose modal and settings page to display
 * approval rate and suggest auto-send.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { AIDraftService } from "@/lib/api/services/ai-draft-service";

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const userId = searchParams.get("userId");

    if (!companyId || !userId) {
      return NextResponse.json(
        { error: "companyId and userId are required" },
        { status: 400 }
      );
    }

    const stats = await AIDraftService.getApprovalStats(companyId, userId);
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[draft-stats]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch stats" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
