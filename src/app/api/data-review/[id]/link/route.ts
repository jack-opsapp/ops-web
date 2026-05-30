/**
 * POST /api/data-review/[id]/link
 *
 * Re-points a split provider thread's activities onto the operator-chosen
 * owning opportunity — the confident re-point the auto-resolver refused, now
 * operator-authorized. `[id]` is the provider thread id; the body carries the
 * chosen target. All re-point logic + the single-client guard live in
 * LeadDataReviewService.linkThread (idempotent, allow-listed writes only —
 * never a raw multi-write).
 *
 * Body: { targetOpportunityId: string }
 *
 * On success, inserts a standard dismissible rail notification (distinct from
 * the P3 persistent leads_waiting candidates). Permission gate: pipeline.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { LeadDataReviewService } from "@/lib/api/services/lead-data-review-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: providerThreadId } = await params;

  const auth = await verifyAdminAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(auth.uid, auth.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // Granular permission — never filter by role. Re-pointing mutates pipeline
  // correspondence, so it is gated on pipeline.manage.
  const allowed = await checkPermissionById(user.id as string, "pipeline.manage");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { targetOpportunityId } = body as { targetOpportunityId?: unknown };
  if (!targetOpportunityId || typeof targetOpportunityId !== "string") {
    return NextResponse.json(
      { error: "targetOpportunityId is required" },
      { status: 400 }
    );
  }
  if (!providerThreadId) {
    return NextResponse.json(
      { error: "provider thread id is required" },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();
  setSupabaseOverride(db);

  try {
    const result = await LeadDataReviewService.linkThread(
      providerThreadId,
      targetOpportunityId
    );

    // Standard dismissible rail notification — the operator already acted.
    const companyId = user.company_id as string | null;
    if (companyId) {
      const subjectLabel = result.targetTitle?.trim() || "thread";
      await db.from("notifications").insert({
        user_id: user.id as string,
        company_id: companyId,
        type: "duplicates_found",
        title: `LINK RESOLVED · ${subjectLabel}`,
        body: `${result.activitiesRepointed} activities re-pointed to ${subjectLabel}`,
        is_read: false,
        persistent: false,
        action_url: `/dashboard?openProject=${result.targetOpportunityId}&mode=view`,
        action_label: "View",
        dedupe_key: `data_review:link:${providerThreadId}`,
      });
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DataReview] link error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
