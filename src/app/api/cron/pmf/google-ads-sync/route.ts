/**
 * GET /api/cron/pmf/google-ads-sync
 *
 * Vercel cron: runs daily at 10:24 UTC. Pulls yesterday's account-level Google Ads totals via
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
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  isGoogleAdsConfigured,
  queryDailyAccountData,
} from "@/lib/analytics/google-ads-client";
import {
  classifyGoogleAdsAccessFailure,
  reportAdsProviderHealth,
} from "@/lib/admin/ads-provider-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

class GoogleAdsProviderError extends Error {
  constructor(options: { cause: unknown }) {
    super("google ads sync failed", options);
    this.name = "GoogleAdsProviderError";
  }
}

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

  try {
    const sb = getAdminSupabase();
    const controlled = await runWithCronWorkloadControl({
      supabase: sb,
      workloadKey: "pmf-google-ads-sync",
      leaseSeconds: 120,
      work: async () => {
        // Yesterday in UTC. Google Ads finalizes per-day data about 24 hours
        // after close, so the scheduled pull reads a settled day.
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const dateStr = yesterday.toISOString().slice(0, 10);

        let rows: Awaited<ReturnType<typeof queryDailyAccountData>>;
        try {
          rows = await queryDailyAccountData(yesterday, yesterday);
        } catch (error) {
          // A blocked account/token is a standing operator condition. Degrade
          // and write NO spend row: a missing day truthfully means "not
          // synced", where a zero row would claim "checked, no spend".
          const accessReason = classifyGoogleAdsAccessFailure(error);
          if (accessReason) {
            await reportAdsProviderHealth(sb, {
              blocked: true,
              reason: accessReason,
            });
            return {
              degraded: accessReason,
              date: dateStr,
              spendCents: 0,
              impressions: 0,
              clicks: 0,
            };
          }
          const message =
            error instanceof Error ? error.message : "google ads query failed";
          console.error("[pmf-google-ads-sync] query failed:", message);
          throw new GoogleAdsProviderError({ cause: error });
        }

        const row = rows[0];
        // Record zero on no-data days so "checked, no spend" stays distinct
        // from a missing synchronization.
        const spendDollars = row?.spend ?? 0;
        const clicks = row?.clicks ?? 0;
        const impressions = row?.impressions ?? 0;
        const spendCents = Math.round(spendDollars * 100);

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
          throw new CronDatabaseOperationError(
            "PMF Google Ads upsert failed",
            { cause: error }
          );
        }

        await reportAdsProviderHealth(sb, { blocked: false });

        return {
          degraded: null as string | null,
          date: dateStr,
          spendCents,
          impressions,
          clicks,
        };
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

    if (controlled.value.degraded) {
      return NextResponse.json(
        {
          ok: false,
          ran: true,
          degraded: "provider_access",
          reason: controlled.value.degraded,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      ran: true,
      date: controlled.value.date,
      spend_cents: controlled.value.spendCents,
      impressions: controlled.value.impressions,
      clicks: controlled.value.clicks,
    });
  } catch (error) {
    if (!(error instanceof GoogleAdsProviderError)) {
      console.error("[pmf-google-ads-sync] failed:", error);
    }
    return NextResponse.json(
      { error: "google ads sync failed" },
      { status: 500 }
    );
  }
}
