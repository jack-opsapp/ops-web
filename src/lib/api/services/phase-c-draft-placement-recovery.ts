/**
 * OPS Web — Stranded Phase C mailbox draft recovery
 *
 * When `placePhaseCMailboxDraft` fails, `doAutoDraft` returns
 * `draft_placement_pending` and leaves the ai_draft_history row at
 * status='drafted' with a null mailbox_draft_id. The draft exists in OPS; the
 * operator's Drafts folder does not have it.
 *
 * Nothing retried those rows. The router is the only thing that places drafts,
 * and it runs on classification — which only happens when new inbound mail
 * lands on that same thread. A customer who does not write again strands the
 * draft permanently, which is precisely how two same-day defects became a
 * five-day outage: six real drafts had to be placed by hand on 2026-08-06.
 *
 * This sweep runs per connection on the sync cron whether or not any mail
 * arrived, so recovery no longer depends on the customer doing anything. It is
 * bounded at both ends — candidate rows, then distinct threads — and every
 * decision about whether placement is still appropriate belongs to the router,
 * which re-checks terminal sync, the mailbox lease, the current autonomy level,
 * and live actor authorization exactly as the classification path does.
 *
 * Never throws. A sync must never fail because recovery could not run.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapEmailThreadFromDb } from "@/lib/types/email-thread";
import { PhaseCAutonomyRouter } from "./phase-c-autonomy-router";

/**
 * How far back a stranded draft stays worth placing. Past this the
 * conversation has moved on and a stale reply would read worse than none; the
 * row is left for the operator's own judgement.
 */
export const PHASE_C_PLACEMENT_RECOVERY_WINDOW_DAYS = 7;
/** Rows read before collapsing to distinct threads. */
export const PHASE_C_PLACEMENT_RECOVERY_CANDIDATE_LIMIT = 200;
/** Threads driven through placement per connection per cycle. */
export const PHASE_C_PLACEMENT_RECOVERY_THREAD_LIMIT = 10;
/** Wall-clock ceiling, so a slow mailbox cannot eat the cron invocation. */
export const PHASE_C_PLACEMENT_RECOVERY_DEADLINE_MS = 2 * 60 * 1000;
/** Rows terminalized per cycle once they age past the placement window. */
export const PHASE_C_PLACEMENT_AGE_OUT_LIMIT = 50;

export interface StrandedDraftRecoverySummary {
  /** Distinct threads driven through placement. */
  scanned: number;
  /** Drafts that reached the mailbox this cycle. */
  placed: number;
  /** A fence declined — stale thread, autonomy off, sync mid-catch-up. */
  skipped: number;
  /** Placement is still outstanding; the next cycle retries. */
  failed: number;
  /** Rows terminalized because they aged past the placement window. */
  agedOut: number;
}

const EMAIL_THREAD_COLUMNS = "*";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Re-drive mailbox placement for every thread holding a stranded Phase C draft.
 *
 * Runs outside the mailbox lease, exactly like the classification path that
 * normally performs this work — the router takes the lease itself around the
 * provider mutation, and its pre-flight sync-terminal check has to be able to
 * see a foreign sync in order to stand down for it.
 */
