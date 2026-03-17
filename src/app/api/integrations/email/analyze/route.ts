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
import { matchPlatform } from "@/lib/api/services/known-platforms";
import type { EmailConnection } from "@/lib/types/email-connection";
import type { AnalyzedLead } from "@/lib/types/email-import";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { ThreadSummaryInput, ThreadClassificationResult } from "@/lib/api/services/email-ai-classifier";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

// ─── Valid stages for safety checks ──────────────────────────────────────────

const VALID_STAGES = ['new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up', 'negotiation'];

function sanitizeStage(stage: string | null | undefined): string {
  if (stage && VALID_STAGES.includes(stage)) return stage;
  return 'new_lead';
}

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

  // Run analysis in background — manages its own setSupabaseOverride lifecycle
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    setSupabaseOverride(bgSupabase);
    try {
      await runAnalysis(job.id, connection, companyId, bgSupabase);
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

  // ─── Phase 2: Build thread map from ALL inbox emails ─────────────────────
  // Filter out emails with no valid threadId (Fix 6)
  const validEmails = detection.allInboxEmails.filter(
    (e) => e.threadId && e.threadId !== "undefined" && e.threadId !== "null"
  );

  const ownerEmailLower = connection.email.toLowerCase();
  const companyDomainSet = new Set(detection.companyDomains.map((d) => d.toLowerCase()));
  const forwarderEmailSet = new Set(detection.teamForwarders.map((f) => f.toLowerCase()));
  const estimateThreadIds = new Set(
    detection.detectedSources
      .filter((s) => s.type === 'estimate_pattern')
      .flatMap((s) => {
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
      const isFromOwner = email.from.toLowerCase().includes(ownerEmailLower);
      const direction: 'inbound' | 'outbound' = isFromOwner ? 'outbound' : 'inbound';

      // Determine pattern source for this thread
      let patternSource: ThreadInfo['patternSource'] = null;
      if (estimateThreadIds.has(email.threadId)) {
        patternSource = 'estimate_pattern';
      } else if (matchPlatform(email.from)) {
        patternSource = 'platform';
      } else if (forwarderEmailSet.has(email.from.toLowerCase())) {
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

    const isOutbound = email.from.toLowerCase().includes(ownerEmailLower);
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
    const firstSenderDomain = thread.firstSender.split('@')[1]?.toLowerCase();
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

  // AI-classified lead threads (confidence >= 0.5 — lowered from 0.7 since threads give better context)
  for (const thread of unmatchedThreads) {
    const classification = aiClassificationMap.get(thread.threadId);
    if (classification && classification.verdict === 'lead' && classification.confidence >= 0.5) {
      leadThreads.push({ thread, source: 'ai', aiClassification: classification });
    }
  }

  console.log(`[email-analyze] Lead threads: ${leadThreads.length} (${patternThreads.length} pattern + ${leadThreads.length - patternThreads.length} AI)`);

  // ─── Phase 6: Fetch full threads for stage analysis (cap at 100) ─────────
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
    .slice(0, 100);

  for (const { thread } of threadsNeedingFullFetch) {
    try {
      const fetchedMessages = await provider.fetchThread(thread.threadId);
      threadMessageCounts.set(thread.threadId, fetchedMessages.length);
      threadAnalysisInputs.push({
        threadId: thread.threadId,
        messages: fetchedMessages.map((m) => ({
          from: m.from,
          to: m.to,
          subject: m.subject,
          bodyText: m.bodyText,
          date: m.date.toISOString(),
          direction: (m.from.toLowerCase().includes(ownerEmailLower)
            ? "outbound"
            : "inbound") as "inbound" | "outbound",
        })),
      });
    } catch (err) {
      console.error(
        `[email-analyze] Failed to fetch thread ${thread.threadId}:`,
        err
      );
    }
  }

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
    const clientEmail = findClientEmail(thread, ownerEmailLower, companyDomainSet);
    const clientName = aiClassification?.client?.name
      || findClientName(thread, ownerEmailLower, companyDomainSet);

    // Determine stage
    let stage: string;
    let stageConfidence: number;
    let estimatedValue: number | null = null;
    let terminalFlag: 'likely_won' | 'likely_lost' | null = null;

    if (source === 'ai') {
      // AI-classified leads: use thread analysis if available, else AI classification
      const threadAnalysis = threadAnalysisMap.get(thread.threadId);
      if (threadAnalysis) {
        stage = sanitizeStage(threadAnalysis.stage);
        stageConfidence = threadAnalysis.confidence;
        estimatedValue = threadAnalysis.estimatedValue;
        terminalFlag = threadAnalysis.terminalFlag;
      } else if (aiClassification) {
        stage = sanitizeStage(aiClassification.stage);
        stageConfidence = aiClassification.confidence;
        estimatedValue = aiClassification.estimatedValue;
        terminalFlag = aiClassification.terminalFlag;
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
        direction: e.from.toLowerCase().includes(ownerEmailLower)
          ? "outbound"
          : "inbound",
      })),
      client: aiClassification?.client || {
        name: clientName,
        email: clientEmail,
        phone: null,
        description: thread.subject,
      },
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

  // ─── Phase 8: Deduplicate leads by client email (Fix 5) ─────────────────
  const deduplicatedLeads = deduplicateLeads(leads);

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
}

// ─── Helper functions ──────────────────────────────────────────────────────

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
  companyDomainSet: Set<string>
): string {
  // Look through participants for someone who isn't the owner or from a company domain
  for (const participant of thread.participants) {
    if (participant.includes(ownerEmailLower)) continue;
    const domain = participant.split('@')[1]?.toLowerCase();
    if (domain && companyDomainSet.has(domain)) continue;
    // Extract just the email address if it contains a name like "John Smith <john@example.com>"
    const emailMatch = participant.match(/<([^>]+)>/);
    return emailMatch ? emailMatch[1] : participant;
  }
  // Fallback: use the first sender if they're not the owner
  if (!thread.firstSender.toLowerCase().includes(ownerEmailLower)) {
    const emailMatch = thread.firstSender.match(/<([^>]+)>/);
    return emailMatch ? emailMatch[1] : thread.firstSender;
  }
  return thread.firstSender;
}

/** Find the client display name from thread participants */
function findClientName(
  thread: ThreadInfo,
  ownerEmailLower: string,
  companyDomainSet: Set<string>
): string {
  // Find the first non-owner, non-company email and extract name
  for (const email of thread.emails) {
    if (email.from.toLowerCase().includes(ownerEmailLower)) continue;
    const domain = email.from.split('@')[1]?.toLowerCase();
    if (domain && companyDomainSet.has(domain)) continue;
    if (email.fromName && email.fromName !== email.from.split('@')[0]) {
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
    const clientEmail = lead.client.email.toLowerCase().trim();
    // Also handle "Name <email>" format
    const emailMatch = clientEmail.match(/<([^>]+)>/);
    const normalizedEmail = emailMatch ? emailMatch[1] : clientEmail;

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
