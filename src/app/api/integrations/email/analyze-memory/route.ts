/**
 * OPS Web - Email Analyze Memory Endpoint (Phase C - Entry)
 *
 * POST /api/integrations/email/analyze-memory
 * Background processing that extracts business intelligence from email threads,
 * resolves named entities into a knowledge graph, and builds per-relationship-type
 * writing profiles. Fire-and-forget from Phase B completion.
 *
 * Chunked execution: fetches + classifies threads, runs per-thread extraction
 * until either all threads complete OR the in-call time budget is exhausted. If
 * exhausted, fires /analyze-memory-continue with the durable pipeline state
 * persisted in gmail_scan_jobs.result.phaseCPipeline.
 *
 * Feature-gated: phase_c
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import { resolvePersistedEmailDirection } from "@/lib/email/email-ingestion-routing";
import {
  MemoryService,
  SKIP_CLASSIFICATION_KEYWORDS,
  type ClassifiedThread,
  type PhaseCPipelineState,
  type ProfileType,
} from "@/lib/api/services/memory-service";
import {
  acceptPhaseCDispatch,
  acquirePhaseCLock,
  buildPersistStateFn,
  dispatchPhaseCContinuation,
  finalizePhaseC,
  isExactDurablePhaseCCompletion,
  preparePhaseCContinuationDispatch,
  releasePhaseCLock,
  skipPhaseCDispatch,
  writePhaseCError,
} from "@/lib/api/services/phase-c-pipeline-helpers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ProviderApiError,
  type NormalizedEmail,
} from "@/lib/api/services/email-provider";
import { requireEmailPipelineSecret } from "@/lib/email/email-route-auth";
import { authorizeEmailAnalysisJobContinuation } from "@/lib/email/email-analysis-job-access";
import {
  acquireEmailConnectionSyncLock,
  createEmailConnectionSyncLockRenewer,
  releaseEmailConnectionSyncLock,
} from "@/lib/api/services/email-connection-sync-lock";

export const maxDuration = 800;

// Per-call budgets. Each Vercel invocation gets its own 800s; we yield at 550s
// so the subsequent finalize (profile-building gpt-4o-mini calls, ~30-60s) and
// any continuation dispatch have room to land inside the same invocation.
const CHUNK_TIME_BUDGET_MS = 550_000;
// 12 threads per chunk → progress is persisted every ~60-90s at typical
// extraction speeds. Small enough that a Lambda kill loses < 2 min of work.
const CHUNK_SIZE = 12;
const PHASE_C_THREAD_READ_DEADLINE_MS = 45_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Stage → Profile Type mapping ────────────────────────────────────────────

function stageToProfileType(
  stage: string,
  correspondenceCount: number
): ProfileType {
  if (correspondenceCount > 20) return "client_active_project";
  switch (stage) {
    case "new_lead":
    case "qualifying":
      return "client_new_inquiry";
    case "quoting":
    case "quoted":
      return "client_quoting";
    case "follow_up":
    case "negotiation":
      return "client_followup";
    default:
      return "client_new_inquiry";
  }
}

// ─── Skip thread classification ──────────────────────────────────────────────

function classifySkipThread(
  reason: string,
  senderEmail: string | undefined,
  employeeEmails: Set<string>
): {
  classification: "vendor" | "subtrade" | "internal" | "unknown";
  profileType: ProfileType | null;
} {
  // Employee email → internal
  if (senderEmail && employeeEmails.has(senderEmail.toLowerCase())) {
    return { classification: "internal", profileType: "internal" };
  }

  const lowerReason = reason.toLowerCase();

  // Priority order: spam (skip entirely — handled by caller), vendor, subtrade, internal
  for (const keyword of SKIP_CLASSIFICATION_KEYWORDS.vendor) {
    if (lowerReason.includes(keyword)) {
      return { classification: "vendor", profileType: "vendor_ordering" };
    }
  }
  for (const keyword of SKIP_CLASSIFICATION_KEYWORDS.subtrade) {
    if (lowerReason.includes(keyword)) {
      return {
        classification: "subtrade",
        profileType: "subtrade_coordination",
      };
    }
  }
  for (const keyword of SKIP_CLASSIFICATION_KEYWORDS.internal) {
    if (lowerReason.includes(keyword)) {
      return { classification: "internal", profileType: "internal" };
    }
  }

  return { classification: "unknown", profileType: null };
}

function isSpamThread(reason: string): boolean {
  const lower = reason.toLowerCase();
  return SKIP_CLASSIFICATION_KEYWORDS.spam.some((k) => lower.includes(k));
}

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

  // Feature gate check
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
    await skipPhaseCDispatch(supabase, jobId, dispatchId);
    console.log(
      `[analyze-memory] Phase C skipped — phase_c disabled for ${companyId}`
    );
    return NextResponse.json({ skipped: true });
  }

  let lockOwner: string | null;
  try {
    lockOwner = await acquireEmailConnectionSyncLock(
      connectionId,
      "email-analyze-phase-c-entry",
      supabase
    );
  } catch (error) {
    console.error("[analyze-memory] mailbox lease handoff failed:", error);
    return NextResponse.json(
      {
        error: "Mailbox is busy. Try again in a few minutes.",
        lockAccepted: false,
      },
      { status: 409 }
    );
  }
  if (!lockOwner) {
    return NextResponse.json(
      {
        error: "Mailbox is busy. Try again in a few minutes.",
        lockAccepted: false,
      },
      { status: 409 }
    );
  }
  let lockHandedToBackground = false;

  // Run Phase C in background. runWithSupabase pins the service-role client to
  // the async chain so Memory/Writing/KnowledgeGraph services see the right
  // client for the entire multi-minute run, regardless of concurrent traffic.
  try {
    after(async () => {
      const bgSupabase = getServiceRoleClient();
      await runWithSupabase(bgSupabase, async () => {
        const renewLockIfNeeded = createEmailConnectionSyncLockRenewer({
          connectionId,
          ownerId: lockOwner!,
          context: "email-analyze-phase-c-entry",
          client: bgSupabase,
        });
        let holderId: string | null = null;
        try {
          await renewLockIfNeeded(true);
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
          // Row-level execution lock. A duplicate dispatch (webhook retry, a
          // user double-click on a retry button, two entry routes overlapping)
          // would otherwise race through the same thread range and corrupt
          // phaseCStats — in-memory counters whose "last writer wins" on
          // finalize makes concurrent progress invisible to the job row.
          holderId = await acquirePhaseCLock(bgSupabase, jobId, "entry");
          if (!holderId) {
            console.log(
              `[analyze-memory] Phase C lock held by another runner for job ${jobId} — skipping duplicate dispatch`
            );
            return;
          }
          await runPhaseCEntry(
            jobId,
            connectionId,
            companyId,
            backgroundAccess.actorUserId,
            bgSupabase,
            holderId,
            () => renewLockIfNeeded(true)
          );
        } catch (err) {
          console.error("[analyze-memory] Phase C entry failed:", err);
          await writePhaseCError(bgSupabase, jobId, err, "entry");
        } finally {
          if (holderId) {
            // Idempotent: runPhaseCEntry releases the lock itself just before
            // firing a continuation dispatch so the next runner can acquire.
            await releasePhaseCLock(bgSupabase, jobId, holderId).catch(
              () => {}
            );
          }
          await renewLockIfNeeded.stop().catch(() => {});
          await releaseEmailConnectionSyncLock(
            connectionId,
            lockOwner!,
            "email-analyze-phase-c-entry",
            bgSupabase
          );
        }
      });
    });
    await acceptPhaseCDispatch(supabase, jobId, dispatchId);
    lockHandedToBackground = true;

    return NextResponse.json({ ok: true, accepted: true });
  } catch (error) {
    await writePhaseCError(supabase, jobId, error, "entry");
    return NextResponse.json(
      { error: "Phase C could not safely start", accepted: false },
      { status: 500 }
    );
  } finally {
    if (!lockHandedToBackground) {
      await releaseEmailConnectionSyncLock(
        connectionId,
        lockOwner,
        "email-analyze-phase-c-entry",
        supabase
      );
    }
  }
}

// ─── Phase C Entry: bootstrap (fetch + classify) + first chunk run ───────────

async function runPhaseCEntry(
  jobId: string,
  connectionId: string,
  companyId: string,
  actorUserId: string,
  supabase: SupabaseClient,
  holderId: string,
  proveMailboxOwnership: () => Promise<void>
) {
  console.log(
    `[analyze-memory] Phase C entry starting for job ${jobId} (lock holder ${holderId})`
  );

  // ─── 1. Read Phase B job result ──────────────────────────────────────────
  const { data: job, error: jobReadError } = await supabase
    .from("gmail_scan_jobs")
    .select("status, result, requested_by_user_id, company_id")
    .eq("id", jobId)
    .single();

  if (jobReadError) {
    throw new Error(
      `Phase C entry could not read its job result: ${jobReadError.message}`
    );
  }
  if (!job?.result) {
    throw new Error(
      "Phase C entry job result is empty — Phase B did not durably prepare it"
    );
  }

  const priorResult = job.result as Record<string, unknown>;

  // Idempotency is based on the durable row transition plus the exact actor,
  // company, and finalization proof. A JSON marker by itself is not enough:
  // it may have been written by a failed/stale attempt before the guarded
  // completion transaction committed.
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
      `[analyze-memory] Phase C already complete for job ${jobId} — skipping`
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
      `[analyze-memory] Phase C durably skipped for job ${jobId} — skipping`
    );
    return;
  }

  if (job.status === "complete" || priorResult.phaseCComplete === true) {
    throw new Error("Phase C completion state is inconsistent");
  }

  // If pipeline state already exists (e.g., a prior invocation wrote it
  // before crashing), resume from there rather than re-fetching threads.

  if (priorResult.phaseCPipeline) {
    const persistedState = priorResult.phaseCPipeline as PhaseCPipelineState;
    if (persistedState.userId !== actorUserId) {
      throw new Error(
        "Phase C requester snapshot does not match pipeline state"
      );
    }
    console.log(
      `[analyze-memory] Phase C pipeline state found — resuming via continuation`
    );
    const continuationDispatchId = randomUUID();
    await preparePhaseCContinuationDispatch(
      supabase,
      jobId,
      continuationDispatchId
    );
    await proveMailboxOwnership();
    // Release before dispatching so the continuation can acquire immediately
    // rather than racing our still-held lock and skipping as a duplicate.
    await releasePhaseCLock(supabase, jobId, holderId);
    await dispatchPhaseCContinuation({
      supabase,
      jobId,
      connectionId,
      companyId,
      dispatchId: continuationDispatchId,
    });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = priorResult as any;
  const leads = result.leads || [];
  const notLeadReasons: Array<{
    tid: string;
    name: string;
    email: string;
    reason: string;
  }> = result._extractionDebug?.notLeadReasons || [];

  console.log(
    `[analyze-memory] Found ${leads.length} leads, ${notLeadReasons.length} skip threads`
  );

  // ─── 2. Get connection for mailbox direction + ownerEmail ───────────────
  const connection = await EmailService.getConnection(connectionId);

  if (!connection || connection.companyId !== companyId) {
    throw new Error(`Phase C email connection ${connectionId} was not found`);
  }

  const userId = actorUserId;
  const ownerEmail = connection.email.toLowerCase();

  // ─── 3. Get company users for employee email set ─────────────────────────
  const { data: companyUsers, error: companyUsersError } = await supabase
    .from("users")
    .select("email")
    .eq("company_id", companyId);
  if (companyUsersError) {
    throw new Error(
      `Phase C could not load company email identities: ${companyUsersError.message}`
    );
  }

  const employeeEmailSet = new Set<string>();
  for (const u of companyUsers || []) {
    if (u.email) employeeEmailSet.add((u.email as string).toLowerCase().trim());
  }
  const persistedDirection = (email: NormalizedEmail) =>
    resolvePersistedEmailDirection(email, {
      connectionEmail: connection.email,
      companyDomains: connection.syncFilters?.companyDomains ?? [],
      userEmailAddresses: [...employeeEmailSet],
    });

  // ─── 4. Collect all thread identities to fetch ───────────────────────────
  // Contact-form leads have a logical message-scoped key plus a raw provider
  // thread. Fetch the raw thread, then retain only that submission's message
  // so Phase C cannot recombine unrelated customers.
  type ThreadFetchTarget = {
    logicalThreadId: string;
    providerThreadId: string;
    messageIds: Set<string> | null;
  };
  type PhaseCLeadThread = {
    threadId: string;
    providerThreadId?: string;
    emails?: Array<{ id?: string }>;
  };
  const leadThreadTargets: ThreadFetchTarget[] = (leads as PhaseCLeadThread[])
    .map((lead) => {
      const logicalThreadId = lead.threadId;
      const providerThreadId = lead.providerThreadId ?? logicalThreadId;
      const messageIds =
        providerThreadId !== logicalThreadId
          ? new Set<string>(
              (lead.emails ?? [])
                .map((email: { id?: string }) => email.id)
                .filter((id: string | undefined): id is string => Boolean(id))
            )
          : null;
      return { logicalThreadId, providerThreadId, messageIds };
    })
    .filter((target: ThreadFetchTarget) =>
      Boolean(target.logicalThreadId && target.providerThreadId)
    );
  const skipThreadIds = notLeadReasons
    .filter((r) => !isSpamThread(r.reason)) // Exclude spam threads entirely
    .map((r) => r.tid)
    .filter(Boolean);
  const targetsByLogicalId = new Map<string, ThreadFetchTarget>();
  for (const target of leadThreadTargets) {
    targetsByLogicalId.set(target.logicalThreadId, target);
  }
  for (const threadId of skipThreadIds) {
    if (!targetsByLogicalId.has(threadId)) {
      targetsByLogicalId.set(threadId, {
        logicalThreadId: threadId,
        providerThreadId: threadId,
        messageIds: null,
      });
    }
  }
  const allThreadTargets = [...targetsByLogicalId.values()];
  console.log(
    `[analyze-memory] Fetching ${allThreadTargets.length} threads (${leadThreadTargets.length} leads + ${skipThreadIds.length} non-spam skips)`
  );

  // ─── 5. Re-fetch ALL threads from Gmail ──────────────────────────────────
  const provider = EmailService.getProvider(connection);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchedThreads = new Map<string, any[]>();
  const FETCH_CONCURRENCY = 5;

  for (let i = 0; i < allThreadTargets.length; i += FETCH_CONCURRENCY) {
    const batch = allThreadTargets.slice(i, i + FETCH_CONCURRENCY);

    await proveMailboxOwnership();
    const results = await Promise.all(
      batch.map(async (target) => {
        try {
          const fetched = await provider.fetchThread(target.providerThreadId, {
            deadlineAt: Date.now() + PHASE_C_THREAD_READ_DEADLINE_MS,
            context: `Phase C thread fetch (${target.providerThreadId})`,
          });
          const messages = target.messageIds
            ? fetched.filter((message: { id?: string }) =>
                message.id ? target.messageIds!.has(message.id) : false
              )
            : fetched;
          return { threadId: target.logicalThreadId, messages };
        } catch (error) {
          if (
            error instanceof ProviderApiError &&
            (error.providerStatus === 404 || error.providerStatus === 410)
          ) {
            return { threadId: target.logicalThreadId, messages: null };
          }
          throw error;
        }
      })
    );
    await proveMailboxOwnership();

    for (const r of results) {
      if (r.messages) {
        fetchedThreads.set(r.threadId, r.messages);
      }
    }

    // 200ms delay between batches
    if (i + FETCH_CONCURRENCY < allThreadTargets.length) {
      await delay(200);
    }
  }

  console.log(
    `[analyze-memory] Fetched ${fetchedThreads.size}/${allThreadTargets.length} threads`
  );

  // ─── 6. Classify threads and build ClassifiedThread[] ────────────────────
  const classifiedThreads: ClassifiedThread[] = [];

  // Lead threads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const lead of leads as any[]) {
    const threadId = lead.threadId as string;
    const messages = fetchedThreads.get(threadId);
    if (!messages || messages.length === 0) continue;

    const profileType = stageToProfileType(
      lead.stage || "new_lead",
      messages.length
    );

    classifiedThreads.push({
      threadId,
      classification: "client",
      profileType,
      confidence: 0.9,
      messages: messages.map(
        (m: {
          from: string;
          fromName: string;
          to: string[];
          subject: string;
          bodyText: string;
          snippet: string;
          date: Date;
        }) => ({
          from: (m.from || "").toLowerCase(),
          fromName: m.fromName || "",
          to: (m.to || []).map((t: string) => t.toLowerCase()),
          subject: m.subject || "",
          bodyText: m.bodyText || m.snippet || "",
          date: m.date instanceof Date ? m.date.toISOString() : String(m.date),
          direction: persistedDirection(m as NormalizedEmail),
        })
      ),
    });
  }

  // Skip threads (non-spam)
  for (const skipInfo of notLeadReasons) {
    if (isSpamThread(skipInfo.reason)) continue;
    const messages = fetchedThreads.get(skipInfo.tid);
    if (!messages || messages.length === 0) continue;

    const { classification, profileType } = classifySkipThread(
      skipInfo.reason,
      skipInfo.email,
      employeeEmailSet
    );

    classifiedThreads.push({
      threadId: skipInfo.tid,
      classification,
      profileType,
      confidence: classification === "unknown" ? 0.5 : 0.75,
      messages: messages.map(
        (m: {
          from: string;
          fromName: string;
          to: string[];
          subject: string;
          bodyText: string;
          snippet: string;
          date: Date;
        }) => ({
          from: (m.from || "").toLowerCase(),
          fromName: m.fromName || "",
          to: (m.to || []).map((t: string) => t.toLowerCase()),
          subject: m.subject || "",
          bodyText: m.bodyText || m.snippet || "",
          date: m.date instanceof Date ? m.date.toISOString() : String(m.date),
          direction: persistedDirection(m as NormalizedEmail),
        })
      ),
    });
  }

  console.log(
    `[analyze-memory] Classified ${classifiedThreads.length} threads (${classifiedThreads.filter((t) => t.classification === "client").length} client, ${classifiedThreads.filter((t) => t.classification === "vendor").length} vendor, ${classifiedThreads.filter((t) => t.classification === "subtrade").length} subtrade, ${classifiedThreads.filter((t) => t.classification === "internal").length} internal, ${classifiedThreads.filter((t) => t.classification === "unknown").length} unknown)`
  );

  // ─── 7. Initialize chunked pipeline state ─────────────────────────────────
  const state = MemoryService.initPhaseCPipelineState(
    userId,
    ownerEmail,
    employeeEmailSet,
    classifiedThreads
  );

  const persistState = await buildPersistStateFn(supabase, jobId);
  await persistState(state);

  // ─── 8. Run chunks until done or time budget exhausted ────────────────────
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
    await proveMailboxOwnership();
    // Re-read priorResult so we don't clobber phaseCPipeline writes that
    // happened during our own chunk run (startIndex, stats, etc.)
    const { data: currentRow, error: currentRowError } = await supabase
      .from("gmail_scan_jobs")
      .select("result")
      .eq("id", jobId)
      .single();
    if (currentRowError) {
      throw new Error(
        `Phase C could not read its final durable state: ${currentRowError.message}`
      );
    }
    if (!currentRow) {
      throw new Error("Phase C final durable state is missing");
    }
    const currentPriorResult =
      (currentRow?.result as Record<string, unknown>) || {};

    await finalizePhaseC({
      supabase,
      jobId,
      companyId,
      userId,
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
    await proveMailboxOwnership();
    // Release before dispatching so the continuation's acquire doesn't see
    // our lock and skip as a duplicate. Outer finally() will no-op since
    // fenced release only clears when holderId still matches.
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
