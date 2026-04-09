/**
 * POST /api/cron/email-sync
 * Vercel cron: runs every 15 min, syncs connections that are due.
 * Replaces cron/gmail-sync — now supports Gmail + M365.
 *
 * Gates sync on active subscription — expired trials and cancelled
 * subscriptions are skipped silently.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { SyncEngine } from "@/lib/api/services/sync-engine";
import { getSubscriptionInfo } from "@/lib/subscription";
import type { Company } from "@/lib/types/models";

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
  setSupabaseOverride(supabase);

  try {
    const { data: connections, error } = await supabase
      .from("email_connections")
      .select(
        "id, company_id, email, provider, sync_interval_minutes, last_synced_at"
      )
      .eq("sync_enabled", true)
      .eq("status", "active");

    if (error) throw error;

    // ── Subscription gate: batch-fetch companies and filter ──────────────
    const companyIds = [
      ...new Set((connections ?? []).map((c) => c.company_id as string)),
    ];

    const { data: companies } = await supabase
      .from("companies")
      .select(
        "id, subscriptionPlan, subscriptionStatus, trialEndDate, seatedEmployeeIds, adminIds, maxSeats"
      )
      .in("id", companyIds);

    const activeCompanyIds = new Set(
      (companies ?? [])
        .filter((c) => {
          const info = getSubscriptionInfo(c as unknown as Pick<
            Company,
            "subscriptionPlan" | "subscriptionStatus" | "trialEndDate" | "seatedEmployeeIds" | "adminIds" | "maxSeats"
          >);
          return info.isActive;
        })
        .map((c) => c.id as string)
    );

    const now = Date.now();
    const results: Array<{
      connectionId: string;
      email: string;
      provider: string;
      activitiesCreated: number;
      newLeads: number;
      error?: string;
    }> = [];
    let skippedInactive = 0;

    for (const conn of connections ?? []) {
      // Skip companies with expired/cancelled subscriptions
      if (!activeCompanyIds.has(conn.company_id as string)) {
        skippedInactive++;
        continue;
      }

      const intervalMs =
        ((conn.sync_interval_minutes as number) ?? 60) * 60 * 1000;
      const lastSynced = conn.last_synced_at
        ? new Date(conn.last_synced_at as string).getTime()
        : 0;

      if (now - lastSynced < intervalMs) continue;

      try {
        const result = await SyncEngine.runSync(conn.id as string);
        results.push({
          connectionId: conn.id as string,
          email: conn.email as string,
          provider: conn.provider as string,
          activitiesCreated: result.activitiesCreated,
          newLeads: result.newLeads,
        });
      } catch (err) {
        results.push({
          connectionId: conn.id as string,
          email: conn.email as string,
          provider: conn.provider as string,
          activitiesCreated: 0,
          newLeads: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Sweep stale leads (follow-up detection independent of new email arrival)
    let staleSweepChanges = 0;
    try {
      staleSweepChanges = await SyncEngine.sweepStaleLeads();
    } catch (sweepErr) {
      console.error("[email-cron-sync] stale sweep error:", sweepErr);
    }

    return NextResponse.json({
      ok: true,
      synced: results.length,
      skippedInactive,
      staleSweepChanges,
      results,
    });
  } catch (err) {
    console.error("[email-cron-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
