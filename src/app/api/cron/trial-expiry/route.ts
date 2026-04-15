/**
 * GET /api/cron/trial-expiry
 *
 * Vercel cron: runs daily at 14:00 UTC (7am PT / 10am ET). Fires trial
 * expiry notifications (email, push, in-app) on the 7/5/3/1 day pre-expiry
 * marks and the 7/30 day post-expiry marks.
 *
 * Idempotent — dedupes via the trial_expiry_notifications table, so reruns
 * on the same day are safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { TrialExpiryService } from "@/lib/api/services/trial-expiry-service";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();

  try {
    const result = await TrialExpiryService.processAll(supabase);

    console.log(
      `[cron/trial-expiry] Scanned ${result.scanned} companies, sent ${result.sent.length}, skipped ${result.skipped.length}, errors ${result.errors.length}`
    );

    if (result.errors.length > 0) {
      console.error("[cron/trial-expiry] Errors:", result.errors);
    }

    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cron failed";
    console.error("[cron/trial-expiry]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
