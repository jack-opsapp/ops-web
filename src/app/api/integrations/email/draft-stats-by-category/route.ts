/**
 * GET /api/integrations/email/draft-stats-by-category
 *
 * Returns per-profile-type draft counts for the category autonomy UI.
 * Authenticated: requires Firebase auth + company_id validation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";

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

    const access = await resolveEmailConnectionOperationAccess({
      request,
      claimedCompanyId: companyId,
      connectionId,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          error:
            access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
        },
        { status: access.status }
      );
    }

    // Count sent drafts grouped by profile_type
    const { data, error } = await supabase
      .from("ai_draft_history")
      .select("profile_type")
      .eq("company_id", companyId)
      .eq("connection_id", connectionId)
      .eq("user_id", access.actor.userId)
      .eq("status", "sent");

    if (error) {
      console.error("[draft-stats-by-category] Query error:", error.message);
      return NextResponse.json(
        { error: "Failed to fetch stats" },
        { status: 500 }
      );
    }

    const counts: Record<string, number> = {};
    for (const row of data || []) {
      const pt = (row.profile_type as string) || "general";
      counts[pt] = (counts[pt] || 0) + 1;
    }

    return NextResponse.json({ categoryCounts: counts });
  } catch (err) {
    console.error("[draft-stats-by-category] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
