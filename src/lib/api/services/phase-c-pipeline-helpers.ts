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

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryService, type PhaseCPipelineState } from "./memory-service";
import { getAppUrl } from "@/lib/utils/app-url";
import { emailPipelineAuthorizationHeaders } from "@/lib/email/email-route-auth";
import { createTrustedNotifications } from "@/lib/notifications/server-notification-service";

// Lease duration for the Phase C row-level execution lock. Chosen slightly
// longer than the route's 800s maxDuration so that a hard crash between the
// final runPhaseCChunks yield and the outer finally() can't block a retry
// for much more than a single invocation lifetime. Must match the default in
// migration 070_phase_c_row_lock.sql.
const PHASE_C_LOCK_LEASE_SECONDS = 900;

type EmailAnalysisDispatchState = {
  id: string;
  status: "pending" | "accepted" | "completed";
  requestedAt: string;
  acceptedAt?: string;
  completedAt?: string;
  disposition?: "accepted" | "skipped";
};

type PhaseCFinalizationProof = {
  version: 1;
  id: string;
  jobId: string;
  companyId: string;
  actorUserId: string;
  completedAt: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
  return `{${entries.join(",")}}`;
}

function buildPhaseCFinalizationId(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function isExactDurablePhaseCCompletion({
  status,
  result,
  requestedByUserId,
  rowCompanyId,
  jobId,
  companyId,
  actorUserId,
  expectedFinalizationId,
}: {
  status: unknown;
  result: Record<string, unknown> | null | undefined;
  requestedByUserId: unknown;
  rowCompanyId: unknown;
  jobId: string;
  companyId: string;
  actorUserId: string;
  expectedFinalizationId?: string;
}): boolean {
  if (
    status !== "complete" ||
    requestedByUserId !== actorUserId ||
    rowCompanyId !== companyId ||
    !result
  ) {
    return false;
  }
  if (result.phaseCComplete !== true) return false;

  const proof = result.phaseCFinalization as
    | Partial<PhaseCFinalizationProof>
    | undefined;
  const retry = result.phaseCRetry as { required?: unknown } | undefined;
  if (
    proof?.version !== 1 ||
    typeof proof.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(proof.id) ||
    proof.jobId !== jobId ||
    proof.companyId !== companyId ||
    proof.actorUserId !== actorUserId ||
    retry?.required !== false
  ) {
    return false;
  }
  return (
    expectedFinalizationId === undefined || proof.id === expectedFinalizationId
  );
}

async function readEmailAnalysisJobResult(
  supabase: SupabaseClient,
  jobId: string,
  context: string
): Promise<Record<string, unknown>> {
  const { data: row, error } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
  if (!row) {
    throw new Error(`${context}: job not found`);
  }
  return (row.result as Record<string, unknown> | null) ?? {};
}

async function writeEmailAnalysisJobResult(
  supabase: SupabaseClient,
  jobId: string,
  result: Record<string, unknown>,
  context: string
): Promise<void> {
  const { error } = await supabase
    .from("gmail_scan_jobs")
    .update({ result })
    .eq("id", jobId);
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

export async function preparePhaseCDispatch(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<void> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to read Phase C dispatch state"
  );
  const {
    phaseCError: _error,
    phaseCRetry: _retry,
    ...resultWithoutFailure
  } = currentResult;
  void _error;
  void _retry;
  await writeEmailAnalysisJobResult(
    supabase,
    jobId,
    {
      ...resultWithoutFailure,
      phaseCDispatch: {
        id: dispatchId,
        status: "pending",
        requestedAt: new Date().toISOString(),
      } satisfies EmailAnalysisDispatchState,
    },
    "Failed to persist Phase C dispatch state"
  );
}

export async function acceptPhaseCDispatch(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<void> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to read Phase C dispatch acceptance"
  );
  const dispatch = currentResult.phaseCDispatch as
    | EmailAnalysisDispatchState
    | undefined;
  if (!dispatch || dispatch.id !== dispatchId) {
    throw new Error(
      "Phase C dispatch does not match the durable pending request"
    );
  }
  await writeEmailAnalysisJobResult(
    supabase,
    jobId,
    {
      ...currentResult,
      phaseCDispatch: {
        ...dispatch,
        status: "accepted",
        acceptedAt: dispatch.acceptedAt ?? new Date().toISOString(),
      } satisfies EmailAnalysisDispatchState,
    },
    "Failed to persist Phase C dispatch acceptance"
  );
}

