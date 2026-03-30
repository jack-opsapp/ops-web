/**
 * POST /api/duplicates/[id]/dismiss
 * Permanently dismisses a duplicate pair — it will never resurface.
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

  const db = getServiceRoleClient();
  setSupabaseOverride(db);

  try {
    await DuplicateDetectionService.dismissPair(
      reviewId,
      user.id as string
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DuplicateDismiss] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
