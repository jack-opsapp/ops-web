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
import { runWithSupabase } from "@/lib/supabase/helpers";
import { SyncEngine } from "@/lib/api/services/sync-engine";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { EmailOutboundLearningService } from "@/lib/api/services/email-outbound-learning-service";
import {
  buildEmailSyncCronResult,
  type EmailSyncCronResult,
} from "@/lib/email/email-sync-cron-result";
import { getSubscriptionInfo } from "@/lib/subscription";
import {
  SubscriptionPlan,
  SubscriptionStatus,
  type Company,
} from "@/lib/types/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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

  return runWithSupabase(supabase, async () => {
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

      const { data: companies, error: companiesError } = await supabase
        .from("companies")
        .select(
          "id, subscription_plan, subscription_status, trial_end_date, seated_employee_ids, admin_ids, max_seats"
        )
        .in("id", companyIds);

      if (companiesError) {
        // Fail closed — don't silently skip every connection when the gate query breaks.
        console.error(
          "[email-cron-sync] company subscription lookup failed:",
          companiesError
        );
        throw new Error(
          `Company subscription lookup failed: ${companiesError.message}`
        );
      }

      const activeCompanyIds = new Set(
        (companies ?? [])
          .filter((c) => {
            const info = getSubscriptionInfo(mapSubscriptionRow(c));
            return info.isActive;
          })
          .map((c) => c.id as string)
      );

      const now = Date.now();
      const results: Array<EmailSyncCronResult & { error?: string }> = [];
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
          results.push(
            buildEmailSyncCronResult(
              {
                id: conn.id as string,
                email: conn.email as string,
                provider: conn.provider as string,
              },
              result
            )
          );
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
      let staleSweepError: string | null = null;
      try {
        staleSweepChanges = await SyncEngine.sweepStaleLeads();
      } catch (sweepErr) {
        console.error("[email-cron-sync] stale sweep error:", sweepErr);
        staleSweepError =
          sweepErr instanceof Error
            ? sweepErr.message
            : "Unknown stale sweep error";
      }

      // New messages clear category_classified_at before their background
      // classifier runs. Retry a small durable batch every sync cycle so a
      // serverless interruption or transient model/database failure cannot leave
      // thread summaries stale indefinitely.
      let threadClassificationRetry = {
        scanned: 0,
        classified: 0,
        errors: 0,
      };
      let threadClassificationRetryError: string | null = null;
      try {
        threadClassificationRetry =
          await EmailThreadService.retryDirtyClassifications({
            companyIds: [...activeCompanyIds],
            limit: 10,
            concurrency: 2,
          });
      } catch (retryError) {
        console.error(
          "[email-cron-sync] thread classification retry error:",
          retryError
        );
        threadClassificationRetryError =
          retryError instanceof Error
            ? retryError.message
            : "Unknown thread classification retry error";
      }

      // Drain the deferred lead-classification queue. Threads whose Step-5
      // classification was skipped during a provider outage carry
      // `email_threads.lead_scan_pending_at`; replay them now that the AI
      // provider may have recovered. Its own try/catch — a drain failure never
      // fails the whole cron cycle.
      let pendingLeadScanSweep: {
        scanned: number;
        promoted: number;
        cleared: number;
        errors: string[];
      } = { scanned: 0, promoted: 0, cleared: 0, errors: [] };
      let pendingLeadScanSweepError: string | null = null;
      try {
        pendingLeadScanSweep = await SyncEngine.retryPendingLeadScans({
          limit: 50,
        });
      } catch (sweepErr) {
        console.error(
          "[email-cron-sync] pending lead-scan sweep error:",
          sweepErr
        );
        pendingLeadScanSweepError =
          sweepErr instanceof Error
            ? sweepErr.message
            : "Unknown pending lead-scan sweep error";
      }

      // Drain a small durable outbound-learning batch after mailbox sync. Model
      // work never runs on the irreversible send route; the worker persists its
      // prepared payload, then one database transaction applies evidence
      // receipts, profile/memory effects, draft outcomes, and job completion.
      let outboundLearning = {
        claimed: 0,
        prepared: 0,
        completed: 0,
        deferred: 0,
        retrying: 0,
        bookkeepingFailed: 0,
        terminalFailed: 0,
        failed: 0,
        errors: [] as Array<{
          jobId: string;
          providerMessageId: string;
          error: string;
        }>,
      };
      let outboundLearningError: string | null = null;
      try {
        outboundLearning = await new EmailOutboundLearningService(
          supabase
        ).runWorker({ limit: 10, concurrency: 2, leaseSeconds: 900 });
      } catch (learningError) {
        console.error(
          "[email-cron-sync] outbound learning worker error:",
          learningError
        );
        outboundLearningError =
          learningError instanceof Error
            ? learningError.message
            : "Unknown outbound learning worker error";
      }

      const failedConnections = results.filter(
        (result) => Boolean(result.error) || Boolean(result.errors?.length)
      ).length;
      const failed =
        failedConnections +
        (staleSweepError ? 1 : 0) +
        (threadClassificationRetry.errors > 0 || threadClassificationRetryError
          ? 1
          : 0) +
        (pendingLeadScanSweep.errors.length > 0 || pendingLeadScanSweepError
          ? 1
          : 0) +
        (outboundLearning.terminalFailed > 0 ||
        outboundLearning.bookkeepingFailed > 0 ||
        outboundLearningError
          ? 1
          : 0);

      return NextResponse.json(
        {
          ok: failed === 0,
          synced: results.length,
          failed,
          failedConnections,
          skippedInactive,
          staleSweepChanges,
          staleSweepError,
          threadClassificationRetry,
          threadClassificationRetryError,
          pendingLeadScanSweep,
          pendingLeadScanSweepError,
          outboundLearning,
          outboundLearningError,
          results,
        },
        { status: failed === 0 ? 200 : 503 }
      );
    } catch (err) {
      console.error("[email-cron-sync]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Sync failed" },
        { status: 500 }
      );
    }
  });
}