export async function skipPhaseCDispatch(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<void> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to read Phase C skip disposition"
  );
  const dispatch = currentResult.phaseCDispatch as
    | EmailAnalysisDispatchState
    | undefined;
  if (!dispatch || dispatch.id !== dispatchId) {
    throw new Error(
      "Phase C dispatch does not match the durable pending request"
    );
  }
  await writeEmailAnalysisJobResult(
    supabase,
    jobId,
    {
      ...currentResult,
      phaseCDispatch: {
        ...dispatch,
        status: "completed",
        disposition: "skipped",
        completedAt: dispatch.completedAt ?? new Date().toISOString(),
      } satisfies EmailAnalysisDispatchState,
    },
    "Failed to persist Phase C skip disposition"
  );
}

async function phaseCDispatchDisposition(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<"accepted" | "skipped" | null> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to confirm Phase C dispatch acceptance"
  );
  const dispatch = currentResult.phaseCDispatch as
    | EmailAnalysisDispatchState
    | undefined;
  if (dispatch?.id !== dispatchId) return null;
  if (dispatch.disposition === "skipped") return "skipped";
  if (dispatch.status === "accepted" || dispatch.status === "completed") {
    return "accepted";
  }
  return null;
}

export async function preparePhaseBDispatch(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<void> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to read Phase B dispatch state"
  );
  await writeEmailAnalysisJobResult(
    supabase,
    jobId,
    {
      ...currentResult,
      phaseBDispatch: {
        id: dispatchId,
        status: "pending",
        requestedAt: new Date().toISOString(),
      } satisfies EmailAnalysisDispatchState,
    },
    "Failed to persist Phase B dispatch state"
  );
}

export async function acceptPhaseBDispatch(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<void> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to read Phase B dispatch acceptance"
  );
  const dispatch = currentResult.phaseBDispatch as
    | EmailAnalysisDispatchState
    | undefined;
  if (!dispatch || dispatch.id !== dispatchId) {
    throw new Error(
      "Phase B dispatch does not match the durable pending request"
    );
  }
  await writeEmailAnalysisJobResult(
    supabase,
    jobId,
    {
      ...currentResult,
      phaseBDispatch: {
        ...dispatch,
        status: "accepted",
        acceptedAt: dispatch.acceptedAt ?? new Date().toISOString(),
      } satisfies EmailAnalysisDispatchState,
    },
    "Failed to persist Phase B dispatch acceptance"
  );
}

async function phaseBDispatchWasAccepted(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<boolean> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to confirm Phase B dispatch acceptance"
  );
  const dispatch = currentResult.phaseBDispatch as
    | EmailAnalysisDispatchState
    | undefined;
  return (
    dispatch?.id === dispatchId &&
    (dispatch.status === "accepted" || dispatch.status === "completed")
  );
}

export async function preparePhaseCContinuationDispatch(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<void> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to read Phase C continuation dispatch"
  );
  const {
    phaseCError: _error,
    phaseCRetry: _retry,
    ...resultWithoutFailure
  } = currentResult;
  void _error;
  void _retry;
  await writeEmailAnalysisJobResult(
    supabase,
    jobId,
    {
      ...resultWithoutFailure,
      phaseCContinuationDispatch: {
        id: dispatchId,
        status: "pending",
        requestedAt: new Date().toISOString(),
      } satisfies EmailAnalysisDispatchState,
    },
    "Failed to persist Phase C continuation dispatch"
  );
}

export async function acceptPhaseCContinuationDispatch(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<void> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to read Phase C continuation acceptance"
  );
  const dispatch = currentResult.phaseCContinuationDispatch as
    | EmailAnalysisDispatchState
    | undefined;
  if (!dispatch || dispatch.id !== dispatchId) {
    throw new Error(
      "Phase C continuation dispatch does not match the durable pending request"
    );
  }
  await writeEmailAnalysisJobResult(
    supabase,
    jobId,
    {
      ...currentResult,
      phaseCContinuationDispatch: {
        ...dispatch,
        status: "accepted",
        acceptedAt: dispatch.acceptedAt ?? new Date().toISOString(),
      } satisfies EmailAnalysisDispatchState,
    },
    "Failed to persist Phase C continuation acceptance"
  );
}

