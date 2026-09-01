// src/app/api/cron/lead-summary-refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  LEAD_SUMMARY_SCHEDULED_MODEL_CALL_LIMIT,
  LEAD_SUMMARY_SCHEDULED_OPPORTUNITY_LIMIT,
  refreshLeadSummariesForOpportunities,
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

/** How many queue rows one tick inspects before picking its batch. */
const QUEUE_SCAN_LIMIT = 25;

/**
 * The debounce window. A lead is only drained once it has been quiet for this
 * long, so a burst of writes collapses into a single refresh.
 */
const QUEUE_QUIET_PERIOD_MS = 120_000;

interface LeadSummaryQueueDrainResult {
  scanned: number;
  attempted: number;
  written: number;
  drained: number;
  failed: number;
  deferred: number;
}

function emptyQueueDrainResult(): LeadSummaryQueueDrainResult {
  return {
    scanned: 0,
    attempted: 0,
    written: 0,
    drained: 0,
    failed: 0,
    deferred: 0,
  };
}

/**
 * Drain the durable refresh queue (bug a2042514).
 *
 * The web app calls the eager endpoint directly, but iOS and any other
 * PostgREST writer only reach this path — a database trigger enqueues on every
 * non-email activity and project note, and this drains it. Runs BEFORE the
 * rotation sweep and shares its model-call budget: a lead someone just touched
 * matters more than the next lead in a round-robin.
 *
 * Rows for summaries that were written (or whose company has the feature off)
 * are deleted. Failed and deferred rows stay, `requested_at` untouched, so the
 * next tick retries them.
 */
async function drainLeadSummaryRefreshQueue(
  supabase: ReturnType<typeof getServiceRoleClient>,
  budget: number
): Promise<LeadSummaryQueueDrainResult> {
  const drain = emptyQueueDrainResult();
  if (budget <= 0) return drain;

  const cutoff = new Date(Date.now() - QUEUE_QUIET_PERIOD_MS).toISOString();
  const { data: rows, error } = await supabase
    .from("lead_summary_refresh_requests")
    .select("opportunity_id, company_id")
    .lte("requested_at", cutoff)
    .order("requested_at", { ascending: true })
    .limit(QUEUE_SCAN_LIMIT);
  if (error) {
    console.error("[cron/lead-summary-refresh] queue read failed", error);
    return drain;
  }

  const queued = (rows ?? []) as Array<{
    opportunity_id: string;
    company_id: string;
  }>;
  drain.scanned = queued.length;
  if (queued.length === 0) return drain;

  // Oldest-first, capped at the shared budget; the rest wait for the next tick.
  const byCompany = new Map<string, string[]>();
  let taken = 0;
  for (const row of queued) {
    if (taken >= budget) break;
    if (!row.opportunity_id || !row.company_id) continue;
    const ids = byCompany.get(row.company_id) ?? [];
    ids.push(row.opportunity_id);
    byCompany.set(row.company_id, ids);
    taken += 1;
  }

  for (const [companyId, opportunityIds] of byCompany) {
    const result = await refreshLeadSummariesForOpportunities({
      supabase,
      companyId,
      opportunityIds,
    });
    drain.attempted += result.attempted;
    drain.written += result.written;
    drain.failed += result.failed.length;
    drain.deferred += result.deferred.length;

    // A feature-disabled company will never produce a summary — clear its rows
    // rather than retrying them forever.
    const unfinished = new Set(result.remainingOpportunityIds);
    const settled = result.skippedFeatureDisabled
      ? opportunityIds
      : opportunityIds.filter((id) => !unfinished.has(id));
    if (settled.length === 0) continue;

    const { error: deleteError } = await supabase
      .from("lead_summary_refresh_requests")
      .delete()
      .eq("company_id", companyId)
      .in("opportunity_id", settled);
    if (deleteError) {
      console.error(
        "[cron/lead-summary-refresh] queue cleanup failed",
        deleteError
      );
      continue;
    }
    drain.drained += settled.length;
  }

  return drain;
}

