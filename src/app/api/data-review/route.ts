/**
 * GET /api/data-review
 *
 * Read-only feed for the `// DATA REVIEW QUEUE` admin panel. Returns the
 * genuinely-actionable residual of the P1 DW2 link-reconciliation pass:
 *   - split   : provider threads fanned across >1 opportunity (operator must
 *     pick the canonical owner — the auto-resolver refused the cross-boundary
 *     re-point);
 *   - terminal_live : NULL-canonical cache rows whose singular join points at a
 *     terminal-but-live opportunity (needs operator sign-off);
 * plus `quarantinedCount` — the passive de-aggregated blank-bucket activities,
 * surfaced as a muted count only (never an actionable list).
 *
 * Mutates nothing. Permission gate: pipeline.manage (granular — never role-
 * filtered). Mirrors the auth/permission scaffold of /api/duplicates/conflicts.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { LeadDataReviewService } from "@/lib/api/services/lead-data-review-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(auth.uid, auth.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // Granular permission — never filter by role. The queue reads + re-points
  // pipeline correspondence, so it is gated on pipeline.manage.
  const allowed = await checkPermissionById(user.id as string, "pipeline.manage");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceRoleClient();
  setSupabaseOverride(db);

  try {
    const queue = await LeadDataReviewService.getQueue();
    return NextResponse.json(queue);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DataReview] queue error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