async function phaseCContinuationDispatchWasAccepted(
  supabase: SupabaseClient,
  jobId: string,
  dispatchId: string
): Promise<boolean> {
  const currentResult = await readEmailAnalysisJobResult(
    supabase,
    jobId,
    "Failed to confirm Phase C continuation acceptance"
  );
  const dispatch = currentResult.phaseCContinuationDispatch as
    | EmailAnalysisDispatchState
    | undefined;
  return (
    dispatch?.id === dispatchId &&
    (dispatch.status === "accepted" || dispatch.status === "completed")
  );
}

export async function dispatchPhaseBContinuation({
  supabase,
  jobId,
  connectionId,
  companyId,
  dispatchId,
}: {
  supabase: SupabaseClient;
  jobId: string;
  connectionId: string;
  companyId: string;
  dispatchId: string;
}): Promise<void> {
  try {
    const response = await fetch(
      `${getAppUrl()}/api/integrations/email/analyze-continue`,
      {
        method: "POST",
        headers: emailPipelineAuthorizationHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          jobId,
          connectionId,
          companyId,
          dispatchId,
        }),
      }
    );
    const body = (await response.json().catch(() => null)) as {
      accepted?: boolean;
    } | null;
    if (response.ok && body?.accepted === true) return;
    if (await phaseBDispatchWasAccepted(supabase, jobId, dispatchId)) return;
    throw new Error(`Phase B handoff failed with status ${response.status}`);
  } catch (error) {
    if (await phaseBDispatchWasAccepted(supabase, jobId, dispatchId)) return;
    throw error;
  }
}

