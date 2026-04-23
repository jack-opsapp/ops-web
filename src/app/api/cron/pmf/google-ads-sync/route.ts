/**
 * GET /api/cron/pmf/google-ads-sync
 *
 * Vercel cron: runs daily at 14:15 UTC (~15 minutes after the trial-expiry
 * cron at 14:00 UTC). Pulls yesterday's account-level Google Ads totals via
 * the existing queryDailyAccountData helper (which already converts micros
 * to dollars) and upserts a single row keyed on (channel, spend_date) into
 * ad_spend_log for PMF marker computation (CAC, payback, etc).
 *
 * Distinct from /api/cron/ads-sync: that cron writes to the ads-history
 * schema (daily_account, daily_campaign) used by the ads analytics dashboard.
 * This cron writes to the separate ad_spend_log table used exclusively by
 * PMF analytics. Both can coexist.
 *
 * Records a zero row on no-data days so the dashboard can distinguish
 * "checked, no spend" from "missing data."
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  isGoogleAdsConfigured,
  queryDailyAccountData,
} from "@/lib/analytics/google-ads-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // Skip cleanly if Google Ads is not wired up — not an error.
  if (!isGoogleAdsConfigured()) {
    return NextResponse.json({ skipped: "google ads not configured" });
  }

  // Yesterday in UTC. Google Ads finalizes per-day data ~24h after the day
  // closes, and the cron itself fires at 14:15 UTC, so this is safely "done".
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  let rows: Awaited<ReturnType<typeof queryDailyAccountData>>;
  try {
    rows = await queryDailyAccountData(yesterday, yesterday);
  } catch (err) {
    // Google Ads errors are formatted as "Google Ads API error (status): <raw body>".
    // The raw body can include customer IDs, request diagnostics, and partial auth
    // metadata — log it server-side, but don't echo it back to the HTTP response.
    const message =
      err instanceof Error ? err.message : "google ads query failed";
    console.error("[pmf-google-ads-sync] query failed:", message);
    return NextResponse.json(
      { error: "google ads sync failed" },
      { status: 500 }
    );
  }

  const row = rows[0];
  // No data for yesterday (paused account, ramp-up period, etc) → record a
  // zero row so PMF dashboard can tell "we checked, no spend" apart from
  // "missing data".
  const spendDollars = row?.spend ?? 0;
  const clicks = row?.clicks ?? 0;
  const impressions = row?.impressions ?? 0;
  const spendCents = Math.round(spendDollars * 100);

  const sb = getAdminSupabase();
  const { error } = await sb.from("ad_spend_log").upsert(
    {
      channel: "google_ads",
      spend_date: dateStr,
      spend_cents: spendCents,
      impressions,
      clicks,
      source: "auto_sync",
    },
    { onConflict: "channel,spend_date" }
  );

  if (error) {
    console.error("[pmf-google-ads-sync] upsert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    date: dateStr,
    spend_cents: spendCents,
    impressions,
    clicks,
  });
}
