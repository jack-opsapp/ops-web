/**
 * GET /api/cron/ads-conversions[?validateOnly=1]
 *
 * Hourly (41 * * * *): drain the conversion outbox to Google's Data Manager
 * API — trial started / activated / paid, matched to the click that bought
 * the trial by gclid/gbraid/wbraid or hashed owner email.
 *
 * Same skeleton as ads-sync: CRON_SECRET bearer, the durable global workload
 * lease (workloadKey ads-conversions, 120 s), degrade over 500. `validateOnly=1`
 * asks Google to validate the batch and persists nothing — the rehearsal path.
 */
import { NextRequest, NextResponse } from "next/server";
import { runConversionOutbox } from "@/lib/ads/conversion-outbox";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const maxDuration = 60;
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const validateOnly = request.nextUrl.searchParams.get("validateOnly") === "1";

  try {
    const supabase = getAdminSupabase();
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "ads-conversions",
      leaseSeconds: 120,
      work: () => runConversionOutbox({ validateOnly }),
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          status: alreadyRunning ? "already_running" : "unavailable",
          ran: false,
          reason: controlled.reason,
        },
        { status: alreadyRunning ? 200 : 503, headers: NO_STORE }
      );
    }

    return NextResponse.json(
      { status: "processed", ran: true, ...controlled.value },
      { headers: NO_STORE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ads-conversions] run failed:", message);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
