/**
 * GET /api/integrations/email/draft-stats-by-category
 *
 * Returns per-profile-type draft counts for the category autonomy UI.
 * Authenticated: requires Firebase auth + company_id validation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    if (companyId !== user.company_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Count sent drafts grouped by profile_type
    const { data, error } = await supabase
      .from("ai_draft_history")
      .select("profile_type")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
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
