/**
 * OPS Web - Phase C Pipeline Route Helpers
 *
 * Shared orchestration helpers for the chunked Phase C pipeline. Used by both
 * /api/integrations/email/analyze-memory (entry route) and
 * /api/integrations/email/analyze-memory-continue (continuation route).
 *
 * Keeps MemoryService pure (just the memory/entity/profile API) while these
 * helpers handle job-row state persistence, continuation dispatch, and the
 * final user-facing notification.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryService, type PhaseCPipelineState } from "./memory-service";
import { getAppUrl } from "@/lib/utils/app-url";

// Lease duration for the Phase C row-level execution lock. Chosen slightly
// longer than the route's 800s maxDuration so that a hard crash between the
// final runPhaseCChunks yield and the outer finally() can't block a retry
// for much more than a single invocation lifetime. Must match the default in
// migration 070_phase_c_row_lock.sql.
const PHASE_C_LOCK_LEASE_SECONDS = 900;

/**
 * Persist the current pipeline state into gmail_scan_jobs.result.phaseCPipeline
 * without disturbing any other fields in result. Used as the persistState
 * callback for MemoryService.runPhaseCChunks.
 *
 * Race note: this overwrites the entire result object with a re-serialized
 * copy. Phase C is the only writer to result once Phase B has saved its final
 * leads, so there's no other concurrent mutator to clobber.
 */
export async function buildPersistStateFn(
  supabase: SupabaseClient,
  jobId: string,
): Promise<(state: PhaseCPipelineState) => Promise<void>> {
  return async (state: PhaseCPipelineState) => {
    const { data: row } = await supabase
      .from("gmail_scan_jobs")
      .select("result")
      .eq("id", jobId)
      .single();

    const currentResult = (row?.result as Record<string, unknown>) || {};
    await supabase
      .from("gmail_scan_jobs")
      .update({
        result: {
          ...currentResult,
          phaseCPipeline: state,
        },
      })
      .eq("id", jobId);
  };
}

/**
 * Try to acquire the Phase C execution lock for a scan job. Returns the
 * holder id on success, null on contention (another runner already holds an
 * unexpired lock). The holder id is stage-prefixed so log grepping can tell
 * which invocation last acquired it.
 *
 * Callers MUST release the lock — either via releasePhaseCLock (normal path
 * before dispatching a continuation) or implicitly via lease expiry (crash
 * path). See migration 070_phase_c_row_lock.sql for atomicity details.
 */
export async function acquirePhaseCLock(
  supabase: SupabaseClient,
  jobId: string,
  stageLabel: "entry" | "continuation",
): Promise<string | null> {
  const holderId = `${stageLabel}:${randomUUID()}`;
  const { data, error } = await supabase.rpc("acquire_phase_c_lock", {
    p_job_id: jobId,
    p_holder: holderId,
    p_lease_seconds: PHASE_C_LOCK_LEASE_SECONDS,
  });
  if (error) {
    console.error(`[phase-c] acquirePhaseCLock RPC error for job ${jobId}:`, error);
    return null;
  }
  return data === true ? holderId : null;
}

/**
 * Release the Phase C execution lock. Fenced — the UPDATE in the RPC only
 * clears the row if holderId still matches, so concurrent callers can't
 * stomp on each other's lock state. Idempotent: safe to call from both the
 * inner dispatch path (release-before-continuation-dispatch) and the outer
 * finally() (crash safety net).
 *
 * Errors are logged but not thrown. A failed release means the lock will sit
 * until lease expiry (~900s), which is an acceptable degradation — it just
 * delays the next retry attempt.
 */
export async function releasePhaseCLock(
  supabase: SupabaseClient,
  jobId: string,
  holderId: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_phase_c_lock", {
    p_job_id: jobId,
    p_holder: holderId,
  });
  if (error) {
    console.error(`[phase-c] releasePhaseCLock RPC error for job ${jobId}:`, error);
  }
}

/**
 * Record a Phase C failure on the job row without wiping the durable pipeline
 * state. The wizard reads (phaseCError && phaseCPipeline) as "indexing paused —
 * retry", and a user-initiated retry re-POSTs /analyze-memory which picks up
 * the existing phaseCPipeline and dispatches a continuation from state.startIndex.
 *
 * Diverges from Phase B on purpose: Phase B writes `status: "error"` on the
 * scan-lifecycle column and treats failure as terminal. Phase C has a native
 * resume path via the chunked pipeline, so we keep `status` alone (Phase B
 * owns that field) and mark the failure only in result.phaseCError.
 */
