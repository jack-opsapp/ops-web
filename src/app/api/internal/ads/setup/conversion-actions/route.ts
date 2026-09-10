/**
 * POST /api/internal/ads/setup/conversion-actions[?validateOnly=1]
 *
 * Reconcile the OPS conversion actions on the Google Ads account (create the
 * three UPLOAD_CLICKS actions, demote the Firebase iOS ones, remove the
 * Bubble-era ones) and record their resource names in ads_conversion_actions.
 * Idempotent: a second run plans zero operations.
 *
 * `?validateOnly=1` is the dry run — Google validates, nothing is written
 * anywhere. Without it the apply still validates first and only proceeds on
 * a clean pass (see ensureConversionActions).
 *
 * Auth: CRON_SECRET bearer, the same check as the cron routes. Operator-run,
 * never scheduled.
 */
import { NextRequest, NextResponse } from "next/server";
import { ensureConversionActions } from "@/lib/ads/conversion-actions";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405, headers: { ...NO_STORE, allow: "POST" } }
  );
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const validateOnly = request.nextUrl.searchParams.get("validateOnly") === "1";

  try {
    const outcome = await ensureConversionActions({ validateOnly });
    return NextResponse.json(
      {
        validateOnly,
        validated: outcome.validated,
        operations: outcome.operations,
        failures: outcome.result.failures,
        requestId: outcome.result.requestId ?? null,
        recorded: outcome.recorded,
        unresolved: outcome.unresolved,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ads-setup] conversion-actions failed:", message);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