export async function dispatchPhaseCEntry({
  supabase,
  jobId,
  connectionId,
  companyId,
  dispatchId,
}: {
  supabase: SupabaseClient;
  jobId: string;
  connectionId: string;
  companyId: string;
  dispatchId: string;
}): Promise<"accepted" | "skipped"> {
  try {
    const response = await fetch(
      `${getAppUrl()}/api/integrations/email/analyze-memory`,
      {
        method: "POST",
        headers: emailPipelineAuthorizationHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ jobId, connectionId, companyId, dispatchId }),
      }
    );
    const body = (await response.json().catch(() => null)) as {
      accepted?: boolean;
      skipped?: boolean;
    } | null;
    if (response.ok && body?.skipped === true) return "skipped";
    if (response.ok && body?.accepted === true) return "accepted";
    const durableDisposition = await phaseCDispatchDisposition(
      supabase,
      jobId,
      dispatchId
    );
    if (durableDisposition) return durableDisposition;
    throw new Error(
      `Phase C entry handoff failed with status ${response.status}`
    );
  } catch (error) {
    const durableDisposition = await phaseCDispatchDisposition(
      supabase,
      jobId,
      dispatchId
    );
    if (durableDisposition) return durableDisposition;
    throw error;
  }
}

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
  jobId: string
): Promise<(state: PhaseCPipelineState) => Promise<void>> {
  return async (state: PhaseCPipelineState) => {
    const { data: row, error: readError } = await supabase
      .from("gmail_scan_jobs")
      .select("result")
      .eq("id", jobId)
      .single();

    if (readError) {
      throw new Error(
        `Failed to read durable Phase C state: ${readError.message}`
      );
    }
    if (!row) {
      throw new Error("Failed to read durable Phase C state: job not found");
    }

    const currentResult = (row?.result as Record<string, unknown>) || {};
    const { error: writeError } = await supabase
      .from("gmail_scan_jobs")
      .update({
        result: {
          ...currentResult,
          phaseCPipeline: state,
        },
      })
      .eq("id", jobId);
    if (writeError) {
      throw new Error(
        `Failed to persist durable Phase C state: ${writeError.message}`
      );
    }
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
  stageLabel: "entry" | "continuation"
): Promise<string | null> {
  const holderId = `${stageLabel}:${randomUUID()}`;
  const { data, error } = await supabase.rpc("acquire_phase_c_lock", {
    p_job_id: jobId,
    p_holder: holderId,
    p_lease_seconds: PHASE_C_LOCK_LEASE_SECONDS,
  });
  if (error) {
    console.error(
      `[phase-c] acquirePhaseCLock RPC error for job ${jobId}:`,
      error
    );
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
  holderId: string
): Promise<void> {
  const { error } = await supabase.rpc("release_phase_c_lock", {
    p_job_id: jobId,
    p_holder: holderId,
  });
  if (error) {
    console.error(
      `[phase-c] releasePhaseCLock RPC error for job ${jobId}:`,
      error
    );
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
  stage:
    | "phase_b_handoff"
    | "entry_handoff"
    | "entry"
    | "continuation_handoff"
    | "continuation"
    | "finalize"
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);

  const { data: row, error: readError } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  if (readError) {
    throw new Error(`Failed to read Phase C error state: ${readError.message}`);
  }
  if (!row) {
    throw new Error("Failed to read Phase C error state: job not found");
  }

  const currentResult = (row?.result as Record<string, unknown>) || {};
  const currentState = currentResult.phaseCPipeline as
    | PhaseCPipelineState
    | undefined;

  const failedAt = new Date().toISOString();
  const { error: writeError } = await supabase
    .from("gmail_scan_jobs")
    .update({
      result: {
        ...currentResult,
        phaseCError: {
          message,
          at: failedAt,
          stage,
          failedAtIndex: currentState?.startIndex ?? null,
        },
        phaseCRetry: {
          required: true,
          stage,
          failedAt,
          resumeAtIndex: currentState?.startIndex ?? null,
        },
      },
    })
    .eq("id", jobId);
  if (writeError) {
    throw new Error(
      `Failed to persist Phase C error state: ${writeError.message}`
    );
  }
}

/**
 * Dispatch one exact, durably prepared Phase C continuation and wait until the
 * receiving route acknowledges it. A lost HTTP response is safe: the sender
 * confirms the matching acceptance marker from gmail_scan_jobs before
 * deciding the handoff failed. Every unaccepted failure propagates so the
 * caller can persist phaseCRetry instead of abandoning an in-flight job.
 */
export async function dispatchPhaseCContinuation({
  supabase,
  jobId,
  connectionId,
  companyId,
  dispatchId,
}: {
  supabase: SupabaseClient;
  jobId: string;
  connectionId: string;
  companyId: string;
  dispatchId: string;
}): Promise<void> {
  try {
    const response = await fetch(
      `${getAppUrl()}/api/integrations/email/analyze-memory-continue`,
      {
        method: "POST",
        headers: emailPipelineAuthorizationHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          jobId,
          connectionId,
          companyId,
          dispatchId,
        }),
      }
    );
    const body = (await response.json().catch(() => null)) as {
      accepted?: boolean;
    } | null;
    if (response.ok && body?.accepted === true) {
      console.log(`[phase-c] Continuation accepted for job ${jobId}`);
      return;
    }
    if (
      await phaseCContinuationDispatchWasAccepted(supabase, jobId, dispatchId)
    ) {
      return;
    }
    throw new Error(
      `Phase C continuation handoff failed with status ${response.status}`
    );
  } catch (error) {
    if (
      await phaseCContinuationDispatchWasAccepted(supabase, jobId, dispatchId)
    ) {
      return;
    }
    throw error;
  }
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

  const emailsByProfileType = new Map(
    Object.entries(state.emailsByProfileType)
  );

  // Record per-type sample distribution BEFORE the threshold gate so we can
  // tell at a glance whether a low profilesBuilt reflects (a) genuinely
  // sparse outbound data or (b) the threshold being too strict for an
  // inbox's profile-type distribution. Persisted into phaseCStats.
  const profilesByTypeStats: Record<string, number> = {};
  for (const [type, emails] of emailsByProfileType) {
    profilesByTypeStats[type] = emails.length;
  }

  console.log(
    `[phase-c] Finalize: building writing profiles from ${emailsByProfileType.size} profile types (distribution: ${JSON.stringify(profilesByTypeStats)})`
  );
  const profilesBuilt = await MemoryService.buildWritingProfiles(
    companyId,
    userId,
    emailsByProfileType
  );

  const processingTimeMs = Date.now() - new Date(state.startedAt).getTime();
  const totalDataPoints =
    state.stats.factsExtracted +
    state.stats.entitiesCreated +
    state.stats.edgesCreated;

  // Drop the working pipeline buffer from result so it doesn't linger as a
  // several-megabyte JSONB payload on every future read of the job row. Also
  // drop any phaseCError marker from a prior failed attempt now that we've
  // succeeded — the wizard uses (phaseCError && phaseCPipeline) to show
  // "indexing paused — retry", so leaving a stale error here would mislead.
  const {
    phaseCPipeline: _dropPipeline,
    phaseCError: _dropError,
    phaseCRetry: _dropRetry,
    ...priorWithoutPipeline
  } = priorResult;
  void _dropPipeline;
  void _dropError;
  void _dropRetry;

  const completedAt = new Date().toISOString();
  const deterministicPhaseCStats = {
    ...state.stats,
    profilesBuilt,
    profilesByTypeStats,
    threadsProcessed: state.classifiedThreads.length,
  };
  const finalizationId = buildPhaseCFinalizationId({
    version: 1,
    jobId,
    companyId,
    actorUserId: userId,
    priorResult: priorWithoutPipeline,
    state,
    phaseCStats: deterministicPhaseCStats,
  });

  const finalResult = {
    ...priorWithoutPipeline,
    ...(priorWithoutPipeline.phaseCDispatch
      ? {
          phaseCDispatch: {
            ...(priorWithoutPipeline.phaseCDispatch as Record<string, unknown>),
            status: "completed",
            completedAt,
          },
        }
      : {}),
    ...(priorWithoutPipeline.phaseCContinuationDispatch
      ? {
          phaseCContinuationDispatch: {
            ...(priorWithoutPipeline.phaseCContinuationDispatch as Record<
              string,
              unknown
            >),
            status: "completed",
            completedAt,
          },
        }
      : {}),
    phaseCComplete: true,
    phaseCStats: {
      ...deterministicPhaseCStats,
      processingTimeMs,
    },
    phaseCFinalization: {
      version: 1,
      id: finalizationId,
      jobId,
      companyId,
      actorUserId: userId,
      completedAt,
    } satisfies PhaseCFinalizationProof,
    phaseCRetry: {
      required: false,
      completedAt,
    },
  };
  let completionFailureMessage: string | null = null;
  try {
    const { error: completionError } = await supabase.rpc(
      "complete_email_analysis_job_as_system",
      {
        p_job_id: jobId,
        p_actor_user_id: userId,
        p_result: finalResult,
        p_progress: {
          stage: "complete",
          message: "Analysis and indexing complete",
          percent: 100,
        },
      }
    );
    completionFailureMessage = completionError?.message ?? null;
  } catch (error) {
    completionFailureMessage =
      error instanceof Error ? error.message : String(error);
  }

  if (completionFailureMessage) {
    const { data: completionRow, error: completionReadError } = await supabase
      .from("gmail_scan_jobs")
      .select("status, result, requested_by_user_id, company_id")
      .eq("id", jobId)
      .single();
    if (completionReadError || !completionRow) {
      throw new Error(
        `Failed to publish durable Phase C completion: ${completionFailureMessage}; completion readback failed: ${completionReadError?.message ?? "job not found"}`
      );
    }
    const reconciled = isExactDurablePhaseCCompletion({
      status: completionRow.status,
      result: completionRow.result as Record<string, unknown> | null,
      requestedByUserId: completionRow.requested_by_user_id,
      rowCompanyId: completionRow.company_id,
      jobId,
      companyId,
      actorUserId: userId,
      expectedFinalizationId: finalizationId,
    });
    if (!reconciled) {
      throw new Error(
        `Failed to publish durable Phase C completion: ${completionFailureMessage}`
      );
    }
    console.warn(
      `[phase-c] Completion response was lost for job ${jobId}; exact durable finalization ${finalizationId} confirmed`
    );
  }

  try {
    const finalResultRecord = finalResult as Record<string, unknown>;
    const leadCount = Array.isArray(finalResultRecord.leads)
      ? finalResultRecord.leads.length
      : 0;
    const completionNotification = await createTrustedNotifications(
      {
        recipientUserIds: [userId],
        companyId,
        type: "pipeline_complete",
        title: "Pipeline analysis complete",
        body: `Found ${leadCount} lead${leadCount === 1 ? "" : "s"}. ${totalDataPoints} intelligence points captured.`,
        persistent: true,
        actionUrl: "/settings?tab=integrations",
        actionLabel: "Review Results",
        deepLinkType: "pipeline",
        dedupeKey: `pipeline-analysis-complete:${jobId}`,
      },
      supabase
    );
    if (completionNotification.errors > 0) {
      console.error(
        "[phase-c] Analysis completed but its notification could not be created"
      );
    }
  } catch (error) {
    console.error(
      "[phase-c] Analysis completed but its notification could not be created:",
      error
    );
  }

  console.log(
    `[phase-c] Complete in ${(processingTimeMs / 1000).toFixed(1)}s — ${state.stats.factsExtracted} facts, ${state.stats.entitiesCreated} entities, ${state.stats.edgesCreated} edges, ${profilesBuilt} profiles`
  );
}
