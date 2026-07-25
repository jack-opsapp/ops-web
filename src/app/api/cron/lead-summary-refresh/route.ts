// src/app/api/cron/lead-summary-refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  LEAD_SUMMARY_SCHEDULED_MODEL_CALL_LIMIT,
  LEAD_SUMMARY_SCHEDULED_OPPORTUNITY_LIMIT,
  runLeadSummaryRefresh,
  type LeadSummaryRunResult,
} from "@/lib/api/services/lead-summary-service";
import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
} from "@/lib/api/services/cron-workload-cursor-service";
import { listBoundedPhaseCCompanyIds } from "@/lib/api/services/cron-company-fanout-service";
import { runWithCronWorkloadControl } from "@/lib/api/services/cron-workload-control-service";
import {
  decodeLeadSummaryRefreshCursor,
  encodeLeadSummaryRefreshCursor,
} from "@/lib/email/lead-summary-refresh-cursor";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKLOAD_KEY = "lead-summary-refresh";

function emptyScheduledResult(): LeadSummaryRunResult {
  return {
    mode: "refresh",
    dryRun: false,
    companiesConsidered: 0,
    companiesEnabled: 0,
    leadsScanned: 0,
    candidates: 0,
    summariesWritten: 0,
    modelCalls: 0,
    modelCallLimitReached: false,
    skippedInsufficientContext: 0,
    failed: [],
    written: [],
    candidatesPreview: [],
    opportunityWindow: null,
  };
}

async function nextPhaseCCompanyId(
  supabase: Parameters<typeof listBoundedPhaseCCompanyIds>[0],
  afterCompanyId: string | null
): Promise<string | null> {
  const after = await listBoundedPhaseCCompanyIds(
    supabase,
    1,
    afterCompanyId
  );
  if (after[0]) return after[0];
  if (afterCompanyId === null) return null;
  const wrapped = await listBoundedPhaseCCompanyIds(supabase, 1, null);
  return wrapped[0] ?? null;
}

/**
 * Lead AI summary coverage — the activity-driven counterpart to the email
 * sync engine's summary writer (see lead-summary-service module doc).
 *
 * GET  — Vercel cron, hourly at :18 inside the email-sync operating window
 *        (`18 13-23,0-4 * * *`). Refreshes open-lead summaries whose
 *        activities / stage transitions / site visits are newer than
 *        ai_summary_updated_at. It never creates first summaries for untouched
 *        historical leads; those become eligible only after a new durable
 *        event reaches the targeted ingestion writer.
 *
 *        MASTER SWITCH: `LEAD_SUMMARY_REFRESH_ENABLED`. Unset or any value
 *        other than "true" → the cron no-ops immediately after auth (the
 *        launch default; recurring LLM spend requires an explicit opt-in —
 *        mirrors INBOX_AUTO_SEND_ENABLED).
 *
 * POST — intentionally unavailable. Historical bulk backfill is outside the
 *        forward-only ingestion contract.
 *
 * GET: Bearer CRON_SECRET (mirrors every other OPS cron). Per-company
 * phase_c gating is enforced inside the service, identical to the shipped
 * engine. Writes are ai_summary + ai_summary_updated_at only.
 */

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function missingSecret(): NextResponse {
  return NextResponse.json(
    { error: "CRON_SECRET not configured" },
    { status: 500 }
  );
}

function isAuthorized(request: NextRequest, cronSecret: string): boolean {
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return missingSecret();
  if (!isAuthorized(request, cronSecret)) return unauthorized();

  if (process.env.LEAD_SUMMARY_REFRESH_ENABLED !== "true") {
    console.log(
      "[cron/lead-summary-refresh] skipped — recurring refresh disabled (LEAD_SUMMARY_REFRESH_ENABLED!=true)"
    );
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "lead_summary_refresh_disabled",
    });
  }

  const supabase = getServiceRoleClient();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: 360,
      work: async (lease) => {
        const expectedCursor = await readCronWorkloadCursor(
          supabase,
          WORKLOAD_KEY,
          lease
        );
        const previous = decodeLeadSummaryRefreshCursor(expectedCursor);
        const companyId =
          previous?.companyId ??
          (await nextPhaseCCompanyId(
            supabase as Parameters<typeof listBoundedPhaseCCompanyIds>[0],
            null
          ));

        if (!companyId) {
          await advanceCronWorkloadCursor(
            supabase,
            WORKLOAD_KEY,
            lease,
            expectedCursor,
            null
          );
          return {
            ...emptyScheduledResult(),
            cursor: { previous: expectedCursor, next: null },
          };
        }

        const result = await runLeadSummaryRefresh({
          supabase,
          mode: "refresh",
          companyId,
          opportunityAfterId: previous?.afterOpportunityId ?? null,
          opportunityLimit: LEAD_SUMMARY_SCHEDULED_OPPORTUNITY_LIMIT,
          maxLeadsPerRun: LEAD_SUMMARY_SCHEDULED_MODEL_CALL_LIMIT,
          modelCallLimit: LEAD_SUMMARY_SCHEDULED_MODEL_CALL_LIMIT,
        });

        let next: string | null;
        if (
          result.companiesEnabled > 0 &&
          result.opportunityWindow?.full &&
          result.opportunityWindow.lastOpportunityId
        ) {
          next = encodeLeadSummaryRefreshCursor({
            companyId,
            afterOpportunityId:
              result.opportunityWindow.lastOpportunityId,
          });
        } else {
          const nextCompanyId = await nextPhaseCCompanyId(
            supabase as Parameters<
              typeof listBoundedPhaseCCompanyIds
            >[0],
            companyId
          );
          next = nextCompanyId
            ? encodeLeadSummaryRefreshCursor({
                companyId: nextCompanyId,
                afterOpportunityId: null,
              })
            : null;
        }

        await advanceCronWorkloadCursor(
          supabase,
          WORKLOAD_KEY,
          lease,
          expectedCursor,
          next
        );
        return {
          ...result,
          cursor: { previous: expectedCursor, next },
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

    const result = controlled.value;
    console.log(
      "[cron/lead-summary-refresh]",
      JSON.stringify({
        mode: result.mode,
        companiesConsidered: result.companiesConsidered,
        companiesEnabled: result.companiesEnabled,
        leadsScanned: result.leadsScanned,
        candidates: result.candidates,
        summariesWritten: result.summariesWritten,
        modelCalls: result.modelCalls,
        modelCallLimitReached: result.modelCallLimitReached,
        skippedInsufficientContext: result.skippedInsufficientContext,
        failedCount: result.failed.length,
        failed: result.failed,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/lead-summary-refresh]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json(
    { ok: false, error: "Historical lead-summary backfill is disabled" },
    { status: 405, headers: { Allow: "GET" } }
  );
}
