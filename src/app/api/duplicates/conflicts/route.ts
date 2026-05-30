/**
 * POST /api/duplicates/conflicts
 *
 * Read-only conflict-detection gate for the merge flow. For a given review (or
 * cluster) and a chosen winner, returns the auto fill-blank set plus the
 * non-blank-differing fields that require an explicit operator choice (Q2 —
 * SURFACE EVERY CONFLICT). Mutates nothing.
 *
 * Body: { reviewIds: string[], winnerId: string }
 * Returns: { entityType, perLoser: Array<{ loserId, reconciliation: { fieldFill, conflicts } }> }
 *
 * Permission gate: pipeline.manage (granular — never role-filtered). Mirrors the
 * auth scaffold of /api/duplicates/[id]/merge.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(auth.uid, auth.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // Granular permission — never filter by role. Conflict detection reads the
  // same pipeline records the merge mutates, so it is gated on pipeline.manage.
  const allowed = await checkPermissionById(user.id as string, "pipeline.manage");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { reviewIds, winnerId } = body as {
    reviewIds?: unknown;
    winnerId?: unknown;
  };

  if (
    !Array.isArray(reviewIds) ||
    reviewIds.length === 0 ||
    !reviewIds.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "reviewIds is required (non-empty string array)" },
      { status: 400 }
    );
  }
  if (!winnerId || typeof winnerId !== "string") {
    return NextResponse.json(
      { error: "winnerId is required" },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();
  setSupabaseOverride(db);

  try {
    const result = await DuplicateDetectionService.detectMergeConflicts(
      reviewIds as string[],
      winnerId
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DuplicateConflicts] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
