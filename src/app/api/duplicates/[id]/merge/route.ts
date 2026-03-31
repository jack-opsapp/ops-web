/**
 * POST /api/duplicates/[id]/merge
 * Smart-merges a duplicate cluster: applies user-chosen field values,
 * reassigns relationships, soft-deletes losers.
 * Body: { winnerId: string, fieldOverrides?: Record<string, unknown>, additionalReviewIds?: string[], entityEdits?: Record<string, Record<string, unknown>>, entityType?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";
import type { DuplicateEntityType } from "@/lib/api/services/duplicate-detection-service";

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

  const body = await request.json();
  const { winnerId, fieldOverrides, additionalReviewIds, entityEdits, entityType } = body;

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
        fieldOverrides
      );
    } else {
      await DuplicateDetectionService.mergeEntities(
        reviewId,
        winnerId,
        user.id as string,
        fieldOverrides
      );
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
