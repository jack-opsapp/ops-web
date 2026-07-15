/**
 * OPS Web - Gmail Reject Match
 *
 * POST /api/integrations/gmail/reject-match
 * Rejects a suggested client match: clears client references, marks as unmatched.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const activityId = body.activityId as string | undefined;

    if (!activityId) {
      return NextResponse.json(
        { error: "activityId is required" },
        { status: 400 }
      );
    }
    const { data: activity, error: readError } = await supabase
      .from("activities")
      .select("company_id")
      .eq("id", activityId)
      .single();
    if (readError || !activity) {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 }
      );
    }
    const authError = await requireEmailCompanyAccess(
      request,
      activity.company_id as string,
      "inbox.categorize"
    );
    if (authError) return authError;

    const { error } = await supabase
      .from("activities")
      .update({
        match_needs_review: false,
        client_id: null,
        suggested_client_id: null,
        match_confidence: "unmatched",
      })
      .eq("id", activityId)
      .eq("company_id", activity.company_id as string);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[gmail-reject-match]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
