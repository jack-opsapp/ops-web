/**
 * OPS Web - Email Analyze Endpoint
 *
 * POST /api/integrations/email/analyze
 * Kicks off inbox analysis — pattern detection + AI classification.
 * Returns a jobId for polling via analyze-status.
 *
 * Architecture: Thread-first approach.
 * 1. Pattern detection identifies known sources (estimate threads, platforms, forwarders)
 * 2. All emails are grouped by threadId into thread summaries
 * 3. Pattern-matched threads become leads DIRECTLY (no AI needed)
 * 4. Non-pattern threads are sent to AI as thread summaries (not individual emails)
 * 5. Leads are deduplicated by client email
 * 6. Full thread content is fetched for accurate stage analysis
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { PatternDetectionService } from "@/lib/api/services/pattern-detection-service";
import { EmailAIClassifier } from "@/lib/api/services/email-ai-classifier";
import { EmailMatchingServiceV2 } from "@/lib/api/services/email-matching-service-v2";
import { matchPlatform, PLATFORM_DOMAINS } from "@/lib/api/services/known-platforms";
import OpenAI from 'openai';
import type { EmailConnection } from "@/lib/types/email-connection";
import type { AnalyzedLead } from "@/lib/types/email-import";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { ThreadSummaryInput, ThreadClassificationResult } from "@/lib/api/services/email-ai-classifier";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Lazy OpenAI client ──────────────────────────────────────────────────────
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export const maxDuration = 300;

// ─── Timeout helper for thread fetches ───────────────────────────────────────

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

// ─── Valid stages for safety checks ──────────────────────────────────────────

const VALID_STAGES = ['new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up', 'negotiation'];

function sanitizeStage(stage: string | null | undefined): string {
  if (stage && VALID_STAGES.includes(stage)) return stage;
  return 'new_lead';
}

// Safe lowercase helper — Gmail messages can have null/undefined fields
const safe = (s: string | null | undefined): string => (s || "").toLowerCase();

// ─── Thread map types ────────────────────────────────────────────────────────

interface ThreadInfo {
  threadId: string;
  emails: NormalizedEmail[];
  subject: string;               // original subject (stripped of Re:/Fwd:)
  participants: string[];         // all unique email addresses
  firstSender: string;            // who initiated the thread (email)
  firstSenderName: string;        // display name of first sender
  latestSnippet: string;          // snippet of most recent message
  direction: 'inbound' | 'outbound';
  messageCount: number;
  outboundCount: number;
  hasUserReply: boolean;
  dateRange: { first: string; last: string };
  patternSource: 'estimate_pattern' | 'platform' | 'forwarder' | null;
}

export async function POST(request: NextRequest) {
  const { connectionId, companyId } = await request.json();

  if (!connectionId || !companyId) {
    return NextResponse.json(
      { error: "connectionId and companyId required" },
      { status: 400 }
    );
  }

  // Use service-role client for the initial connection lookup
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  let connection;
  try {
    connection = await EmailService.getConnection(connectionId);
  } finally {
    setSupabaseOverride(null);
  }

  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  // ─── Prevent duplicate analysis jobs ────────────────────────────────────────
  // If there's already a running job for this connection, return it instead
  const { data: existingJobs } = await supabase
    .from("gmail_scan_jobs")
    .select("id, status")
    .eq("connection_id", connectionId)
    .in("status", ["pending", "analyzing_sent", "detecting_platforms", "classifying_ai", "analyzing_threads"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingJobs && existingJobs.length > 0) {
    return NextResponse.json({ jobId: existingJobs[0].id });
  }

  // Create analysis job
  const { data: job, error } = await supabase
    .from("gmail_scan_jobs")
    .insert({
      connection_id: connectionId,
      company_id: companyId,
      status: "pending",
      progress: {
        stage: "pending",
        message: "Starting analysis...",
        percent: 0,
      },
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create analysis job" },
      { status: 500 }
    );
  }

  // ─── Persist wizard state on the connection ────────────────────────────────
  await supabase
    .from("email_connections")
    .update({
      sync_filters: {
        ...connection.syncFilters,
        wizardStep: 2,
        lastScanJobId: job.id,
        wizardCompleted: false,
        lastScanComplete: false,
      },
      status: "setup_incomplete",
    })
    .eq("id", connectionId);

  // Run analysis in background — manages its own setSupabaseOverride lifecycle
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    setSupabaseOverride(bgSupabase);
    try {
      await runAnalysis(job.id, connection, companyId, connectionId, bgSupabase);
    } catch (err) {
      console.error("[email-analyze] Analysis failed:", err);
      await bgSupabase
        .from("gmail_scan_jobs")
        .update({
          status: "error",
          error_message: (err as Error).message,
        })
        .eq("id", job.id);
    } finally {
      setSupabaseOverride(null);
    }
  });

  return NextResponse.json({ jobId: job.id });
}

async function runAnalysis(
  jobId: string,
  connection: EmailConnection,
  companyId: string,
  connectionId: string,
  supabase: SupabaseClient
) {
  const updateProgress = async (
    stage: string,
    message: string,
    percent: number
  ) => {
    await supabase
      .from("gmail_scan_jobs")
      .update({
        status: stage,
        progress: { stage, message, percent },
      })
      .eq("id", jobId);
  };

  // ─── Phase 1: Pattern detection ──────────────────────────────────────────
  await updateProgress("analyzing_sent", "Analyzing your sent emails...", 10);

  const detection = await PatternDetectionService.detect(connection, {
    monthsBack: 3,
  });

  await updateProgress(
    "detecting_platforms",
    `Found ${detection.detectedSources.length} sources. Building thread map...`,
    30
  );

  // ─── Phase 2: Build thread map from ALL inbox + sent emails ──────────────
  // Merge inbox and sent emails to get complete thread picture.
  // Without sent emails, we can't find who the owner sent estimates TO.
  const allEmails = [...detection.allInboxEmails, ...detection.allSentEmails];
  const validEmails = allEmails.filter(
    (e) => e.threadId && e.threadId !== "undefined" && e.threadId !== "null"
  );
  console.log(`[email-analyze] Phase 2: ${detection.allInboxEmails.length} inbox + ${detection.allSentEmails.length} sent = ${validEmails.length} valid emails`);

  const ownerEmailLower = safe(connection.email);
  const companyDomainSet = new Set(detection.companyDomains.map((d) => d.toLowerCase()));
  const forwarderEmailSet = new Set(detection.teamForwarders.map((f) => f.toLowerCase()));
  const estimateThreadIds = new Set(
    detection.detectedSources
      .filter((s) => s.type === 'estimate_pattern')
      .flatMap(() => {
        // Get thread IDs from emailSourceMap
        return validEmails
          .filter((e) => detection.emailSourceMap[e.id] === 'estimate_pattern')
          .map((e) => e.threadId);
      })
  );

  // Also collect all estimate-pattern thread IDs from the emailSourceMap directly
  for (const email of validEmails) {
    if (detection.emailSourceMap[email.id] === 'estimate_pattern') {
      estimateThreadIds.add(email.threadId);
    }
  }

  // Group all valid emails by threadId
  const threadMap = new Map<string, ThreadInfo>();

  for (const email of validEmails) {
    if (!threadMap.has(email.threadId)) {
      const isFromOwner = safe(email.from).includes(ownerEmailLower);
      const direction: 'inbound' | 'outbound' = isFromOwner ? 'outbound' : 'inbound';

      // Determine pattern source for this thread
      let patternSource: ThreadInfo['patternSource'] = null;
      if (estimateThreadIds.has(email.threadId)) {
        patternSource = 'estimate_pattern';
      } else if (matchPlatform(email.from)) {
        patternSource = 'platform';
      } else if (forwarderEmailSet.has(safe(email.from))) {
        patternSource = 'forwarder';
      }

      threadMap.set(email.threadId, {
        threadId: email.threadId,
        emails: [],
        subject: normalizeSubject(email.subject),
        participants: [],
        firstSender: email.from,
        firstSenderName: email.fromName,
        latestSnippet: email.snippet,
        direction,
        messageCount: 0,
        outboundCount: 0,
        hasUserReply: false,
        dateRange: {
          first: email.date.toISOString(),
          last: email.date.toISOString(),
        },
        patternSource,
      });
    }

    const thread = threadMap.get(email.threadId)!;
    thread.emails.push(email);
    thread.messageCount++;

    const isOutbound = safe(email.from).includes(ownerEmailLower);
    if (isOutbound) {
      thread.outboundCount++;
      thread.hasUserReply = true;
    }

    // Track participants
    const allAddresses = [email.from, ...email.to, ...email.cc];
    for (const addr of allAddresses) {
      const normalized = addr.toLowerCase();
      if (!thread.participants.includes(normalized)) {
        thread.participants.push(normalized);
      }
    }

    // Update date range
    const emailDate = email.date.toISOString();
    if (emailDate < thread.dateRange.first) {
      thread.dateRange.first = emailDate;
      thread.firstSender = email.from;
      thread.firstSenderName = email.fromName;
      thread.direction = isOutbound ? 'outbound' : 'inbound';
    }
    if (emailDate > thread.dateRange.last) {
      thread.dateRange.last = emailDate;
      thread.latestSnippet = email.snippet;
    }

    // If ANY email in this thread has a pattern source, mark the whole thread
    const emailSource = detection.emailSourceMap[email.id];
    if (emailSource && !thread.patternSource) {
      thread.patternSource = emailSource;
    }
  }

  console.log(`[email-analyze] Built thread map: ${threadMap.size} threads from ${validEmails.length} emails (${validEmails.length - detection.allInboxEmails.length} filtered for invalid threadId)`);

  // ─── Phase 3: Split threads into pattern-matched and unmatched ───────────
  const patternThreads: ThreadInfo[] = [];
  const unmatchedThreads: ThreadInfo[] = [];

  for (const thread of threadMap.values()) {
    // Skip threads from the owner's company domains (internal threads)
    const firstSenderDomain = safe(thread.firstSender).split('@')[1] || "";
    const isInternal = firstSenderDomain && companyDomainSet.has(firstSenderDomain)
      && !thread.patternSource; // Don't skip if it's a forwarder match

    if (isInternal && thread.direction !== 'outbound') {
      // Internal inbound from company domain and not a forwarder — skip
      continue;
    }

    if (thread.patternSource) {
      patternThreads.push(thread);
    } else {
      unmatchedThreads.push(thread);
    }
  }

  console.log(`[email-analyze] Pattern-matched threads: ${patternThreads.length}, unmatched for AI: ${unmatchedThreads.length}`);

  // ─── Phase 4: AI classification of unmatched threads ─────────────────────
  await updateProgress(
    "classifying_ai",
    `Classifying ${unmatchedThreads.length} threads with AI...`,
    50
  );

  // Fetch company info for AI context
  const { data: company } = await supabase
    .from("companies")
    .select("name, industry")
    .eq("id", companyId)
    .single();

  // Build thread summary inputs for AI
  const threadSummaryInputs: ThreadSummaryInput[] = unmatchedThreads.map((t) => ({
    threadId: t.threadId,
    subject: t.subject,
    participants: t.participants,
    messageCount: t.messageCount,
    hasUserReply: t.hasUserReply,
    latestSnippet: t.latestSnippet,
    firstSender: t.firstSender,
    firstSenderName: t.firstSenderName,
    direction: t.direction,
    dateRange: t.dateRange,
    outboundCount: t.outboundCount,
  }));

  const aiClassifications = await EmailAIClassifier.classifyThreadBatch(
    threadSummaryInputs,
    {
      companyName: company?.name || "",
      industry: (company?.industry as string) || "trades",
      ownerEmail: connection.email,
      companyDomains: detection.companyDomains,
    }
  );

  // Build a map of AI classifications by threadId
  const aiClassificationMap = new Map(
    aiClassifications.map((c) => [c.threadId, c])
  );

  // ─── Phase 5: Build leads from pattern-matched threads ───────────────────
  await updateProgress(
    "analyzing_threads",
    "Analyzing conversation threads...",
    70
  );

  const provider = EmailService.getProvider(connection);

  // Collect all lead threads: pattern-matched + AI-classified leads
  const leadThreads: Array<{
    thread: ThreadInfo;
    source: 'pattern' | 'platform' | 'forwarder' | 'ai';
    aiClassification: ThreadClassificationResult | null;
  }> = [];

  // Pattern-matched threads are AUTOMATICALLY leads (Fix 3)
  for (const thread of patternThreads) {
    const source: 'pattern' | 'platform' | 'forwarder' =
      thread.patternSource === 'estimate_pattern' ? 'pattern'
        : thread.patternSource === 'platform' ? 'platform'
          : 'forwarder';
    leadThreads.push({ thread, source, aiClassification: null });
  }

  // ─── Pre-declare formExtractionMap so Fix 4 (AI platform email re-extraction) can use it ─
  const formExtractionMap = new Map<string, ExtractedFormClient>();

  // AI-classified lead threads (confidence >= 0.5 — lowered from 0.7 since threads give better context)
  // Fix 4: If the AI's suggested client email is a platform address, attempt form extraction first.
  for (const thread of unmatchedThreads) {
    const classification = aiClassificationMap.get(thread.threadId);
    if (classification && classification.verdict === 'lead' && classification.confidence >= 0.5) {
      // Check if AI-suggested email is a platform notification address
      const aiClientEmail = cleanEmailAddress(classification.client?.email);
      if (aiClientEmail && isPlatformEmail(aiClientEmail)) {
        // AI classified this as a lead but the email is a platform address (e.g. wixforms.com).
        // Try to extract the real client from the form body.
        let extracted: ExtractedFormClient | null = null;
        for (const email of thread.emails) {
          extracted = await extractClientFromFormBody(email.bodyText || '', email.snippet);
          if (extracted) {
            formExtractionMap.set(thread.threadId, extracted);
            break;
          }
        }
        if (!extracted) {
          // Cannot extract real client — skip this lead entirely
          continue;
        }
        // Override the AI classification's client info with extracted data
        if (classification.client) {
          classification.client.email = extracted.email;
          classification.client.name = extracted.name;
          if (extracted.phone) classification.client.phone = extracted.phone;
          if (extracted.message) classification.client.description = extracted.message;
        }
      }
      leadThreads.push({ thread, source: 'ai', aiClassification: classification });
    }
  }

  console.log(`[email-analyze] Lead threads: ${leadThreads.length} (${patternThreads.length} pattern + ${leadThreads.length - patternThreads.length} AI)`);

  // ─── Phase 5b: AI-extract client info from forwarder/platform form bodies ─
  // Pre-extract all form submissions so the sync helpers can use a lookup map.
  // Runs in parallel for speed. Cost: ~$0.001 per email, < $0.05 for 30 forms.
  const formExtractionThreads = leadThreads.filter(
    (lt) => lt.source === 'forwarder' || lt.source === 'platform'
  );

  if (formExtractionThreads.length > 0) {
    console.log(`[email-analyze] Extracting client info from ${formExtractionThreads.length} form submission threads via AI...`);
    const extractionPromises = formExtractionThreads.map(async ({ thread }) => {
      // Try each email in the thread until we get a result
      for (const email of thread.emails) {
        const extracted = await extractClientFromFormBody(
          email.bodyText || '',
          email.snippet
        );
        if (extracted) {
          formExtractionMap.set(thread.threadId, extracted);
          return;
        }
      }
    });
    await Promise.all(extractionPromises);
    console.log(`[email-analyze] AI form extraction complete: ${formExtractionMap.size}/${formExtractionThreads.length} threads had extractable client info`);
  }

  // ─── Phase 6: Fetch full threads for stage analysis (cap at 20) ──────────
  // Cap at 20 to avoid Gmail API rate limits and long hangs.
  // Threads beyond the cap get correspondence-based staging (fast + free).
  const threadAnalysisInputs: Array<{
    threadId: string;
    messages: Array<{
      from: string;
      to: string[];
      subject: string;
      bodyText: string;
      date: string;
      direction: 'inbound' | 'outbound';
    }>;
  }> = [];
  const threadMessageCounts = new Map<string, number>();

  // Only fetch full threads for leads that need AI stage analysis
  // Pattern-matched threads use correspondence-based stage heuristics
  const threadsNeedingFullFetch = leadThreads
    .filter((lt) => lt.source === 'ai')
    .slice(0, 20);

  let fetchedCount = 0;
  let skippedCount = 0;

  for (const { thread } of threadsNeedingFullFetch) {
    try {
      // 10-second timeout per thread to prevent hangs on large threads or rate limits
      const fetchedMessages = await fetchWithTimeout(
        provider.fetchThread(thread.threadId),
        10_000
      );

      if (!fetchedMessages) {
        console.warn(`[email-analyze] Thread ${thread.threadId} timed out after 10s — skipping`);
        skippedCount++;
        // Rate limit pause even on timeout
        await delay(200);
        continue;
      }

      threadMessageCounts.set(thread.threadId, fetchedMessages.length);
      threadAnalysisInputs.push({
        threadId: thread.threadId,
        messages: fetchedMessages.map((m) => ({
          from: m.from,
          to: m.to,
          subject: m.subject,
          bodyText: m.bodyText,
          date: m.date.toISOString(),
          direction: (safe(m.from).includes(ownerEmailLower)
            ? "outbound"
            : "inbound") as "inbound" | "outbound",
        })),
      });
      fetchedCount++;
    } catch (err) {
      console.error(
        `[email-analyze] Failed to fetch thread ${thread.threadId}:`,
        err
      );
      skippedCount++;
    }

    // 200ms delay between fetches to avoid Gmail API rate limits
    await delay(200);
  }

  console.log(`[email-analyze] Thread fetch complete: ${fetchedCount} fetched, ${skippedCount} skipped (timeout/error), ${Math.max(0, leadThreads.filter((lt) => lt.source === 'ai').length - 20)} beyond cap`);

  const threadAnalyses = await EmailAIClassifier.analyzeThreads(
    threadAnalysisInputs,
    {
      companyName: company?.name || "",
      ownerEmail: connection.email,
    }
  );

  const threadAnalysisMap = new Map(
    threadAnalyses.map((ta) => [ta.threadId, ta])
  );

  // ─── Phase 7: Build AnalyzedLead[] ───────────────────────────────────────
  const leads: AnalyzedLead[] = [];

  for (const { thread, source, aiClassification } of leadThreads) {
    // Determine the client email (who is NOT the owner)
    // cleanEmailAddress strips "Name <email>" format so we always store clean addresses
    const clientEmail = cleanEmailAddress(
      findClientEmail(thread, ownerEmailLower, companyDomainSet, formExtractionMap)
    );
    const clientName = aiClassification?.client?.name
      || findClientName(thread, ownerEmailLower, companyDomainSet, formExtractionMap);

    // Determine stage
    let stage: string;
    let stageConfidence: number;
    let estimatedValue: number | null = null;
    const terminalFlag: 'likely_won' | 'likely_lost' | null = null;

    if (source === 'ai') {
      // AI-classified leads: use thread analysis if available, else AI classification
      const threadAnalysis = threadAnalysisMap.get(thread.threadId);
      if (threadAnalysis) {
        stage = sanitizeStage(threadAnalysis.stage);
        stageConfidence = threadAnalysis.confidence;
        estimatedValue = threadAnalysis.estimatedValue;
      } else if (aiClassification) {
        stage = sanitizeStage(aiClassification.stage);
        stageConfidence = aiClassification.confidence;
        estimatedValue = aiClassification.estimatedValue;
      } else {
        stage = correspondenceBasedStage(thread);
        stageConfidence = 0.6;
      }
    } else {
      // Pattern-matched leads: use correspondence-based heuristics (Fix 3)
      stage = correspondenceBasedStage(thread);
      stageConfidence = 0.7;
    }

    // Get actual thread message count (from fetched thread or from our emails)
    const actualThreadCount = threadMessageCounts.get(thread.threadId) || thread.messageCount;

    // Source label
    const SOURCE_LABELS: Record<string, string> = {
      pattern: "Estimate thread",
      platform: "Platform email",
      forwarder: "Forwarded lead",
      ai: "AI detected",
    };

    // Run client matching
    const matchResult = await EmailMatchingServiceV2.match(
      companyId,
      clientEmail,
      {
        name: clientName,
        threadId: thread.threadId,
        connectionId: connection.id,
      }
    );

    // Look up existing client name if matched
    let existingClientName: string | null = null;
    if (matchResult.clientId) {
      const { data: clientData } = await supabase
        .from("clients")
        .select("name")
        .eq("id", matchResult.clientId)
        .single();
      existingClientName = clientData?.name || null;
    }

    leads.push({
      id: `lead-${thread.threadId}`,
      threadId: thread.threadId,
      emails: thread.emails.map((e) => ({
        id: e.id,
        from: e.from,
        subject: e.subject,
        date: e.date.toISOString(),
        direction: safe(e.from).includes(ownerEmailLower)
          ? "outbound"
          : "inbound",
      })),
      client: aiClassification?.client
        ? {
            ...aiClassification.client,
            email: cleanEmailAddress(aiClassification.client.email),
          }
        : (() => {
            // For forwarder/platform threads, use AI-extracted phone & message from form body
            const extracted = formExtractionMap.get(thread.threadId);
            const phone = extracted?.phone || null;
            const description = extracted?.message || thread.subject;
            return { name: clientName, email: clientEmail, phone, description };
          })(),
      stage,
      stageConfidence,
      estimatedValue,
      correspondenceCount: actualThreadCount,
      outboundCount: thread.outboundCount,
      lastMessageDate: thread.dateRange.last,
      source,
      sourceLabel: SOURCE_LABELS[source] || "AI detected",
      duplicateGroupId: aiClassification?.duplicateOf?.[0] || null,
      matchResult: {
        existingClientId: matchResult.clientId,
        existingClientName,
        action: matchResult.action,
        confidence: matchResult.confidence,
      },
      enabled: true,
    });
  }

  // ─── Phase 7b: Filter out invalid leads ──────────────────────────────────
  // Fix 1: Remove leads where the client email is the owner's own email
  // Fix 5: Remove leads with null/empty email or name
  // Also filter out leads whose client email is a company domain (employee) or platform address
  const filteredLeads = leads.filter(lead => {
    const email = cleanEmailAddress(lead.client.email);
    if (!email || !lead.client.name) {
      console.log(`[filter] REMOVED (null): name=${lead.client.name}, email=${lead.client.email}`);
      return false;
    }
    if (email === ownerEmailLower) {
      console.log(`[filter] REMOVED (owner exact): ${email}`);
      return false;
    }
    const domain = email.split('@')[1] || '';
    if (companyDomainSet.has(domain)) {
      console.log(`[filter] REMOVED (company domain ${domain}): ${email}`);
      return false;
    }
    if (isPlatformEmail(email)) {
      console.log(`[filter] REMOVED (platform): ${email}`);
      return false;
    }
    return true;
  });

  console.log(`[email-analyze] Leads after filtering: ${filteredLeads.length} (${leads.length - filteredLeads.length} removed — owner/company/platform/null)`);

  // ─── Phase 8: Deduplicate leads by client email (Fix 5) ─────────────────
  const deduplicatedLeads = deduplicateLeads(filteredLeads);

  console.log(`[email-analyze] Final leads: ${deduplicatedLeads.length} (${leads.length} before dedup)`);

  await updateProgress("complete", "Analysis complete!", 100);

  // Save results
  await supabase
    .from("gmail_scan_jobs")
    .update({
      status: "complete",
      progress: { stage: "complete", message: "Analysis complete!", percent: 100 },
      result: {
        estimatePattern: detection.estimatePattern,
        estimatePatternConfidence: detection.estimatePatternConfidence,
        estimateThreadCount: detection.estimateThreadCount,
        detectedSources: detection.detectedSources,
        companyDomains: detection.companyDomains,
        teamForwarders: detection.teamForwarders,
        leads: deduplicatedLeads,
        totalScanned: detection.totalEmailsScanned,
      },
    })
    .eq("id", jobId);

  // ─── Update connection wizard state on completion ─────────────────────────
  // Fetch current sync_filters to merge (they may have been updated during analysis)
  const { data: currentConn } = await supabase
    .from("email_connections")
    .select("sync_filters")
    .eq("id", connectionId)
    .single();

  const existingFilters = (currentConn?.sync_filters as Record<string, unknown>) || {};

  await supabase
    .from("email_connections")
    .update({
      sync_filters: {
        ...existingFilters,
        wizardStep: 3,
        lastScanJobId: jobId,
        lastScanComplete: true,
      },
    })
    .eq("id", connectionId);
}

// ─── Helper functions ──────────────────────────────────────────────────────

// ─── Clean "Name <email>" format ──────────────────────────────────────────
// Gmail stores addresses as "Laura Eby <laurakeby@gmail.com>" — extract just the email part.

function cleanEmailAddress(raw: string | null | undefined): string {
  if (!raw) return '';
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).toLowerCase().trim();
}

// ─── Platform email detection ─────────────────────────────────────────────
// These are notification senders / form platforms whose addresses should NEVER
// be treated as a client email. If the only candidate address is one of these,
// we need to parse the email body for the real client info instead.
// Auto-includes all domains from the known-platforms registry so any new
// platform added there is automatically excluded.

const PLATFORM_EMAIL_PATTERNS = [
  // Hard-coded patterns that aren't just domains
  'reply-to+', 'noreply', 'no-reply', 'notifications@',
  'mailer-daemon', 'postmaster@',
  // All domains from the known-platforms registry
  ...Object.keys(PLATFORM_DOMAINS),
];

function isPlatformEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return PLATFORM_EMAIL_PATTERNS.some((p) => lower.includes(p));
}

// ─── AI-based form body extraction ────────────────────────────────────────
// Extracts structured client info from forwarded form submissions using AI.
// Every form platform (Wix, WordPress, Squarespace, Jotform, HubSpot, etc.)
// uses a different format — regex fails on most of them. Instead, we send the
// body to GPT-4o-mini to extract structured data. Cost: ~$0.001 per email.

interface ExtractedFormClient {
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
}

async function extractClientFromFormBody(
  bodyText: string,
  snippet: string
): Promise<ExtractedFormClient | null> {
  if (!bodyText && !snippet) return null;

  const text = bodyText || snippet;

  // Quick check — does this even look like a form submission?
  // Look for at least one email address in the body
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
  if (!hasEmail) return null;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extract the customer's contact information from this form submission email. Return ONLY a JSON object with: name, email, phone (null if not found), message (null if not found). If you cannot identify a customer email, return null.`
        },
        {
          role: 'user',
          content: text.slice(0, 2000) // Cap to control tokens
        }
      ],
      temperature: 0,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    if (!parsed.email || isPlatformEmail(parsed.email)) return null;

    return {
      name: parsed.name || parsed.email.split('@')[0],
      email: parsed.email.toLowerCase().trim(),
      phone: parsed.phone || null,
      message: parsed.message || null,
    };
  } catch {
    return null;
  }
}

/** Determine pipeline stage from correspondence counts (for pattern-matched threads) */
function correspondenceBasedStage(thread: ThreadInfo): string {
  const { outboundCount, messageCount, dateRange, hasUserReply } = thread;

  // Check if the thread is dormant (last message > 5 days ago)
  const lastMessageDate = new Date(dateRange.last);
  const daysSinceLastMessage = (Date.now() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24);

  if (outboundCount === 0) return 'new_lead';
  if (hasUserReply && daysSinceLastMessage > 5) return 'follow_up';
  if (outboundCount >= 3 && messageCount >= 6) return 'quoted';
  if (outboundCount >= 2 && messageCount >= 4) return 'quoting';
  if (outboundCount === 1 && messageCount <= 3) return 'qualifying';
  return 'qualifying';
}