class LeadSummaryRefreshRunError extends Error {
  readonly failed: LeadSummaryRunResult["failed"];

  constructor(failed: LeadSummaryRunResult["failed"]) {
    super(
      `Lead summary refresh failed for ${failed.length} opportunit${
        failed.length === 1 ? "y" : "ies"
      }`
    );
    this.name = "LeadSummaryRefreshRunError";
    this.failed = failed;
  }
}

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
    deferred: [],
    written: [],
    candidatesPreview: [],
    quarantined: [],
    quarantinedCount: 0,
    opportunityWindow: null,
  };
}

async function nextPhaseCCompanyId(
  supabase: Parameters<typeof listBoundedPhaseCCompanyIds>[0],
  afterCompanyId: string | null
): Promise<string | null> {
  const after = await listBoundedPhaseCCompanyIds(supabase, 1, afterCompanyId);
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
        // Freshly-touched leads first — they share the run's model-call budget
        // with the round-robin rotation below.
        const queue = await drainLeadSummaryRefreshQueue(
          supabase,
          LEAD_SUMMARY_SCHEDULED_MODEL_CALL_LIMIT
        );
        const rotationBudget = Math.max(
          0,
          LEAD_SUMMARY_SCHEDULED_MODEL_CALL_LIMIT - queue.attempted
        );

        const expectedCursor = await readCronWorkloadCursor(
          supabase,
          WORKLOAD_KEY,
          lease
        );

        if (rotationBudget === 0) {
          // The queue spent the budget. Hold the rotation cursor exactly where
          // it is so the next tick resumes the sweep without skipping anyone.
          await advanceCronWorkloadCursor(
            supabase,
            WORKLOAD_KEY,
            lease,
            expectedCursor,
            expectedCursor
          );
          return {
            ...emptyScheduledResult(),
            queue,
            cursor: { previous: expectedCursor, next: expectedCursor },
          };
        }

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
            queue,
            cursor: { previous: expectedCursor, next: null },
          };
        }

        const result = await runLeadSummaryRefresh({
          supabase,
          mode: "refresh",
          companyId,
          opportunityAfterId: previous?.afterOpportunityId ?? null,
          opportunityLimit: LEAD_SUMMARY_SCHEDULED_OPPORTUNITY_LIMIT,
          maxLeadsPerRun: rotationBudget,
          modelCallLimit: rotationBudget,
        });

        // Persistence/provenance failures must fail the fenced workload and
        // hold its cursor. Advancing here would permanently hide stale rows
        // behind an HTTP 200 even though the derived state never converged.
        if (result.failed.length > 0) {
          throw new LeadSummaryRefreshRunError(result.failed);
        }

        let next: string | null;
        if (
          result.companiesEnabled > 0 &&
          result.opportunityWindow?.full &&
          result.opportunityWindow.lastOpportunityId
        ) {
          next = encodeLeadSummaryRefreshCursor({
            companyId,
            afterOpportunityId: result.opportunityWindow.lastOpportunityId,
          });
        } else {
          const nextCompanyId = await nextPhaseCCompanyId(
            supabase as Parameters<typeof listBoundedPhaseCCompanyIds>[0],
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
          queue,
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
        deferredCount: result.deferred.length,
        deferred: result.deferred,
        queue: result.queue,
        // Non-convergence is surfaced explicitly, not inferred from a missing
        // write. HTTP stays 200: a per-lead data issue is not a workload
        // failure and must not trip the circuit.
        quarantinedCount: result.quarantinedCount,
        quarantined: result.quarantined,
      })
    );
    return NextResponse.json({ ok: result.deferred.length === 0, ...result });
  } catch (err) {
    if (err instanceof LeadSummaryRefreshRunError) {
      console.error("[cron/lead-summary-refresh]", err.message, err.failed);
      return NextResponse.json(
        { ok: false, error: err.message, failed: err.failed },
        { status: 500 }
      );
    }
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
