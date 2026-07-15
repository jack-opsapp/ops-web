/**
 * OPS Web - Gmail Confirm Match
 *
 * POST /api/integrations/gmail/confirm-match
 * Confirms a suggested client match: promotes suggested_client_id to client_id.
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

    // Read the activity to get suggested_client_id
    const { data: activity, error: readError } = await supabase
      .from("activities")
      .select("id, company_id, suggested_client_id")
      .eq("id", activityId)
      .single();

    if (readError) throw readError;

    if (!activity) {
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

    // Update: promote suggested_client_id to client_id
    const { error: updateError } = await supabase
      .from("activities")
      .update({
        match_needs_review: false,
        client_id: activity.suggested_client_id,
        is_read: true,
      })
      .eq("id", activityId)
      .eq("company_id", activity.company_id as string);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[gmail-confirm-match]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
