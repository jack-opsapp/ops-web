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
  type ProfileType,
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
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import { requireEmailPipelineSecret } from "@/lib/email/email-route-auth";

export const maxDuration = 800;

// Per-call budgets. Each Vercel invocation gets its own 800s; we yield at 550s
// so the subsequent finalize (profile-building gpt-4o-mini calls, ~30-60s) and
// any continuation dispatch have room to land inside the same invocation.
const CHUNK_TIME_BUDGET_MS = 550_000;
// 12 threads per chunk → progress is persisted every ~60-90s at typical
// extraction speeds. Small enough that a Lambda kill loses < 2 min of work.
const CHUNK_SIZE = 12;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchWithTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  try {
    return await Promise.race([
      promise,
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), ms)
      ),
    ]);
  } catch {
    return null;
  }
}

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

  // Feature gate check
  const supabase = getServiceRoleClient();
  const { data: scopedJob, error: scopedJobError } = await supabase
    .from("gmail_scan_jobs")
    .select("id, connection_id, company_id")
    .eq("id", jobId)
    .single();
  if (
    scopedJobError ||
    !scopedJob ||
    scopedJob.connection_id !== connectionId ||
    scopedJob.company_id !== companyId
  ) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const scopedConnection = await runWithSupabase(supabase, () =>
    EmailService.getConnection(connectionId)
  );
  if (!scopedConnection || scopedConnection.companyId !== companyId) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  const enabled = await runWithSupabase(supabase, () =>
    AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c")
  );

  if (!enabled) {
    console.log(
      `[analyze-memory] Phase C skipped — phase_c disabled for ${companyId}`
    );
    return NextResponse.json({ skipped: true });
  }

  // Run Phase C in background. runWithSupabase pins the service-role client to
  // the async chain so Memory/Writing/KnowledgeGraph services see the right
  // client for the entire multi-minute run, regardless of concurrent traffic.
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    await runWithSupabase(bgSupabase, async () => {
      // Row-level execution lock. A duplicate dispatch (webhook retry, a
      // user double-click on a retry button, two entry routes overlapping)
      // would otherwise race through the same thread range and corrupt
      // phaseCStats — in-memory counters whose "last writer wins" on
      // finalize makes concurrent progress invisible to the job row.
      const holderId = await acquirePhaseCLock(bgSupabase, jobId, "entry");
      if (!holderId) {
        console.log(
          `[analyze-memory] Phase C lock held by another runner for job ${jobId} — skipping duplicate dispatch`
        );
        return;
      }
      try {
        await runPhaseCEntry(
          jobId,
          connectionId,
          companyId,
          bgSupabase,
          holderId
        );
      } catch (err) {
        console.error("[analyze-memory] Phase C entry failed:", err);
        try {
          await writePhaseCError(bgSupabase, jobId, err, "entry");
        } catch (markErr) {
          console.error(
            "[analyze-memory] Failed to persist phaseCError marker:",
            markErr
          );
        }
      } finally {
        // Idempotent: runPhaseCEntry releases the lock itself just before
        // firing a continuation dispatch so the next runner can acquire. If
        // it already released, this is a no-op (fenced by holder id). This
        // block is the crash safety net.
        await releasePhaseCLock(bgSupabase, jobId, holderId).catch(() => {});
      }
    });
  });

  return NextResponse.json({ ok: true });
}

// ─── Phase C Entry: bootstrap (fetch + classify) + first chunk run ───────────

async function runPhaseCEntry(
  jobId: string,
  connectionId: string,
  companyId: string,
  supabase: SupabaseClient,
  holderId: string
) {
  console.log(
    `[analyze-memory] Phase C entry starting for job ${jobId} (lock holder ${holderId})`
  );

  // ─── 1. Read Phase B job result ──────────────────────────────────────────
  const { data: job } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  if (!job?.result) {
    console.error(
      "[analyze-memory] Job result empty — Phase B may not have completed"
    );
    return;
  }

  const priorResult = job.result as Record<string, unknown>;

  // Idempotency: if Phase C already completed, skip. If pipeline state already
  // exists (e.g., a prior invocation wrote it before crashing), resume from
  // there rather than re-fetching threads.
  if (priorResult.phaseCComplete) {
    console.log(
      `[analyze-memory] Phase C already complete for job ${jobId} — skipping`
    );
    return;
  }

  if (priorResult.phaseCPipeline) {
    console.log(
      `[analyze-memory] Phase C pipeline state found — resuming via continuation`
    );
    // Release before dispatching so the continuation can acquire immediately
    // rather than racing our still-held lock and skipping as a duplicate.
    await releasePhaseCLock(supabase, jobId, holderId);
    dispatchPhaseCContinuation(jobId, connectionId, companyId);
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

  // ─── 2. Get connection for userId + ownerEmail ───────────────────────────
  const connection = await EmailService.getConnection(connectionId);

  if (!connection || connection.companyId !== companyId) {
    console.error(`[analyze-memory] Connection ${connectionId} not found`);
    return;
  }

  const userId = connection.userId;
  const ownerEmail = connection.email.toLowerCase();

  if (!userId) {
    console.error(
      `[analyze-memory] Connection ${connectionId} has no userId — Phase C skipped`
    );

    // Surface the failure so it doesn't rot silently. New OAuth inits carry
    // a userId after the 2026-04-17 fix, so this should be very rare — but if
    // it fires, we want ops to see it and the user to be prompted to reconnect.
    await supabase.from("notifications").insert({
      user_id: null,
      company_id: companyId,
      type: "role_needed",
      title: "AI knowledge extraction skipped — reconnect required",
      body: "The email connection is missing an owner. Reconnect your inbox in Settings → Integrations to enable AI draft assistance.",
      is_read: false,
      persistent: true,
      action_url: "/settings?tab=integrations",
      action_label: "Reconnect",
    });
    return;
  }

  // ─── 3. Get company users for employee email set ─────────────────────────
  const { data: companyUsers } = await supabase
    .from("users")
    .select("email")
    .eq("company_id", companyId);

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
  const MAX_RETRIES = 3;

  for (let i = 0; i < allThreadTargets.length; i += FETCH_CONCURRENCY) {
    const batch = allThreadTargets.slice(i, i + FETCH_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (target) => {
        // Retry with exponential backoff on failure
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const fetched = await fetchWithTimeout(
            provider.fetchThread(target.providerThreadId),
            10_000
          );
          if (fetched) {
            const messages = target.messageIds
              ? fetched.filter((message: { id?: string }) =>
                  message.id ? target.messageIds!.has(message.id) : false
                )
              : fetched;
            return { threadId: target.logicalThreadId, messages };
          }
          // Backoff: 1s, 2s, 4s
          if (attempt < MAX_RETRIES - 1)
            await delay(1000 * Math.pow(2, attempt));
        }
        return { threadId: target.logicalThreadId, messages: null };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value.messages) {
        fetchedThreads.set(r.value.threadId, r.value.messages);
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
    // Re-read priorResult so we don't clobber phaseCPipeline writes that
    // happened during our own chunk run (startIndex, stats, etc.)
    const { data: currentRow } = await supabase
      .from("gmail_scan_jobs")
      .select("result")
      .eq("id", jobId)
      .single();
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
    // Release before dispatching so the continuation's acquire doesn't see
    // our lock and skip as a duplicate. Outer finally() will no-op since
    // fenced release only clears when holderId still matches.
    await releasePhaseCLock(supabase, jobId, holderId);
    dispatchPhaseCContinuation(jobId, connectionId, companyId);
  }
}
