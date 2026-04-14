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
    const { data, error } = await supabase
      .from("companies")
      .update({ subscription_status: "expired" })
      .eq("subscription_status", "grace")
      .lt("seat_grace_start_date", cutoff)
      .select("id, name");

    if (error) {
      console.error("[expire-grace-periods] Update failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const expired = data?.length ?? 0;
    if (expired > 0) {
      console.log(
        `[expire-grace-periods] Expired ${expired} companies:`,
        data?.map((c) => `${c.id} (${c.name})`).join(", ")
      );
    } else {
      console.log("[expire-grace-periods] No grace-period companies past cutoff");
    }

    return NextResponse.json({ ok: true, expired });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[expire-grace-periods] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