export async function writePhaseCError(
  supabase: SupabaseClient,
  jobId: string,
  err: unknown,
  stage: "entry" | "continuation",
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);

  const { data: row } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  const currentResult = (row?.result as Record<string, unknown>) || {};
  const currentState = currentResult.phaseCPipeline as PhaseCPipelineState | undefined;

  await supabase
    .from("gmail_scan_jobs")
    .update({
      result: {
        ...currentResult,
        phaseCError: {
          message,
          at: new Date().toISOString(),
          stage,
          failedAtIndex: currentState?.startIndex ?? null,
        },
      },
    })
    .eq("id", jobId);
}

/**
 * Fire the Phase C continuation route as a fire-and-forget fetch. The receiving
 * route pulls the durable pipeline state out of gmail_scan_jobs.result and
 * resumes processing from state.startIndex — no parameters need to travel in
 * the POST body beyond the job/connection/company identifiers.
 *
 * Errors are intentionally swallowed — if the continuation never fires, the
 * job row still holds the partial progress and a user-initiated retrigger can
 * recover from state.
 */
export function dispatchPhaseCContinuation(
  jobId: string,
  connectionId: string,
  companyId: string,
): void {
  const baseUrl = getAppUrl();
  fetch(`${baseUrl}/api/integrations/email/analyze-memory-continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, connectionId, companyId }),
  }).catch(() => {
    /* fire-and-forget */
  });
  console.log(
    `[phase-c] Continuation dispatched for job ${jobId}`,
  );
}

/**
 * Finalize Phase C: build writing profiles from the accumulated outbound
 * emails, persist the final stats + diagnostics to gmail_scan_jobs.result,
 * clear the working pipeline buffer, and fire the completion notification.
 *
 * Called by both entry and continuation routes when runPhaseCChunks returns
 * done=true. Idempotent modulo the writing-profile build — repeated calls
 * would re-run gpt-4o-mini analysis on the same emails.
 */
export async function finalizePhaseC(params: {
  supabase: SupabaseClient;
  jobId: string;
  companyId: string;
  userId: string;
  state: PhaseCPipelineState;
  priorResult: Record<string, unknown>;
}): Promise<void> {
  const { supabase, jobId, companyId, userId, state, priorResult } = params;

  const emailsByProfileType = new Map(Object.entries(state.emailsByProfileType));

  // Record per-type sample distribution BEFORE the threshold gate so we can
  // tell at a glance whether a low profilesBuilt reflects (a) genuinely
  // sparse outbound data or (b) the threshold being too strict for an
  // inbox's profile-type distribution. Persisted into phaseCStats.
  const profilesByTypeStats: Record<string, number> = {};
  for (const [type, emails] of emailsByProfileType) {
    profilesByTypeStats[type] = emails.length;
  }

  console.log(
    `[phase-c] Finalize: building writing profiles from ${emailsByProfileType.size} profile types (distribution: ${JSON.stringify(profilesByTypeStats)})`,
  );
  const profilesBuilt = await MemoryService.buildWritingProfiles(
    companyId,
    userId,
    emailsByProfileType,
  );

  const processingTimeMs = Date.now() - new Date(state.startedAt).getTime();
  const totalDataPoints =
    state.stats.factsExtracted + state.stats.entitiesCreated + state.stats.edgesCreated;

  // Drop the working pipeline buffer from result so it doesn't linger as a
  // several-megabyte JSONB payload on every future read of the job row. Also
  // drop any phaseCError marker from a prior failed attempt now that we've
  // succeeded — the wizard uses (phaseCError && phaseCPipeline) to show
  // "indexing paused — retry", so leaving a stale error here would mislead.
  const {
    phaseCPipeline: _dropPipeline,
    phaseCError: _dropError,
    ...priorWithoutPipeline
  } = priorResult;
  void _dropPipeline;
  void _dropError;

  await supabase
    .from("gmail_scan_jobs")
    .update({
      result: {
        ...priorWithoutPipeline,
        phaseCComplete: true,
        phaseCStats: {
          ...state.stats,
          profilesBuilt,
          profilesByTypeStats,
          processingTimeMs,
          threadsProcessed: state.classifiedThreads.length,
        },
      },
    })
    .eq("id", jobId);

  await supabase.from("notifications").insert({
    user_id: userId,
    company_id: companyId,
    type: "mention",
    title: "Indexing complete",
    body: `${totalDataPoints} data points captured`,
    is_read: false,
    persistent: false,
    action_url: "/intel",
    action_label: "View Intel",
  });

  console.log(
    `[phase-c] Complete in ${(processingTimeMs / 1000).toFixed(1)}s — ${state.stats.factsExtracted} facts, ${state.stats.entitiesCreated} entities, ${state.stats.edgesCreated} edges, ${profilesBuilt} profiles`,
  );
}
