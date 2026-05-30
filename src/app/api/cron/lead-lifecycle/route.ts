// src/app/api/cron/lead-lifecycle/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runLeadLifecycleCron } from "@/lib/api/services/lead-lifecycle-cron-service";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/lead-lifecycle
 *
 * Vercel cron: daily at 13:00 UTC (06:00 America/Vancouver). The lifecycle
 * cadence is day-based (follow-up after N days, archive after N days, lost
 * after N days), so a single daily sweep is sufficient — sub-daily runs would
 * re-evaluate the same day-boundaries and the action-service idempotency
 * guards would no-op them anyway. 06:00 PT lands the operator's "leads
 * waiting" rail notifications before the workday rather than overnight, and
 * sits clear of the 04:00–05:00 UTC maintenance crons and the email-sync
 * windows.
 *
 * Auth: Bearer CRON_SECRET (mirrors every other OPS cron). Returns the
 * structured run summary and logs a single result line for Vercel
 * observability.
 *
 * Boundary: AUTO-EXECUTES only the non-destructive actions (local template
 * follow-up draft + operator follow-up-miss notification + lifecycle-state
 * updates + inbound supersede), all idempotent via the open-template unique
 * index and the notification dedupe_key. DESTRUCTIVE decisions (archive / lost
 * / reactivate) are surfaced as dry-run candidates only and never applied — the
 * guarded RPC is never called from this route. No emails, no provider drafts,
 * no provider sends.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceRoleClient();
  const now = new Date();

  try {
    const result = await runLeadLifecycleCron({ supabase: db, now });
    // The destructive candidates are surfaced for operator review via the
    // structured log; keep the response payload lean but include the summary
    // counts plus the (capped) candidate list.
    console.log(
      "[cron/lead-lifecycle]",
      JSON.stringify({
        scanned: result.scanned,
        eligibleCompanies: result.eligibleCompanies,
        fragmentedOpportunities: result.fragmentedOpportunities,
        draftsCreated: result.draftsCreated,
        draftsSkippedExisting: result.draftsSkippedExisting,
        notificationsCreated: result.notificationsCreated,
        notificationsSkippedExisting: result.notificationsSkippedExisting,
        lifecycleStatesUpdated: result.lifecycleStatesUpdated,
        draftsSuperseded: result.draftsSuperseded,
        destructiveDryRun: result.destructiveDryRun,
        destructiveSkippedFragmented: result.destructiveSkippedFragmented,
        destructiveReviewNotificationsCreated:
          result.destructiveReviewNotificationsCreated,
        destructiveReviewNotificationsSkippedExisting:
          result.destructiveReviewNotificationsSkippedExisting,
        destructiveReviewNotificationsSkippedMissingOperator:
          result.destructiveReviewNotificationsSkippedMissingOperator,
        nonDestructiveSkipped: result.nonDestructiveSkipped,
        errors: result.errors,
        destructiveCandidates: result.destructiveCandidates,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/lead-lifecycle]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
