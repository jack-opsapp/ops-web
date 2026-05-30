/**
 * POST /api/data-review/[id]/quarantine
 *
 * Marks a split provider thread reviewed-and-left-as-is by re-pointing its
 * activities onto a synthetic `legacy:<providerThreadId>` thread id — the same
 * quarantine marker the DW1 de-aggregation uses — so the item drops out of the
 * actionable queue and the lifecycle cron's fragmentation skip covers it. No
 * opportunity links change, no rows are deleted. All logic lives in
 * LeadDataReviewService.quarantineThread (idempotent, allow-listed write only).
 *
 * `[id]` is the provider thread id. On success, inserts a standard dismissible
 * rail notification. Permission gate: pipeline.manage.
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

  // Granular permission — never filter by role.
  const allowed = await checkPermissionById(user.id as string, "pipeline.manage");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    const result = await LeadDataReviewService.quarantineThread(providerThreadId);

    const companyId = user.company_id as string | null;
    if (companyId) {
      const subjectLabel = result.subject?.trim() || "thread";
      await db.from("notifications").insert({
        user_id: user.id as string,
        company_id: companyId,
        type: "duplicates_found",
        title: `QUARANTINED · ${subjectLabel}`,
        body: "item left quarantined",
        is_read: false,
        persistent: false,
        dedupe_key: `data_review:quarantine:${providerThreadId}`,
      });
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DataReview] quarantine error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
