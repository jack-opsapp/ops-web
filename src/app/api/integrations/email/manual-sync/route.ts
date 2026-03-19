/**
 * POST /api/integrations/email/manual-sync
 * Manual sync endpoint — triggered by user button or webhook push.
 * Supports single connectionId or all active connections for a companyId.
 *
 * Auth: internal callers (webhooks) pass source="webhook" with CRON_SECRET.
 *       User-triggered syncs pass connectionId — we resolve the company and
 *       verify subscription status before proceeding.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { SyncEngine } from "@/lib/api/services/sync-engine";
import { getSubscriptionInfo } from "@/lib/subscription";
import type { Company } from "@/lib/types/models";

export const maxDuration = 300;

type CompanySubscriptionFields = Pick<
  Company,
  "subscriptionPlan" | "subscriptionStatus" | "trialEndDate" | "seatedEmployeeIds" | "adminIds" | "maxSeats"
>;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const { connectionId, companyId, source } = body;

    if (!connectionId && !companyId) {
      return NextResponse.json(
        { error: "connectionId or companyId required" },
        { status: 400 }
      );
    }

    // ── Resolve companyId for subscription check ─────────────────────────
    let resolvedCompanyId = companyId;
    if (!resolvedCompanyId && connectionId) {
      const { data: conn } = await supabase
        .from("email_connections")
        .select("company_id")
        .eq("id", connectionId)
        .single();
      resolvedCompanyId = conn?.company_id as string;
    }

    // ── Subscription gate ────────────────────────────────────────────────
    // Webhook callers (source="webhook") pass CRON_SECRET in the body to
    // bypass this check (the cron already gates on subscription).
    // All other callers must have an active subscription.
    const authHeader = request.headers.get("authorization");
    const isInternalCaller =
      authHeader === `Bearer ${process.env.CRON_SECRET}` &&
      (source === "webhook" || source === "system");

    if (!isInternalCaller && resolvedCompanyId) {
      const { data: company } = await supabase
        .from("companies")
        .select(
          "subscriptionPlan, subscriptionStatus, trialEndDate, seatedEmployeeIds, adminIds, maxSeats"
        )
        .eq("id", resolvedCompanyId)
        .single();

      const info = getSubscriptionInfo(
        company as unknown as CompanySubscriptionFields
      );

      if (!info.isActive) {
        return NextResponse.json(
          { error: "Subscription inactive", reason: "subscription_expired" },
          { status: 403 }
        );
      }
    }

    // ── Resolve connections to sync ──────────────────────────────────────
    let connectionIds: string[] = [];

    if (connectionId) {
      connectionIds = [connectionId];
    } else {
      const { data: connections } = await supabase
        .from("email_connections")
        .select("id")
        .eq("company_id", companyId)
        .eq("sync_enabled", true)
        .eq("status", "active");

      connectionIds = (connections || []).map((c) => c.id as string);
    }

    const results = [];
    for (const id of connectionIds) {
      const result = await SyncEngine.runSync(id);
      results.push({ connectionId: id, ...result });
    }

    return NextResponse.json({
      ok: true,
      source: source || "manual",
      connectionsProcessed: results.length,
      results,
    });
  } catch (err) {
    console.error("[email-manual-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
