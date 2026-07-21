/**
 * OPS Web - Email Analyze Memory Continue Endpoint (Phase C - Continuation)
 *
 * POST /api/integrations/email/analyze-memory-continue
 * Resumes a chunked Phase C run from the durable pipeline state persisted in
 * gmail_scan_jobs.result.phaseCPipeline. Fired from /analyze-memory (entry)
 * and from this route itself whenever a single invocation's 800s budget is
 * exhausted before all threads are processed.
 *
 * Each invocation processes a bounded set of chunks (time-budget controlled by
 * CHUNK_TIME_BUDGET_MS). When runPhaseCChunks returns done=true, we finalize:
 * build writing profiles, write final stats, fire completion notification.
 * Otherwise we dispatch ourselves again.
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import {
  MemoryService,
  type PhaseCPipelineState,
} from "@/lib/api/services/memory-service";
import {
  acceptPhaseCContinuationDispatch,
  acquirePhaseCLock,
  buildPersistStateFn,
  dispatchPhaseCContinuation,
  finalizePhaseC,
  isExactDurablePhaseCCompletion,
  preparePhaseCContinuationDispatch,
  releasePhaseCLock,
  writePhaseCError,
} from "@/lib/api/services/phase-c-pipeline-helpers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEmailPipelineSecret } from "@/lib/email/email-route-auth";
import { authorizeEmailAnalysisJobContinuation } from "@/lib/email/email-analysis-job-access";

export const maxDuration = 800;

const CHUNK_TIME_BUDGET_MS = 550_000;
const CHUNK_SIZE = 12;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = requireEmailPipelineSecret(request);
  if (authError) return authError;

  const { jobId, connectionId, companyId, dispatchId } = await request.json();

  if (!jobId || !connectionId || !companyId || !dispatchId) {
    return NextResponse.json(
      { error: "jobId, connectionId, companyId, and dispatchId required" },
      { status: 400 }
    );
  }

  if (!UUID_RE.test(companyId)) {
    return NextResponse.json(
      { error: "companyId must be a valid UUID" },
      { status: 400 }
    );
  }

  // Feature gate check — defensive; caller is always the entry route or a
  // prior continuation, but skip cleanly if phase_c was disabled mid-run.
  const supabase = getServiceRoleClient();
  const continuationAccess = await authorizeEmailAnalysisJobContinuation({
    supabase,
    jobId,
    claimedConnectionId: connectionId,
    claimedCompanyId: companyId,
  });
  if (!continuationAccess.allowed) {
    return NextResponse.json(
      {
        error:
          continuationAccess.reason === "job_not_found"
            ? "Job not found"
            : "Forbidden",
      },
      { status: continuationAccess.reason === "job_not_found" ? 404 : 403 }
    );
  }

  const enabled = await runWithSupabase(supabase, () =>
    AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c")
  );

  if (!enabled) {
    console.log(
      `[analyze-memory-continue] Phase C skipped — phase_c disabled for ${companyId}`
    );
    return NextResponse.json({ skipped: true });
  }

  try {
    after(async () => {
      const bgSupabase = getServiceRoleClient();
      await runWithSupabase(bgSupabase, async () => {
        let holderId: string | null = null;
        try {
          const backgroundAccess = await authorizeEmailAnalysisJobContinuation({
            supabase: bgSupabase,
            jobId,
            claimedConnectionId: connectionId,
            claimedCompanyId: companyId,
          });
          if (!backgroundAccess.allowed) {
            throw new Error(
              `Phase C authorization expired: ${backgroundAccess.reason}`
            );
          }
          // Row-level execution lock. Continuations are the hot path for
          // double-dispatch races — a webhook retry or a sluggish Vercel that
          // re-fires the same fetch can put two runners on the same thread
          // range simultaneously. See migration 070_phase_c_row_lock.sql.
          holderId = await acquirePhaseCLock(bgSupabase, jobId, "continuation");
          if (!holderId) {
            console.log(
              `[analyze-memory-continue] Phase C lock held by another runner for job ${jobId} — skipping duplicate dispatch`
            );
            return;
          }
          await runPhaseCContinuation(
            jobId,
            connectionId,
            companyId,
            backgroundAccess.actorUserId,
            bgSupabase,
            holderId
          );
        } catch (err) {
          console.error(
            "[analyze-memory-continue] Phase C continuation failed:",
            err
          );
          await writePhaseCError(bgSupabase, jobId, err, "continuation");
        } finally {
          if (holderId) {
            // Idempotent safety net: the inner function releases ahead of any
            // continuation dispatch so the next runner can acquire immediately.
            // Fenced release makes a double-release a no-op.
            await releasePhaseCLock(bgSupabase, jobId, holderId).catch(
              () => {}
            );
          }
        }
      });
    });
    await acceptPhaseCContinuationDispatch(supabase, jobId, dispatchId);
  } catch (error) {
    await writePhaseCError(supabase, jobId, error, "continuation_handoff");
    return NextResponse.json(
      { error: "Phase C continuation could not safely start", accepted: false },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, accepted: true });
}

// ─── Phase C Continuation ────────────────────────────────────────────────────

async function runPhaseCContinuation(
  jobId: string,
  connectionId: string,
  companyId: string,
  actorUserId: string,
  supabase: SupabaseClient,
  holderId: string
) {
  console.log(
    `[analyze-memory-continue] Phase C continuation starting for job ${jobId} (lock holder ${holderId})`
  );

  // Read durable pipeline state off the job row
  const { data: job, error: jobReadError } = await supabase
    .from("gmail_scan_jobs")
    .select("status, result, requested_by_user_id, company_id")
    .eq("id", jobId)
    .single();

  if (jobReadError) {
    throw new Error(
      `Phase C continuation could not read its job result: ${jobReadError.message}`
    );
  }
  if (!job?.result) {
    throw new Error(
      `Phase C continuation job ${jobId} has no result — cannot continue`
    );
  }

  const priorResult = job.result as Record<string, unknown>;

  if (
    isExactDurablePhaseCCompletion({
      status: job.status,
      result: priorResult,
      requestedByUserId: job.requested_by_user_id,
      rowCompanyId: job.company_id,
      jobId,
      companyId,
      actorUserId,
    })
  ) {
    console.log(
      `[analyze-memory-continue] Phase C already complete for job ${jobId} — skipping`
    );
    return;
  }

  const isDurableFeatureSkip =
    job.status === "complete" &&
    job.requested_by_user_id === actorUserId &&
    job.company_id === companyId &&
    priorResult.phaseCComplete === false &&
    priorResult.phaseCSkipped === true;
  if (isDurableFeatureSkip) {
    console.log(
      `[analyze-memory-continue] Phase C durably skipped for job ${jobId} — skipping`
    );
    return;
  }

  if (job.status === "complete" || priorResult.phaseCComplete === true) {
    throw new Error("Phase C completion state is inconsistent");
  }

  const state = priorResult.phaseCPipeline as PhaseCPipelineState | undefined;
  if (!state) {
    throw new Error(
      `Phase C continuation job ${jobId} has no phaseCPipeline state — entry bootstrap did not persist`
    );
  }
  if (state.userId !== actorUserId) {
    throw new Error("Phase C requester snapshot does not match pipeline state");
  }

  console.log(
    `[analyze-memory-continue] Resuming at thread ${state.startIndex}/${state.classifiedThreads.length}, ${state.stats.factsExtracted} facts / ${state.stats.entitiesCreated} entities / ${state.stats.edgesCreated} edges so far`
  );

  const persistState = await buildPersistStateFn(supabase, jobId);

  const { done, state: finalState } = await MemoryService.runPhaseCChunks(
    companyId,
    state,
    {
      jobId,
      chunkSize: CHUNK_SIZE,
      timeBudgetMs: CHUNK_TIME_BUDGET_MS,
      persistState,
    }
  );

  if (done) {
    // Re-read priorResult to capture any phaseCPipeline writes from our own
    // chunk run and any concurrent mutations.
    const { data: currentRow, error: currentRowError } = await supabase
      .from("gmail_scan_jobs")
      .select("result")
      .eq("id", jobId)
      .single();
    if (currentRowError) {
      throw new Error(
        `Phase C continuation could not read its final durable state: ${currentRowError.message}`
      );
    }
    if (!currentRow?.result) {
      throw new Error("Phase C continuation final durable state is missing");
    }
    const currentPriorResult = currentRow.result as Record<string, unknown>;

    await finalizePhaseC({
      supabase,
      jobId,
      companyId,
      userId: finalState.userId,
      state: finalState,
      priorResult: currentPriorResult,
    });
  } else {
    const continuationDispatchId = randomUUID();
    await preparePhaseCContinuationDispatch(
      supabase,
      jobId,
      continuationDispatchId
    );
    // Release before dispatching so the next continuation can acquire
    // immediately. Outer finally() will no-op since fenced release only
    // clears when holderId still matches.
    await releasePhaseCLock(supabase, jobId, holderId);
    await dispatchPhaseCContinuation({
      supabase,
      jobId,
      connectionId,
      companyId,
      dispatchId: continuationDispatchId,
    });
  }
}