/** Find the primary client email from a thread (not the owner, not company domain) */
function findClientEmail(
  thread: ThreadInfo,
  ownerEmailLower: string,
  companyDomainSet: Set<string>,
  formExtraction: Map<string, ExtractedFormClient>
): string {
  // For forwarder threads, use AI-extracted client info from the form body first.
  // Forwarded form submissions (e.g. Wix) have the real client email in the body,
  // while the "from" / "reply-to" headers point to platform notification addresses.
  if (thread.patternSource === 'forwarder' || thread.patternSource === 'platform') {
    const extracted = formExtraction.get(thread.threadId);
    if (extracted?.email) return cleanEmailAddress(extracted.email);
  }

  console.log(`[findClientEmail] Thread ${thread.threadId} (source: ${thread.patternSource}): ${thread.participants.length} participants, ${thread.emails.length} emails`);

  // For estimate threads, the client is the RECIPIENT of the owner's outbound email.
  // Check 'to' addresses from outbound emails first.
  for (const email of thread.emails) {
    if (!safe(email.from).includes(ownerEmailLower)) continue; // only outbound emails
    for (const toAddr of email.to) {
      const cleaned = cleanEmailAddress(toAddr);
      if (!cleaned) continue;
      if (cleaned.includes(ownerEmailLower)) continue;
      const domain = cleaned.split('@')[1] || "";
      if (domain && companyDomainSet.has(domain)) continue;
      if (isPlatformEmail(cleaned)) continue;
      console.log(`[findClientEmail] → Found via outbound 'to': ${cleaned}`);
      return cleaned;
    }
  }

  // Then look through all participants for someone who isn't the owner or company
  for (const participant of thread.participants) {
    const cleaned = cleanEmailAddress(participant);
    if (!cleaned) continue;
    if (cleaned.includes(ownerEmailLower)) continue;
    const domain = cleaned.split('@')[1] || "";
    if (domain && companyDomainSet.has(domain)) continue;
    if (isPlatformEmail(cleaned)) continue;
    console.log(`[findClientEmail] → Found via participant: ${cleaned}`);
    return cleaned;
  }

  // Then check inbound email senders
  for (const email of thread.emails) {
    if (safe(email.from).includes(ownerEmailLower)) continue; // skip outbound
    const cleaned = cleanEmailAddress(email.from);
    if (!cleaned) continue;
    const domain = cleaned.split('@')[1] || "";
    if (domain && companyDomainSet.has(domain)) continue;
    if (isPlatformEmail(cleaned)) continue;
    console.log(`[findClientEmail] → Found via inbound sender: ${cleaned}`);
    return cleaned;
  }

  // Last resort: return empty (will be filtered out)
  console.log(`[findClientEmail] → FAILED to find client email. Participants: ${thread.participants.map(p => cleanEmailAddress(p)).join(', ')}`);
  return '';
}