export async function recoverStrandedPhaseCMailboxDraftsForConnection(input: {
  companyId: string;
  connectionId: string;
  supabase: SupabaseClient;
}): Promise<StrandedDraftRecoverySummary> {
  const summary: StrandedDraftRecoverySummary = {
    scanned: 0,
    placed: 0,
    skipped: 0,
    failed: 0,
    agedOut: 0,
  };

  try {
    const cutoff = new Date(
      Date.now() - PHASE_C_PLACEMENT_RECOVERY_WINDOW_DAYS * 86_400_000
    ).toISOString();

    // `thread_id is not null` is the ownership boundary, not a convenience: the
    // contact-form draft worker writes origin='phase_c' rows too, its drafts
    // open a NEW conversation and therefore carry no thread, and its own
    // durable queue retries them. Two owners on one placement is a bug.
    const { data: candidates, error: candidateError } = await input.supabase
      .from("ai_draft_history")
      .select("thread_id")
      .eq("company_id", input.companyId)
      .eq("connection_id", input.connectionId)
      .eq("origin", "phase_c")
      .eq("status", "drafted")
      .is("mailbox_draft_id", null)
      .not("thread_id", "is", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(PHASE_C_PLACEMENT_RECOVERY_CANDIDATE_LIMIT);
    if (candidateError) throw candidateError;

    // The window is a scan bound, so anything older left the scan set forever
    // while still sitting at status='drafted' — five real rows from 2026-08-05
    // and 08-06 were invisible to this sweep permanently. They cannot simply be
    // placed: a three-week-old automatic reply reads worse than no reply. So
    // they are terminalized here instead, which is a disposition the operator
    // can see rather than a row waiting on a sweep that will never look at it.
    //
    // Scoped exactly like the placement scan above, `thread_id is not null`
    // included: the contact-form draft worker also writes origin='phase_c'
    // rows, its drafts open a new conversation and carry no thread, and its own
    // durable queue owns their lifecycle.
    try {
      const { data: agedRows, error: agedError } = await input.supabase
        .from("ai_draft_history")
        .select("id, created_at")
        .eq("company_id", input.companyId)
        .eq("connection_id", input.connectionId)
        .eq("origin", "phase_c")
        .eq("status", "drafted")
        .is("mailbox_draft_id", null)
        .not("thread_id", "is", null)
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(PHASE_C_PLACEMENT_AGE_OUT_LIMIT);
      if (agedError) throw agedError;

      for (const agedRow of (agedRows ?? []) as Array<Record<string, unknown>>) {
        const agedId = text(agedRow.id);
        if (!agedId) continue;
        const { error: supersedeError } = await input.supabase
          .from("ai_draft_history")
          .update({
            status: "superseded",
            discarded_at: new Date().toISOString(),
          })
          .eq("id", agedId);
        if (supersedeError) {
          summary.failed += 1;
          console.warn(
            `[phase-c-placement-recovery] age-out write failed for draft ${agedId}`,
            supersedeError
          );
          continue;
        }
        summary.agedOut += 1;
        console.warn(
          `[phase-c-placement-recovery] aged out stranded draft ${agedId} created ${
            text(agedRow.created_at) ?? "unknown"
          }`
        );
      }
    } catch (ageOutFailure) {
      // Age-out is bookkeeping. Placement retry is the sweep's actual job, so a
      // failure here must not cost the connection its retry cycle.
      summary.failed += 1;
      console.warn(
        `[phase-c-placement-recovery] age-out pass failed for connection ${input.connectionId}`,
        ageOutFailure
      );
    }

    // Several stranded rows can share a thread — one per inbound message the
    // customer sent. Placement is decided per thread by the router, which picks
    // the row covering the latest inbound, so visiting a thread once is enough.
    const providerThreadIds = Array.from(
      new Set(
        ((candidates ?? []) as Array<Record<string, unknown>>)
          .map((row) => text(row.thread_id))
          .filter((value): value is string => Boolean(value))
      )
    ).slice(0, PHASE_C_PLACEMENT_RECOVERY_THREAD_LIMIT);
    // Cheap first: a healthy connection stops here, having read one index.
    if (providerThreadIds.length === 0) return summary;

    const { data: threadRows, error: threadError } = await input.supabase
      .from("email_threads")
      .select(EMAIL_THREAD_COLUMNS)
      .eq("company_id", input.companyId)
      .eq("connection_id", input.connectionId)
      .in("provider_thread_id", providerThreadIds)
      .limit(PHASE_C_PLACEMENT_RECOVERY_THREAD_LIMIT);
    if (threadError) throw threadError;

    const deadlineAt = Date.now() + PHASE_C_PLACEMENT_RECOVERY_DEADLINE_MS;
    // The bound is enforced here, not merely requested of the query: this loop
    // performs provider work, so how much of it runs must be a property of the
    // code rather than of what the database chose to return.
    const scope = ((threadRows ?? []) as Array<Record<string, unknown>>).slice(
      0,
      PHASE_C_PLACEMENT_RECOVERY_THREAD_LIMIT
    );
    for (const row of scope) {
      if (Date.now() >= deadlineAt) {
        console.warn(
          `[phase-c-placement-recovery] deadline reached for connection ${input.connectionId}; remaining threads retry next cycle`
        );
        break;
      }
      summary.scanned += 1;
      try {
        const result = await PhaseCAutonomyRouter.retryStrandedMailboxDraft(
          mapEmailThreadFromDb(row)
        );
        if (result.outcome === "auto_drafted") {
          summary.placed += 1;
        } else if (
          result.outcome === "draft_placement_pending" ||
          result.outcome === "error"
        ) {
          // Still unplaced. Counted as outstanding so the cron result reports
          // it, and retried on the next cycle rather than written off.
          summary.failed += 1;
        } else {
          // Every noop_* outcome is a fence doing its job, not a failure.
          summary.skipped += 1;
        }
      } catch (threadFailure) {
        summary.failed += 1;
        console.warn(
          `[phase-c-placement-recovery] placement retry threw for thread ${text(row.id) ?? "unknown"}`,
          threadFailure
        );
      }
    }

    return summary;
  } catch (error) {
    summary.failed += 1;
    console.warn(
      `[phase-c-placement-recovery] sweep failed for connection ${input.connectionId}`,
      error
    );
    return summary;
  }
}
