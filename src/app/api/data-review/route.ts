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
 * Mutates nothing. Each returned item must pass the authenticated OPS actor's
 * canonical opportunity-view AND inbox-view scope for its exact mailbox.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { LeadDataReviewService } from "@/lib/api/services/lead-data-review-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { userId: actorUserId, companyId } = actorResolution.actor;

  const db = getServiceRoleClient();

  try {
    const queue = await runWithSupabase(db, () =>
      LeadDataReviewService.getQueue({ actorUserId, companyId })
    );
    return NextResponse.json(queue);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DataReview] queue error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
