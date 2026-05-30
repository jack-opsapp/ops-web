/**
 * POST /api/duplicates/[id]/merge
 * Smart-merges a duplicate cluster: applies user-chosen field values,
 * reassigns relationships, soft-deletes losers.
 * Body: { winnerId: string, fieldOverrides?: Record<string, unknown>, additionalReviewIds?: string[], entityEdits?: Record<string, Record<string, unknown>>, entityType?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";
import type { DuplicateEntityType } from "@/lib/api/services/duplicate-detection-service";
import { renderForCompany } from "@/i18n/server-render";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params;

  const auth = await verifyAdminAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(auth.uid, auth.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // Granular permission — never filter by role. Merging duplicates mutates
  // pipeline records, so it is gated on the pipeline.manage permission.
  const allowed = await checkPermissionById(user.id as string, "pipeline.manage");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const {
    winnerId,
    // `confirmedOverrides` is the operator-confirmed overwrite of non-blank
    // winner fields (Q2). `fieldOverrides` is accepted as a legacy alias.
    confirmedOverrides,
    fieldOverrides,
    additionalReviewIds,
    entityEdits,
    entityType,
    // Display-only outcome data for the success rail notification (resolved on
    // the client, which already holds the cluster + selection state). Optional —
    // when absent, the merge still succeeds; only the notification is skipped.
    winnerTitle,
    absorbedCount,
    resolvedCount,
    notificationActionUrl,
  } = body;
  const overrides = confirmedOverrides ?? fieldOverrides;

  if (!winnerId || typeof winnerId !== "string") {
    return NextResponse.json(
      { error: "winnerId is required" },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();
  setSupabaseOverride(db);

  try {
    // Apply entity edits before merging (if any)
    if (entityEdits && entityType && typeof entityEdits === "object" && Object.keys(entityEdits).length > 0) {
      await DuplicateDetectionService.applyEntityEdits(
        entityEdits as Record<string, Record<string, unknown>>,
        entityType as DuplicateEntityType
      );
    }

    // If additionalReviewIds are provided, use cluster merge for efficiency
    if (additionalReviewIds && additionalReviewIds.length > 0) {
      const allReviewIds = [reviewId, ...additionalReviewIds];
      await DuplicateDetectionService.mergeCluster(
        allReviewIds,
        winnerId,
        user.id as string,
        overrides
      );
    } else {
      await DuplicateDetectionService.mergeEntities(
        reviewId,
        winnerId,
        user.id as string,
        overrides
      );
    }

    // Merge succeeded — fire a standard dismissible success rail notification
    // (OPS notification mandate). Localized server-side; purpose-named type so
    // the rail buckets it as a merge outcome, not a duplicates scan. The merge
    // is complete, so it is NOT persistent. Skipped silently if the client did
    // not supply display data — the merge result itself is unaffected.
    const companyId = user.company_id as string | null;
    const absorbed = Number(absorbedCount);
    const resolved = Number(resolvedCount);
    if (
      companyId &&
      typeof winnerTitle === "string" &&
      winnerTitle.trim() &&
      Number.isFinite(absorbed) &&
      Number.isFinite(resolved)
    ) {
      const bodyKey =
        absorbed === 1 ? "conflict.successBodyOne" : "conflict.successBodyMany";
      const [title, notifBody, actionLabel] = await Promise.all([
        renderForCompany(companyId, "duplicates", "conflict.successTitle", {
          title: winnerTitle.trim(),
        }),
        renderForCompany(companyId, "duplicates", bodyKey, {
          absorbed,
          resolved,
        }),
        renderForCompany(companyId, "duplicates", "conflict.successAction"),
      ]);
      await db.from("notifications").insert({
        user_id: user.id as string,
        company_id: companyId,
        type: "duplicates_merged",
        title,
        body: notifBody,
        is_read: false,
        persistent: false,
        action_url:
          typeof notificationActionUrl === "string" && notificationActionUrl
            ? notificationActionUrl
            : null,
        action_label:
          typeof notificationActionUrl === "string" && notificationActionUrl
            ? actionLabel
            : null,
        dedupe_key: `duplicates:merged:${reviewId}:${winnerId}`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DuplicateMerge] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
