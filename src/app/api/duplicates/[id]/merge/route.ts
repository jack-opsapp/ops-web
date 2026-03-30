/**
 * POST /api/duplicates/[id]/merge
 * Smart-merges a duplicate pair: backfills fields, reassigns relationships,
 * soft-deletes the loser.
 * Body: { winnerId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";

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
  const { winnerId } = body;

  if (!winnerId || typeof winnerId !== "string") {
    return NextResponse.json(
      { error: "winnerId is required" },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();
  setSupabaseOverride(db);

  try {
    await DuplicateDetectionService.mergeEntities(
      reviewId,
      winnerId,
      user.id as string
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DuplicateMerge] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
