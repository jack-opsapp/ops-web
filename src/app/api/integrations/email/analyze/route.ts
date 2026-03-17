/**
 * OPS Web - Email Analyze Endpoint (Phase A)
 *
 * POST /api/integrations/email/analyze
 * Kicks off inbox analysis — pattern detection + AI classification + lead building.
 * Returns a jobId for polling via analyze-status.
 *
 * Architecture: Two-phase chained execution (each gets its own 800s budget).
 *
 * Phase A (this file):
 * 1. Pattern detection identifies known sources (estimate threads, platforms, forwarders)
 * 2. All emails are grouped by threadId into thread summaries
 * 3. Pattern-matched threads become leads DIRECTLY (no AI needed)
 * 4. Non-pattern threads are sent to AI as thread summaries (not individual emails)
 * 5. Leads are built with client info extraction (including form body AI extraction)
 * → Saves intermediate AnalyzedLead[] to job.result, chains to Phase B
 *
 * Phase B (/api/integrations/email/analyze-continue):
 * 6. Full thread content fetched for AI-classified leads (stage refinement)
 * 7. Hard-filter invalid leads (null, owner, employee, company domain, platform)
 * 8. Deduplicate leads by client email
 * 9. AI validation pass (approve/reject with company context)
 * → Saves final results
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
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
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

export const maxDuration = 800; // Pro plan max

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
  // If there's a running job for this connection less than 5 min old, return it.
  // Jobs older than 5 min are considered stale/dead (Vercel killed the function).
  const STALE_THRESHOLD_MS = 5 * 60 * 1000;
  const { data: existingJobs } = await supabase
    .from("gmail_scan_jobs")
    .select("id, status, created_at")
    .eq("connection_id", connectionId)
    .in("status", ["pending", "analyzing_sent", "detecting_platforms", "classifying_ai", "analyzing_threads", "building_leads"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingJobs && existingJobs.length > 0) {
    const jobAge = Date.now() - new Date(existingJobs[0].created_at).getTime();
    if (jobAge < STALE_THRESHOLD_MS) {
      // Job is still fresh — reconnect to it
      return NextResponse.json({ jobId: existingJobs[0].id });
    }
    // Job is stale — mark it as error and create a new one
    console.log(`[email-analyze] Stale job ${existingJobs[0].id} (${Math.round(jobAge / 1000)}s old), marking as error`);
    await supabase.from("gmail_scan_jobs").update({
      status: "error",
      error_message: "Timed out — function exceeded max duration",
    }).eq("id", existingJobs[0].id);
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

  // Run Phase A (pattern detection + AI classification) in background.
  // When Phase A completes, it saves intermediate data and chains to
  // /api/integrations/email/analyze-continue for Phase B (lead building + validation).
  // Each phase gets its own 800s budget.
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    setSupabaseOverride(bgSupabase);
    try {
      await runPhaseA(job.id, connection, companyId, connectionId, bgSupabase);
    } catch (err) {
      console.error("[email-analyze] Phase A failed:", err);
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

async function runPhaseA(
  jobId: string,
  connection: EmailConnection,
  companyId: string,
  connectionId: string,
  supabase: SupabaseClient
) {
  // Track discovered lead names — streamed to the client for fading display
  const discoveredLeadNames: string[] = [];

  const updateProgress = async (
    stage: string,
    message: string,
    percent: number
  ) => {
    await supabase
      .from("gmail_scan_jobs")
      .update({
        status: stage,
        progress: { stage, message, percent, discoveredLeadNames: discoveredLeadNames.slice(-12) },
      })
      .eq("id", jobId);
  };

  // ─── Phase 1: Pattern detection ──────────────────────────────────────────
  await updateProgress("analyzing_sent", "Scanning your inbox and sent mail...", 5);

  const detection = await PatternDetectionService.detect(connection, {
    monthsBack: 3,
  });

  const totalEmails = detection.allInboxEmails.length + detection.allSentEmails.length;
  await updateProgress(
    "detecting_platforms",
    `Scanned ${totalEmails} emails. Found ${detection.detectedSources.length} lead sources. Mapping threads...`,
    20
  );

  // ─── Phase 2: Build thread map from ALL inbox + sent emails ──────────────
  // Merge inbox and sent emails to get complete thread picture.
  // Without sent emails, we can't find who the owner sent estimates TO.
  const allEmails = [...detection.allInboxEmails, ...detection.allSentEmails];
  const validEmails = allEmails.filter(
    (e) => e.threadId && e.threadId !== "undefined" && e.threadId !== "null"
  );
  console.log(`[email-analyze] Phase 2: ${detection.allInboxEmails.length} inbox + ${detection.allSentEmails.length} sent = ${validEmails.length} valid emails`);

  // Determine owner email — fall back to detecting it from sent mail if connection.email is empty
  let ownerEmailLower = safe(connection.email);
  if (!ownerEmailLower && detection.allSentEmails.length > 0) {
    // The FROM address of sent emails IS the owner
    const firstSentFrom = detection.allSentEmails[0].from;
    const match = firstSentFrom.match(/<([^>]+)>/);
    ownerEmailLower = (match ? match[1] : firstSentFrom).toLowerCase().trim();
    console.log(`[email-analyze] Owner email was empty on connection — detected from sent mail: ${ownerEmailLower}`);
    // Also fix the connection so future runs don't hit this
    await supabase.from("email_connections").update({ email: ownerEmailLower }).eq("id", connectionId);
  }
  if (!ownerEmailLower) {
    console.error("[email-analyze] CRITICAL: Cannot determine owner email — results will be unreliable");
  }

  // ─── Build company domain set ─────────────────────────────────────────────
  // Include: pattern detection domains + employee email domains + company name match
  const companyDomainSet = new Set(detection.companyDomains.map((d) => d.toLowerCase()));

  // Add domains from employee emails (users table)
  const { data: companyUsers } = await supabase
    .from("users")
    .select("email, first_name, last_name")
    .eq("company_id", companyId);

  const employeeEmailSet = new Set<string>();
  const employeeNameSet = new Set<string>();
  for (const u of (companyUsers || [])) {
    if (u.email) employeeEmailSet.add(u.email.toLowerCase().trim());
    const fullName = `${(u.first_name || '').trim()} ${(u.last_name || '').trim()}`.trim().toLowerCase();
    if (fullName) employeeNameSet.add(fullName);
  }

  // Fetch company info (needed for domain matching and AI context)
  const { data: company } = await supabase
    .from("companies")
    .select("name, industry")
    .eq("id", companyId)
    .single();

  // Scan all emails for non-public domains that match the company name
  // e.g., company "Canpro Deck and Rail" → domain "canprodeckandrail.com"
  const companyNameLower = (company?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (companyNameLower.length >= 4) {
    const allDomains = new Set<string>();
    for (const email of validEmails) {
      for (const addr of [email.from, ...email.to, ...email.cc]) {
        const cleaned = (addr.match(/<([^>]+)>/)?.[1] || addr).toLowerCase().trim();
        const domain = cleaned.split('@')[1];
        if (domain) allDomains.add(domain);
      }
    }
    for (const domain of allDomains) {
      const domainClean = domain.replace(/[^a-z0-9]/g, '');
      if (domainClean.includes(companyNameLower) || companyNameLower.includes(domainClean.replace(/\.(com|ca|net|org)$/g, ''))) {
        if (!PUBLIC_EMAIL_DOMAINS.has(domain)) {
          companyDomainSet.add(domain);
          console.log(`[email-analyze] Detected company domain from name match: ${domain}`);
        }
      }
    }
  }

  console.log(`[email-analyze] Company domains: [${[...companyDomainSet].join(', ')}], Employee emails: ${employeeEmailSet.size}, Employee names: ${employeeNameSet.size}`);
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
    35
  );

  // Build thread summary inputs for AI — send ALL unmatched threads
  // Include up to 6 email excerpts per thread (3 client + 3 owner) for accurate classification
  const threadSummaryInputs: ThreadSummaryInput[] = unmatchedThreads.map((t) => {
    // Sort emails by date descending (most recent first)
    const sorted = [...t.emails].sort((a, b) => b.date.getTime() - a.date.getTime());

    // Split into client (inbound) and owner (outbound) emails
    const clientEmails = sorted.filter((e) => !safe(e.from).includes(ownerEmailLower));
    const ownerEmails = sorted.filter((e) => safe(e.from).includes(ownerEmailLower));

    // Take up to 3 of each, most recent first
    const excerpts = [
      ...clientEmails.slice(0, 3),
      ...ownerEmails.slice(0, 3),
    ].sort((a, b) => a.date.getTime() - b.date.getTime()); // chronological for the AI

    return {
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
      emailExcerpts: excerpts.map((e) => ({
        from: e.from,
        fromName: e.fromName,
        to: e.to,
        date: e.date.toISOString(),
        direction: (safe(e.from).includes(ownerEmailLower) ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
        body: (e.bodyText || e.snippet || '').slice(0, 2000),
      })),
    };
  });

  const aiClassifications = await EmailAIClassifier.classifyThreadBatch(
    threadSummaryInputs,
    {
      companyName: company?.name || "",
      industry: (company?.industry as string) || "trades",
      ownerEmail: connection.email,
      companyDomains: detection.companyDomains,
    },
    // Granular progress: smoothly updates from 35% to 65% as AI processes batches
    // Also collects discovered lead names for the fading UI display
    async (processed, total, batchResults) => {
      const aiProgress = 35 + Math.round((processed / total) * 30);
      for (const c of batchResults) {
        if (c.verdict === 'lead' && c.client?.name && !discoveredLeadNames.includes(c.client.name)) {
          discoveredLeadNames.push(c.client.name);
        }
      }
      await updateProgress(
        "classifying_ai",
        `AI classified ${processed} of ${total} threads...`,
        aiProgress
      );
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

  await updateProgress(
    "analyzing_threads",
    `Extracting client info from ${leadThreads.length} lead threads...`,
    75
  );

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

  // ─── Phase 7: Build AnalyzedLead[] (without full thread analysis — that's Phase B) ─
  await updateProgress(
    "building_leads",
    "Building leads...",
    70
  );

  const leads: AnalyzedLead[] = [];

  for (const { thread, source, aiClassification } of leadThreads) {
    // Determine the client email (who is NOT the owner)
    // cleanEmailAddress strips "Name <email>" format so we always store clean addresses
    const clientEmail = cleanEmailAddress(
      findClientEmail(thread, ownerEmailLower, companyDomainSet, formExtractionMap)
    );
    const clientName = aiClassification?.client?.name
      || findClientName(thread, ownerEmailLower, companyDomainSet, formExtractionMap, clientEmail, employeeEmailSet);

    // Determine stage — AI leads use aiClassification stage, pattern leads use correspondence heuristics.
    // Phase B will refine AI lead stages via full thread fetch + analyzeThreads.
    let stage: string;
    let stageConfidence: number;
    let estimatedValue: number | null = null;

    if (source === 'ai' && aiClassification) {
      stage = sanitizeStage(aiClassification.stage);
      stageConfidence = aiClassification.confidence;
      estimatedValue = aiClassification.estimatedValue;
    } else {
      // Pattern-matched leads: use correspondence-based heuristics
      stage = correspondenceBasedStage(thread);
      stageConfidence = 0.7;
    }

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

    // ─── Build sub-contacts list ────────────────────────────────────────────
    // Combine AI-detected additional contacts + same-domain participant grouping
    const subContacts: Array<{ name: string; email: string; phone: string | null }> = [];
    const primaryEmailLower = clientEmail.toLowerCase();

    // 1. AI-detected additional contacts
    if (aiClassification?.additionalContacts?.length) {
      for (const ac of aiClassification.additionalContacts) {
        const acEmail = cleanEmailAddress(ac.email);
        if (acEmail && acEmail !== primaryEmailLower && acEmail !== ownerEmailLower && !isPlatformEmail(acEmail)) {
          subContacts.push({ name: ac.name, email: acEmail, phone: ac.phone || null });
        }
      }
    }

    // 2. Same-domain participant grouping — find other participants from the client's domain
    const clientDomain = primaryEmailLower.split('@')[1] || '';
    if (clientDomain && !companyDomainSet.has(clientDomain)) {
      for (const participant of thread.participants) {
        const pClean = cleanEmailAddress(participant);
        if (!pClean || pClean === primaryEmailLower || pClean === ownerEmailLower) continue;
        if (isPlatformEmail(pClean)) continue;
        const pDomain = pClean.split('@')[1] || '';
        if (pDomain === clientDomain && !subContacts.some((sc) => sc.email === pClean)) {
          // Same domain as client — likely a colleague/family member
          const pName = extractNameFromEmail(participant);
          subContacts.push({ name: pName, email: pClean, phone: null });
        }
      }
    }

    // Track discovered name for the fading UI display
    if (clientName && !discoveredLeadNames.includes(clientName)) {
      discoveredLeadNames.push(clientName);
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
            const extracted = formExtractionMap.get(thread.threadId);
            const phone = extracted?.phone || null;
            const description = extracted?.message || thread.subject;
            return { name: clientName, email: clientEmail, phone, description };
          })(),
      stage,
      stageConfidence,
      estimatedValue,
      correspondenceCount: thread.messageCount,
      outboundCount: thread.outboundCount,
      lastMessageDate: thread.dateRange.last,
      source,
      sourceLabel: SOURCE_LABELS[source] || "AI detected",
      subContacts,
      // Build email excerpts: 3 most recent from client + 3 most recent from owner
      emailExcerpts: (() => {
        const sorted = [...thread.emails].sort((a, b) => b.date.getTime() - a.date.getTime());
        const client = sorted.filter((e) => !safe(e.from).includes(ownerEmailLower)).slice(0, 3);
        const owner = sorted.filter((e) => safe(e.from).includes(ownerEmailLower)).slice(0, 3);
        return [...client, ...owner]
          .sort((a, b) => a.date.getTime() - b.date.getTime())
          .map((e) => ({
            from: e.from,
            fromName: e.fromName,
            direction: (safe(e.from).includes(ownerEmailLower) ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
            date: e.date.toISOString(),
            body: (e.bodyText || e.snippet || '').slice(0, 2000),
          }));
      })(),
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

  // ─── Save intermediate results and chain to Phase B ───────────────────────
  console.log(`[email-analyze] Phase A complete: ${leads.length} raw leads built. Saving intermediate data and chaining to Phase B...`);

  await supabase.from("gmail_scan_jobs").update({
    status: "building_leads",
    progress: { stage: "building_leads", percent: 70, message: "Building leads...", discoveredLeadNames: discoveredLeadNames.slice(-12) },
    result: {
      phase: "leads_built",
      detection: {
        estimatePattern: detection.estimatePattern,
        estimatePatternConfidence: detection.estimatePatternConfidence,
        estimateThreadCount: detection.estimateThreadCount,
        detectedSources: detection.detectedSources,
        companyDomains: [...companyDomainSet],
        teamForwarders: detection.teamForwarders,
        totalEmailsScanned: detection.totalEmailsScanned,
      },
      leads: leads, // The raw AnalyzedLead[] before filtering
      ownerEmail: ownerEmailLower,
      discoveredLeadNames,
    },
  }).eq("id", jobId);

  // Chain to Phase B — a separate function invocation with its own 800s budget
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  await fetch(`${baseUrl}/api/integrations/email/analyze-continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, connectionId, companyId }),
  });
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

/** Find the client display name — matches against the actual client email address */
function findClientName(
  thread: ThreadInfo,
  ownerEmailLower: string,
  companyDomainSet: Set<string>,
  formExtraction: Map<string, ExtractedFormClient>,
  clientEmail?: string,
  employeeEmailSet?: Set<string>
): string {
  // For forwarder/platform threads, use AI-extracted client name from the form body first.
  if (thread.patternSource === 'forwarder' || thread.patternSource === 'platform') {
    const extracted = formExtraction.get(thread.threadId);
    if (extracted?.name) return extracted.name;
  }

  const clientEmailLower = clientEmail?.toLowerCase() || '';

  // Priority 1: Find the display name from headers that match the client email exactly.
  // This prevents picking up a CC'd team member's name instead of the client's name.
  if (clientEmailLower) {
    // Check TO/CC headers of outbound emails for "Display Name <client@email.com>"
    for (const email of thread.emails) {
      if (!safe(email.from).includes(ownerEmailLower)) continue; // only outbound
      for (const addr of [...email.to, ...email.cc]) {
        const addrClean = cleanEmailAddress(addr);
        if (addrClean === clientEmailLower) {
          // Extract display name from this header
          const nameMatch = addr.match(/^"?([^"<]+)"?\s*</);
          if (nameMatch && nameMatch[1].trim()) {
            return nameMatch[1].trim();
          }
        }
      }
    }

    // Check FROM headers of inbound emails from the client
    for (const email of thread.emails) {
      const fromClean = cleanEmailAddress(email.from);
      if (fromClean === clientEmailLower && email.fromName) {
        return email.fromName;
      }
    }
  }

  // Priority 2: Find first non-owner, non-company, non-employee sender
  for (const email of thread.emails) {
    if (safe(email.from).includes(ownerEmailLower)) continue;
    const fromClean = cleanEmailAddress(email.from);
    const domain = fromClean.split('@')[1] || "";
    if (domain && companyDomainSet.has(domain)) continue;
    if (employeeEmailSet?.has(fromClean)) continue;
    if (isPlatformEmail(fromClean)) continue;
    if (email.fromName && email.fromName !== (email.from || "").split('@')[0]) {
      return email.fromName;
    }
  }

  // Fallback: extract from the client email address itself
  if (clientEmailLower) {
    return extractNameFromEmail(clientEmailLower);
  }
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

