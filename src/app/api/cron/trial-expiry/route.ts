/**
 * GET /api/cron/trial-expiry
 *
 * Vercel cron: runs daily at 12:44 UTC. Fires trial
 * expiry notifications (email, push, in-app) on the 7/5/3/1 day pre-expiry
 * marks and the 7/30 day post-expiry marks.
 *
 * Idempotent — dedupes via the trial_expiry_notifications table, so reruns
 * on the same day are safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { TrialExpiryService } from "@/lib/api/services/trial-expiry-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
} from "@/lib/api/services/cron-workload-cursor-service";

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
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "trial-expiry",
      leaseSeconds: 360,
      work: async (lease) => {
        const cursor = await readCronWorkloadCursor(
          supabase,
          "trial-expiry",
          lease
        );
        const result = await TrialExpiryService.processAll(
          supabase,
          new Date(),
          { afterCompanyId: cursor, limit: 10 }
        );
        await advanceCronWorkloadCursor(
          supabase,
          "trial-expiry",
          lease,
          cursor,
          result.nextCompanyCursor
        );
        return result;
      },
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: alreadyRunning,
          ran: false,
          reason: alreadyRunning ? "already_running" : controlled.reason,
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }
    const result = controlled.value;

    console.log(
      `[cron/trial-expiry] Scanned ${result.scanned} companies, sent ${result.sent.length}, skipped ${result.skipped.length}, errors ${result.errors.length}`
    );

    if (result.errors.length > 0) {
      console.error("[cron/trial-expiry] Errors:", result.errors);
    }

    return NextResponse.json({
      ok: true,
      ran: true,
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
