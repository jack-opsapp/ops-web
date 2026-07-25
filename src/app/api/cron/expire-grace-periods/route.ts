/**
 * GET /api/cron/expire-grace-periods
 *
 * Vercel cron: runs daily. Transitions companies that have been in `grace`
 * status for more than 7 days into `expired`. The 7-day window matches the
 * iOS computed property `Company.daysRemainingInGracePeriod`.
 *
 * Grace is entered when Stripe fires `invoice.payment_failed` (see
 * src/app/api/webhooks/stripe/route.ts). seat_grace_start_date is set on the
 * first failure and not overwritten by retries, so the elapsed window is
 * always measured from the original failure.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const maxDuration = 60;

const GRACE_DAYS = 7;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  console.log(`[expire-grace-periods] Cutoff: anything in grace before ${cutoff}`);

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "expire-grace-periods",
      leaseSeconds: 120,
      work: async () => {
        const { data, error } = (await supabase.rpc(
          "expire_grace_period_companies_batch_as_system" as never,
          {
            p_cutoff: cutoff,
            p_batch_size: 500,
          } as never
        )) as unknown as { data: unknown; error: unknown };

        if (error) {
          throw new CronDatabaseOperationError(
            "grace-period expiry batch failed",
            { cause: error }
          );
        }
        if (
          typeof data !== "number" ||
          !Number.isSafeInteger(data) ||
          data < 0 ||
          data > 500
        ) {
          throw new CronDatabaseOperationError(
            "grace-period expiry returned an invalid count",
            { cause: new Error("invalid grace expiry batch result") }
          );
        }
        return { expired: data };
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

    const { expired } = controlled.value;
    if (expired > 0) {
      console.log(`[expire-grace-periods] Expired ${expired} companies`);
    } else {
      console.log("[expire-grace-periods] No grace-period companies past cutoff");
    }

    return NextResponse.json({ ok: true, ran: true, expired });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[expire-grace-periods] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
