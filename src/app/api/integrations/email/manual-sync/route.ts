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
import {
  SubscriptionPlan,
  SubscriptionStatus,
  type Company,
} from "@/lib/types/models";
import { requireEmailPipelineSecret } from "@/lib/email/email-route-auth";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";

export const maxDuration = 300;

type CompanySubscriptionFields = Pick<
  Company,
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "trialEndDate"
  | "seatedEmployeeIds"
  | "adminIds"
  | "maxSeats"
>;

/** Minimal snake_case → camelCase mapper for subscription gating. */
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
    const { connectionId, companyId, source } = body;
    const isInternalCaller = source === "webhook" || source === "system";

    if (isInternalCaller) {
      const authError = requireEmailPipelineSecret(request);
      if (authError) return authError;
    }

    if (!connectionId && !companyId) {
      return NextResponse.json(
        { error: "connectionId or companyId required" },
        { status: 400 }
      );
    }

    // ── Resolve companyId for subscription check ─────────────────────────
    let resolvedCompanyId = companyId as string | undefined;
    if (connectionId) {
      const { data: conn, error: connectionError } = await supabase
        .from("email_connections")
        .select("company_id")
        .eq("id", connectionId)
        .single();
      if (connectionError || !conn) {
        return NextResponse.json(
          { error: "Connection not found" },
          { status: 404 }
        );
      }
      const connectionCompanyId = conn.company_id as string;
      if (resolvedCompanyId && resolvedCompanyId !== connectionCompanyId) {
        return NextResponse.json(
          { error: "Connection not found" },
          { status: 404 }
        );
      }
      resolvedCompanyId = connectionCompanyId;
    }

    // ── Subscription gate ────────────────────────────────────────────────
    // Webhook callers (source="webhook") pass CRON_SECRET in the body to
    // bypass this check (the cron already gates on subscription).
    // All other callers must have an active subscription.
    let browserConnectionIds: string[] | null = null;
    if (!isInternalCaller) {
      const access = await resolveEmailConnectionOperationAccess({
        request,
        claimedCompanyId: resolvedCompanyId,
        connectionId:
          typeof connectionId === "string" ? connectionId : undefined,
        requireUsable: true,
        supabase,
      });
      if (!access.allowed) {
        return NextResponse.json(
          {
            error:
              access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
          },
          { status: access.status }
        );
      }
      resolvedCompanyId = access.actor.companyId;
      browserConnectionIds = access.connectionIds;
    }

    if (!isInternalCaller && resolvedCompanyId) {
      const { data: company, error: companyError } = await supabase
        .from("companies")
        .select(
          "subscription_plan, subscription_status, trial_end_date, seated_employee_ids, admin_ids, max_seats"
        )
        .eq("id", resolvedCompanyId)
        .single();

      if (companyError || !company) {
        // Fail closed — don't let a broken lookup bypass the subscription gate.
        console.error(
          "[email-manual-sync] company subscription lookup failed:",
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
          { status: 403 }
        );
      }
    }

    // ── Resolve connections to sync ──────────────────────────────────────
    let connectionIds: string[] = [];

    if (browserConnectionIds) {
      connectionIds = browserConnectionIds;
    } else if (connectionId) {
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
