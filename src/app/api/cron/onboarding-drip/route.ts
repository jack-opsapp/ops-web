// src/app/api/cron/onboarding-drip/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { OnboardingDripService } from "@/lib/api/services/onboarding-drip-service";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/onboarding-drip
 *
 * Vercel cron: hourly at minute 0 (0 * * * *). Per spec §3 + §9, each
 * candidate company is gated by operator-local hour === 9 so deliveries
 * land near 9am local time. Retries are timezone-agnostic and always
 * sweep regardless of localHour.
 *
 * Auth: Bearer CRON_SECRET. Returns { ok, scanned, calendar_processed,
 * lost_you_fired, retried }. Logs the result line for ingest into
 * Vercel observability.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceRoleClient();
  const now = new Date();

  try {
    const result = await OnboardingDripService.processAll(db, now);
    console.log("[cron/onboarding-drip]", JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/onboarding-drip]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
