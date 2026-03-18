/**
 * OPS Web - Email Analyze Memory Endpoint (Phase C)
 *
 * POST /api/integrations/email/analyze-memory
 * Background processing that extracts business intelligence from email threads,
 * resolves named entities into a knowledge graph, and builds per-relationship-type
 * writing profiles. Fire-and-forget from Phase B completion.
 *
 * Feature-gated: ai_email_memory
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import {
  MemoryService,
  SKIP_CLASSIFICATION_KEYWORDS,
  type ClassifiedThread,
  type ProfileType,
} from "@/lib/api/services/memory-service";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 800;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      promise,
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Stage → Profile Type mapping ────────────────────────────────────────────

function stageToProfileType(stage: string, correspondenceCount: number): ProfileType {
  if (correspondenceCount > 20) return 'client_active_project';
  switch (stage) {
    case 'new_lead':
    case 'qualifying':
      return 'client_new_inquiry';
    case 'quoting':
    case 'quoted':
      return 'client_quoting';
    case 'follow_up':
    case 'negotiation':
      return 'client_followup';
    default:
      return 'client_new_inquiry';
  }
}

// ─── Skip thread classification ──────────────────────────────────────────────

function classifySkipThread(
  reason: string,
  senderEmail: string | undefined,
  employeeEmails: Set<string>,
): { classification: 'vendor' | 'subtrade' | 'internal' | 'unknown'; profileType: ProfileType | null } {
  // Employee email → internal
  if (senderEmail && employeeEmails.has(senderEmail.toLowerCase())) {
    return { classification: 'internal', profileType: 'internal' };
  }

  const lowerReason = reason.toLowerCase();

  // Priority order: spam (skip entirely — handled by caller), vendor, subtrade, internal
  for (const keyword of SKIP_CLASSIFICATION_KEYWORDS.vendor) {
    if (lowerReason.includes(keyword)) {
      return { classification: 'vendor', profileType: 'vendor_ordering' };
    }
  }
  for (const keyword of SKIP_CLASSIFICATION_KEYWORDS.subtrade) {
    if (lowerReason.includes(keyword)) {
      return { classification: 'subtrade', profileType: 'subtrade_coordination' };
    }
  }
  for (const keyword of SKIP_CLASSIFICATION_KEYWORDS.internal) {
    if (lowerReason.includes(keyword)) {
      return { classification: 'internal', profileType: 'internal' };
    }
  }

  return { classification: 'unknown', profileType: null };
}

function isSpamThread(reason: string): boolean {
  const lower = reason.toLowerCase();
  return SKIP_CLASSIFICATION_KEYWORDS.spam.some(k => lower.includes(k));
}

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

  // Feature gate check
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  let enabled: boolean;
  try {
    enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "ai_email_memory");
  } finally {
    setSupabaseOverride(null);
  }

  if (!enabled) {
    console.log(`[analyze-memory] Phase C skipped — ai_email_memory disabled for ${companyId}`);
    return NextResponse.json({ skipped: true });
  }

  // Run Phase C in background
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    setSupabaseOverride(bgSupabase);
    try {
      await runPhaseC(jobId, connectionId, companyId, bgSupabase);
    } catch (err) {
      console.error("[analyze-memory] Phase C failed:", err);
    } finally {
      setSupabaseOverride(null);
    }
  });

  return NextResponse.json({ ok: true });
}

// ─── Phase C: Entity resolution, fact extraction, writing profiles ───────────

async function runPhaseC(
  jobId: string,
  connectionId: string,
  companyId: string,
  supabase: SupabaseClient
) {
  const startTime = Date.now();
  console.log(`[analyze-memory] Phase C starting for job ${jobId}`);

  // ─── 1. Read Phase B job result ──────────────────────────────────────────
  const { data: job } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  if (!job?.result) {
    console.error("[analyze-memory] Job result empty — Phase B may not have completed");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = job.result as any;
  const leads = result.leads || [];
  const notLeadReasons: Array<{ tid: string; name: string; email: string; reason: string }> =
    result._extractionDebug?.notLeadReasons || [];

  console.log(`[analyze-memory] Found ${leads.length} leads, ${notLeadReasons.length} skip threads`);

  // ─── 2. Get connection for userId + ownerEmail ───────────────────────────
  setSupabaseOverride(supabase);
  let connection;
  try {
    connection = await EmailService.getConnection(connectionId);
  } finally {
    setSupabaseOverride(null);
  }

  if (!connection) {
    console.error(`[analyze-memory] Connection ${connectionId} not found`);
    return;
  }

  const userId = connection.userId;
  const ownerEmail = connection.email.toLowerCase();

  if (!userId) {
    console.error("[analyze-memory] Connection has no userId");
    return;
  }

  // ─── 3. Get company users for employee email set ─────────────────────────
  const { data: companyUsers } = await supabase
    .from("users")
    .select("email")
    .eq("company_id", companyId);

  const employeeEmailSet = new Set<string>();
  for (const u of (companyUsers || [])) {
    if (u.email) employeeEmailSet.add((u.email as string).toLowerCase().trim());
  }

  // ─── 4. Collect all thread IDs to fetch ──────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leadThreadIds = leads.map((l: any) => l.threadId as string).filter(Boolean);
  const skipThreadIds = notLeadReasons
    .filter(r => !isSpamThread(r.reason)) // Exclude spam threads entirely
    .map(r => r.tid)
    .filter(Boolean);

  const allThreadIds = [...new Set([...leadThreadIds, ...skipThreadIds])];
  console.log(`[analyze-memory] Fetching ${allThreadIds.length} threads (${leadThreadIds.length} leads + ${skipThreadIds.length} non-spam skips)`);

  // ─── 5. Re-fetch ALL threads from Gmail ──────────────────────────────────
  const provider = EmailService.getProvider(connection);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchedThreads = new Map<string, any[]>();
  const FETCH_CONCURRENCY = 5;
  const MAX_RETRIES = 3;

  for (let i = 0; i < allThreadIds.length; i += FETCH_CONCURRENCY) {
    const batch = allThreadIds.slice(i, i + FETCH_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (threadId) => {
        // Retry with exponential backoff on failure
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const fetched = await fetchWithTimeout(
            provider.fetchThread(threadId),
            10_000
          );
          if (fetched) return { threadId, messages: fetched };
          // Backoff: 1s, 2s, 4s
          if (attempt < MAX_RETRIES - 1) await delay(1000 * Math.pow(2, attempt));
        }
        return { threadId, messages: null };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.messages) {
        fetchedThreads.set(r.value.threadId, r.value.messages);
      }
    }

    // 200ms delay between batches
    if (i + FETCH_CONCURRENCY < allThreadIds.length) {
      await delay(200);
    }
  }

  console.log(`[analyze-memory] Fetched ${fetchedThreads.size}/${allThreadIds.length} threads`);

  // ─── 6. Classify threads and build ClassifiedThread[] ────────────────────
  const classifiedThreads: ClassifiedThread[] = [];

  // Lead threads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const lead of leads as any[]) {
    const threadId = lead.threadId as string;
    const messages = fetchedThreads.get(threadId);
    if (!messages || messages.length === 0) continue;

    const profileType = stageToProfileType(
      lead.stage || 'new_lead',
      messages.length,
    );

    classifiedThreads.push({
      threadId,
      classification: 'client',
      profileType,
      confidence: 0.9,
      messages: messages.map((m: { from: string; fromName: string; to: string[]; subject: string; bodyText: string; snippet: string; date: Date }) => ({
        from: (m.from || '').toLowerCase(),
        fromName: m.fromName || '',
        to: (m.to || []).map((t: string) => t.toLowerCase()),
        subject: m.subject || '',
        bodyText: m.bodyText || m.snippet || '',
        date: m.date instanceof Date ? m.date.toISOString() : String(m.date),
        direction: ((m.from || '').toLowerCase().includes(ownerEmail) ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
      })),
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
      employeeEmailSet,
    );

    classifiedThreads.push({
      threadId: skipInfo.tid,
      classification,
      profileType,
      confidence: classification === 'unknown' ? 0.5 : 0.75,
      messages: messages.map((m: { from: string; fromName: string; to: string[]; subject: string; bodyText: string; snippet: string; date: Date }) => ({
        from: (m.from || '').toLowerCase(),
        fromName: m.fromName || '',
        to: (m.to || []).map((t: string) => t.toLowerCase()),
        subject: m.subject || '',
        bodyText: m.bodyText || m.snippet || '',
        date: m.date instanceof Date ? m.date.toISOString() : String(m.date),
        direction: ((m.from || '').toLowerCase().includes(ownerEmail) ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
      })),
    });
  }

  console.log(`[analyze-memory] Classified ${classifiedThreads.length} threads (${classifiedThreads.filter(t => t.classification === 'client').length} client, ${classifiedThreads.filter(t => t.classification === 'vendor').length} vendor, ${classifiedThreads.filter(t => t.classification === 'subtrade').length} subtrade, ${classifiedThreads.filter(t => t.classification === 'internal').length} internal, ${classifiedThreads.filter(t => t.classification === 'unknown').length} unknown)`);

  // ─── 7. Run MemoryService orchestrator ───────────────────────────────────
  setSupabaseOverride(supabase);
  let stats;
  try {
    stats = await MemoryService.processImportBatch(
      companyId,
      userId,
      ownerEmail,
      employeeEmailSet,
      classifiedThreads,
    );
  } finally {
    setSupabaseOverride(null);
  }

  // ─── 8. Save completion stats to job result ──────────────────────────────
  const processingTimeMs = Date.now() - startTime;
  await supabase
    .from("gmail_scan_jobs")
    .update({
      result: {
        ...result,
        phaseCComplete: true,
        phaseCStats: {
          ...stats,
          processingTimeMs,
          threadsProcessed: classifiedThreads.length,
        },
      },
    })
    .eq("id", jobId);

  // ─── 9. Fire completion notification ─────────────────────────────────────
  const totalDataPoints = stats.factsExtracted + stats.entitiesCreated + stats.edgesCreated;
  await supabase.from("notifications").insert({
    user_id: userId,
    company_id: companyId,
    type: 'mention',
    title: 'Indexing complete',
    body: `${totalDataPoints} data points captured`,
    is_read: false,
    persistent: false,
    action_url: '/settings',
    action_label: 'View Details',
  });

  console.log(`[analyze-memory] Phase C complete in ${(processingTimeMs / 1000).toFixed(1)}s — ${stats.factsExtracted} facts, ${stats.entitiesCreated} entities, ${stats.edgesCreated} edges, ${stats.profilesBuilt} profiles`);
}
