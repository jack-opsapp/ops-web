/**
 * OPS Web - Gmail Manual Sync
 *
 * POST /api/integrations/gmail/manual-sync
 * Triggered by the user from the Settings UI to manually sync email inboxes
 * for their company.
 *
 * Delegates to SyncEngine (same code path as the cron and email/manual-sync
 * endpoints) so the user-triggered path, cron path, and webhook path all
 * share the same subscription gating, filter service, typed-error recovery,
 * and needs_reconnect logic. The route name is preserved because the UI
 * hook (useTriggerGmailSync) still calls this path.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { SyncEngine } from "@/lib/api/services/sync-engine";
import { getSubscriptionInfo } from "@/lib/subscription";
import {
  SubscriptionPlan,
  SubscriptionStatus,
  type Company,
} from "@/lib/types/models";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";

type CompanySubscriptionFields = Pick<
  Company,
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "trialEndDate"
  | "seatedEmployeeIds"
  | "adminIds"
  | "maxSeats"
>;

function mapSubscriptionRow(
  row: Record<string, unknown>
): CompanySubscriptionFields {
  return {
    subscriptionPlan: (row.subscription_plan as SubscriptionPlan) ?? null,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) ?? null,
    trialEndDate: row.trial_end_date
      ? new Date(row.trial_end_date as string)
      : null,
    seatedEmployeeIds: (row.seated_employee_ids as string[]) ?? [],
    adminIds: (row.admin_ids as string[]) ?? [],
    maxSeats: (row.max_seats as number) ?? 10,
  };
}

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const companyId = body.companyId as string | undefined;

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }
    const authError = await requireEmailCompanyAccess(request, companyId);
    if (authError) return authError;

    // ── Subscription gate ───────────────────────────────────────────────
    // Fail closed — a broken company lookup must never let a lapsed
    // subscription silently run a sync.
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select(
        "subscription_plan, subscription_status, trial_end_date, seated_employee_ids, admin_ids, max_seats"
      )
      .eq("id", companyId)
      .single();

    if (companyError || !company) {
      console.error(
        "[gmail-manual-sync] Company subscription lookup failed:",
        companyError
      );
      return NextResponse.json(
        { error: "Failed to verify subscription" },
        { status: 500 }
      );
    }

    const info = getSubscriptionInfo(mapSubscriptionRow(company));
    if (!info.isActive) {
      return NextResponse.json(
        { error: "Subscription inactive", reason: "subscription_expired" },
        { status: 402 }
      );
    }

    // Load active email connections for this company (gmail or M365).
    const { data: connections, error: connectionsError } = await supabase
      .from("email_connections")
      .select("id, email")
      .eq("company_id", companyId)
      .eq("sync_enabled", true)
      .eq("status", "active");

    if (connectionsError) {
      console.error(
        "[gmail-manual-sync] connections query failed:",
        connectionsError
      );
      return NextResponse.json(
        { error: "Failed to load email connections" },
        { status: 500 }
      );
    }

    const results: Array<{
      connectionId: string;
      email: string;
      activitiesCreated: number;
      matched: number;
      needsReview: number;
      newLeads: number;
      error?: string;
    }> = [];

    for (const conn of connections ?? []) {
      try {
        const result = await SyncEngine.runSync(conn.id as string);
        results.push({
          connectionId: conn.id as string,
          email: conn.email as string,
          activitiesCreated: result.activitiesCreated,
          matched: result.matched,
          needsReview: result.needsReview,
          newLeads: result.newLeads,
          ...(result.errors.length > 0
            ? { error: result.errors.join("; ") }
            : {}),
        });
      } catch (err) {
        results.push({
          connectionId: conn.id as string,
          email: conn.email as string,
          activitiesCreated: 0,
          matched: 0,
          needsReview: 0,
          newLeads: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const totalActivities = results.reduce(
      (s, r) => s + r.activitiesCreated,
      0
    );

    return NextResponse.json({
      ok: true,
      connectionsProcessed: results.length,
      totalActivitiesCreated: totalActivities,
      results,
    });
  } catch (err) {
    console.error("[gmail-manual-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
