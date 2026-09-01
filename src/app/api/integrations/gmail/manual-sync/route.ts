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
import { runWithSupabase } from "@/lib/supabase/helpers";
import { SyncEngine } from "@/lib/api/services/sync-engine";
import {
  EMAIL_SYNC_DEADLINE_SAFETY_MARGIN_MS,
  EMAIL_SYNC_MAX_RUNTIME_MS,
  EMAIL_SYNC_MIN_CONNECTION_BUDGET_MS,
  createInvocationDeadline,
} from "@/lib/api/services/invocation-deadline";
import { getSubscriptionInfo } from "@/lib/subscription";
import {
  SubscriptionPlan,
  SubscriptionStatus,
  type Company,
} from "@/lib/types/models";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  return runWithSupabase(supabase, async () => {
    try {
      const body = await request.json();
      const companyId = body.companyId as string | undefined;

      if (!companyId) {
        return NextResponse.json(
          { error: "companyId is required" },
          { status: 400 }
        );
      }
      const access = await resolveEmailConnectionOperationAccess({
        request,
        claimedCompanyId: companyId,
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
      const activeConnectionIds = access.connections
        .filter((connection) => connection.status === "active")
        .map((connection) => connection.id);
      if (activeConnectionIds.length === 0) {
        return NextResponse.json({
          ok: true,
          state: "complete",
          retryable: false,
          connectionsProcessed: 0,
          failedConnections: 0,
          pendingConnections: 0,
          totalActivitiesCreated: 0,
          results: [],
        });
      }

      const { data: connections, error: connectionsError } = await supabase
        .from("email_connections")
        .select("id, email")
        .in("id", activeConnectionIds)
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
        continuationPending: boolean;
        deadlineDeferred?: boolean;
        error?: string;
      }> = [];

      // Same 300s platform kill as the cron path, so the same budget applies:
      // a deadline-stopped cycle is reported as continuing, never complete
      // (bug 63ff8830).
      const deadline = createInvocationDeadline({
        maxRuntimeMs: EMAIL_SYNC_MAX_RUNTIME_MS,
        safetyMarginMs: EMAIL_SYNC_DEADLINE_SAFETY_MARGIN_MS,
      });

      for (const conn of connections ?? []) {
        if (deadline.expired(EMAIL_SYNC_MIN_CONNECTION_BUDGET_MS)) {
          // Left completely untouched — no cursor moved, no provider call.
          results.push({
            connectionId: conn.id as string,
            email: conn.email as string,
            activitiesCreated: 0,
            matched: 0,
            needsReview: 0,
            newLeads: 0,
            continuationPending: true,
            deadlineDeferred: true,
          });
          continue;
        }
        try {
          const result = await SyncEngine.runSync(conn.id as string, {
            deadline,
          });
          results.push({
            connectionId: conn.id as string,
            email: conn.email as string,
            activitiesCreated: result.activitiesCreated,
            matched: result.matched,
            needsReview: result.needsReview,
            newLeads: result.newLeads,
            continuationPending:
              result.continuationPending || result.deadlineDeferred,
            ...(result.deadlineDeferred ? { deadlineDeferred: true } : {}),
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
            continuationPending: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      const totalActivities = results.reduce(
        (s, r) => s + r.activitiesCreated,
        0
      );
      const failedConnections = results.filter(
        (result) => result.error !== undefined
      ).length;
      const pendingConnections = results.filter(
        (result) => result.continuationPending
      ).length;
      const state =
        failedConnections > 0
          ? failedConnections === results.length
            ? "failed"
            : "partial"
          : pendingConnections > 0
            ? "continuing"
            : "complete";

      return NextResponse.json(
        {
          ok: failedConnections === 0,
          state,
          retryable: failedConnections > 0,
          connectionsProcessed: results.length,
          failedConnections,
          pendingConnections,
          totalActivitiesCreated: totalActivities,
          results,
        },
        {
          status:
            failedConnections > 0 ? 503 : pendingConnections > 0 ? 202 : 200,
        }
      );
    } catch (err) {
      console.error("[gmail-manual-sync]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Internal error" },
        { status: 500 }
      );
    }
  });
}