/** Find the client display name from thread participants */
function findClientName(
  thread: ThreadInfo,
  ownerEmailLower: string,
  companyDomainSet: Set<string>,
  formExtraction: Map<string, ExtractedFormClient>
): string {
  // For forwarder/platform threads, use AI-extracted client name from the form body first.
  if (thread.patternSource === 'forwarder' || thread.patternSource === 'platform') {
    const extracted = formExtraction.get(thread.threadId);
    if (extracted?.name) return extracted.name;
  }

  // Find the first non-owner, non-company, non-platform email and extract name
  for (const email of thread.emails) {
    if (safe(email.from).includes(ownerEmailLower)) continue;
    const domain = safe(email.from).split('@')[1] || "";
    if (domain && companyDomainSet.has(domain)) continue;
    // Skip platform senders — their fromName is e.g. "Wix Forms" not a client name
    const emailMatch = email.from.match(/<([^>]+)>/);
    const cleanEmail = emailMatch ? emailMatch[1] : email.from;
    if (isPlatformEmail(cleanEmail)) continue;
    if (email.fromName && email.fromName !== (email.from || "").split('@')[0]) {
      return email.fromName;
    }
  }
  // Fallback: extract from first sender
  return extractNameFromEmail(thread.firstSender);
}

/** Extract a display name from an email address like "john.smith@example.com" -> "John Smith" */
function extractNameFromEmail(email: string): string {
  // Check for "Name <email>" format
  const nameMatch = email.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) return nameMatch[1].trim();

  const localPart = email.split("@")[0] || email;
  return localPart
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Normalize a subject line: strip Re:, Fwd:, and extra whitespace */
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(re|fwd|fw)\s*:\s*/gi, '')
    .replace(/^(re|fwd|fw)\s*:\s*/gi, '')
    .trim();
}

