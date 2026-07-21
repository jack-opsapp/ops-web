/**
 * GET /api/integrations/email/draft-stats
 *
 * Returns AI draft approval rate stats for the current user.
 * Used by the compose modal and settings page to display
 * actor-scoped approval rate and edit-pattern diagnostics. Exact auto-send
 * readiness is served separately per mailbox and primary category.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolvePhaseCCategorySettingsAccess } from "@/lib/email/phase-c-category-settings-access";
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
    const connectionId = searchParams.get("connectionId");

    if (!companyId || !connectionId) {
      return NextResponse.json(
        { error: "companyId and connectionId are required" },
        { status: 400 }
      );
    }

    const access = await resolvePhaseCCategorySettingsAccess({
      request,
      claimedCompanyId: companyId,
      connectionId,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          error: access.status === 401 ? "Unauthorized" : "Forbidden",
        },
        { status: access.status }
      );
    }

    const stats = await AIDraftService.getApprovalStats(
      companyId,
      connectionId,
      access.actor.userId
    );
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
