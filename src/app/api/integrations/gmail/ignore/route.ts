/**
 * OPS Web - Gmail Ignore Activity
 *
 * POST /api/integrations/gmail/ignore
 * Dismisses an activity by marking it as read.
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
      "inbox.archive"
    );
    if (authError) return authError;

    const { error } = await supabase
      .from("activities")
      .update({ is_read: true })
      .eq("id", activityId)
      .eq("company_id", activity.company_id as string);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[gmail-ignore]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