/** Deduplicate leads by client email — merge leads from the same client (Fix 5) */
function deduplicateLeads(leads: AnalyzedLead[]): AnalyzedLead[] {
  const byClientEmail = new Map<string, AnalyzedLead[]>();

  for (const lead of leads) {
    const normalizedEmail = cleanEmailAddress(lead.client.email);

    if (!byClientEmail.has(normalizedEmail)) {
      byClientEmail.set(normalizedEmail, []);
    }
    byClientEmail.get(normalizedEmail)!.push(lead);
  }

  const deduplicated: AnalyzedLead[] = [];

  for (const [, group] of byClientEmail) {
    if (group.length === 1) {
      deduplicated.push(group[0]);
      continue;
    }

    // Multiple leads with the same client email — merge them
    // Keep the one with the most correspondence, merge the rest into it
    group.sort((a, b) => b.correspondenceCount - a.correspondenceCount);
    const primary = { ...group[0] };

    // Sum correspondence counts and merge emails from other leads
    for (let i = 1; i < group.length; i++) {
      const other = group[i];
      primary.correspondenceCount += other.correspondenceCount;
      primary.outboundCount += other.outboundCount;
      primary.emails = [...primary.emails, ...other.emails];

      // If the other lead has a higher value, use it
      if (other.estimatedValue && (!primary.estimatedValue || other.estimatedValue > primary.estimatedValue)) {
        primary.estimatedValue = other.estimatedValue;
      }

      // Use the later date
      if (other.lastMessageDate > primary.lastMessageDate) {
        primary.lastMessageDate = other.lastMessageDate;
      }
    }

    // Update the ID to reflect it's a merged lead
    primary.duplicateGroupId = group.map((g) => g.threadId).join(',');

    deduplicated.push(primary);
  }

  return deduplicated;
}
