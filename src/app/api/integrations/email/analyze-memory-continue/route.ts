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
  acquirePhaseCLock,
  buildPersistStateFn,
  dispatchPhaseCContinuation,
  finalizePhaseC,
  releasePhaseCLock,
  writePhaseCError,
} from "@/lib/api/services/phase-c-pipeline-helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 800;

const CHUNK_TIME_BUDGET_MS = 550_000;
const CHUNK_SIZE = 12;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { jobId, connectionId, companyId } = await request.json();

  if (!jobId || !connectionId || !companyId) {
    return NextResponse.json(
      { error: "jobId, connectionId, and companyId required" },
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
  const enabled = await runWithSupabase(supabase, () =>
    AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c")
  );

  if (!enabled) {
    console.log(`[analyze-memory-continue] Phase C skipped — phase_c disabled for ${companyId}`);
    return NextResponse.json({ skipped: true });
  }

  after(async () => {
    const bgSupabase = getServiceRoleClient();
    await runWithSupabase(bgSupabase, async () => {
      // Row-level execution lock. Continuations are the hot path for
      // double-dispatch races — a webhook retry or a sluggish Vercel that
      // re-fires the same fetch can put two runners on the same thread
      // range simultaneously. See migration 070_phase_c_row_lock.sql.
      const holderId = await acquirePhaseCLock(bgSupabase, jobId, "continuation");
      if (!holderId) {
        console.log(
          `[analyze-memory-continue] Phase C lock held by another runner for job ${jobId} — skipping duplicate dispatch`,
        );
        return;
      }
      try {
        await runPhaseCContinuation(jobId, connectionId, companyId, bgSupabase, holderId);
      } catch (err) {
        console.error("[analyze-memory-continue] Phase C continuation failed:", err);
        try {
          await writePhaseCError(bgSupabase, jobId, err, "continuation");
        } catch (markErr) {
          console.error("[analyze-memory-continue] Failed to persist phaseCError marker:", markErr);
        }
      } finally {
        // Idempotent safety net: the inner function releases ahead of any
        // continuation dispatch so the next runner can acquire immediately.
        // Fenced release makes a double-release a no-op.
        await releasePhaseCLock(bgSupabase, jobId, holderId).catch(() => {});
      }
    });
  });

  return NextResponse.json({ ok: true });
}

// ─── Phase C Continuation ────────────────────────────────────────────────────

async function runPhaseCContinuation(
  jobId: string,
  connectionId: string,
  companyId: string,
  supabase: SupabaseClient,
  holderId: string,
) {
  console.log(`[analyze-memory-continue] Phase C continuation starting for job ${jobId} (lock holder ${holderId})`);

  // Read durable pipeline state off the job row
  const { data: job } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  if (!job?.result) {
    console.error(`[analyze-memory-continue] Job ${jobId} has no result — cannot continue`);
    return;
  }

  const priorResult = job.result as Record<string, unknown>;

  if (priorResult.phaseCComplete) {
    console.log(`[analyze-memory-continue] Phase C already complete for job ${jobId} — skipping`);
    return;
  }

  const state = priorResult.phaseCPipeline as PhaseCPipelineState | undefined;
  if (!state) {
    console.error(
      `[analyze-memory-continue] Job ${jobId} has no phaseCPipeline state — continuation aborted. Entry route may have failed during bootstrap.`,
    );
    return;
  }

  console.log(
    `[analyze-memory-continue] Resuming at thread ${state.startIndex}/${state.classifiedThreads.length}, ${state.stats.factsExtracted} facts / ${state.stats.entitiesCreated} entities / ${state.stats.edgesCreated} edges so far`,
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
    },
  );

  if (done) {
    // Re-read priorResult to capture any phaseCPipeline writes from our own
    // chunk run and any concurrent mutations.
    const { data: currentRow } = await supabase
      .from("gmail_scan_jobs")
      .select("result")
      .eq("id", jobId)
      .single();
    const currentPriorResult = (currentRow?.result as Record<string, unknown>) || {};

    await finalizePhaseC({
      supabase,
      jobId,
      companyId,
      userId: finalState.userId,
      state: finalState,
      priorResult: currentPriorResult,
    });
  } else {
    // Release before dispatching so the next continuation can acquire
    // immediately. Outer finally() will no-op since fenced release only
    // clears when holderId still matches.
    await releasePhaseCLock(supabase, jobId, holderId);
    dispatchPhaseCContinuation(jobId, connectionId, companyId);
  }
}
