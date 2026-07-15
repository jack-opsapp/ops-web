/**
 * OPS Web - Email Analyze Endpoint (Phase A)
 *
 * POST /api/integrations/email/analyze
 * Kicks off inbox analysis — pattern detection + AI triage + lightweight lead building.
 * Returns a jobId for polling via analyze-status.
 *
 * Architecture: Two-phase chained execution (each gets its own 800s budget).
 * Two focused AI passes: cheap triage (lead or not?) then deep extraction (everything).
 *
 * Phase A (this file):
 * 1. Pattern detection identifies known sources (estimate threads, platforms, forwarders)
 * 2. All emails are grouped by threadId into thread summaries
 * 3. Pattern-matched threads become leads DIRECTLY (no AI needed)
 * 4. AI TRIAGE: unmatched threads → lead/not_lead verdict (last 3 msgs, full body, cheap)
 * 5. Lightweight lead building with fallback names + correspondence-based stages
 * → Saves lightweight AnalyzedLead[] to job.result, chains to Phase B
 *
 * Phase B (/api/integrations/email/analyze-continue):
 * 5. Full thread fetch for ALL confirmed leads (no cap)
 * 6. DEEP AI EXTRACTION: last 6 msgs, full body → names, stages, contacts, company names
 * 7. Hard-filter invalid leads + remove AI-flagged non-leads
 * 8. Deduplicate leads by client email
 * → Saves final results
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { PatternDetectionService } from "@/lib/api/services/pattern-detection-service";
import {
  EmailAIClassifier,
  stripQuotedContent,
} from "@/lib/api/services/email-ai-classifier";
import { EmailMatchingServiceV2 } from "@/lib/api/services/email-matching-service-v2";
import {
  matchPlatform,
  PLATFORM_DOMAINS,
} from "@/lib/api/services/known-platforms";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import { getImportOpenAI } from "@/lib/api/services/openai-clients";
import { extractContactFormSubmission } from "@/lib/utils/email-parsing";
import {
  buildLeadRoutingIdentity,
  resolvePersistedEmailDirection,
} from "@/lib/email/email-ingestion-routing";
import type { EmailConnection } from "@/lib/types/email-connection";
import type { AnalyzedLead } from "@/lib/types/email-import";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { TriageInput } from "@/lib/api/services/email-ai-classifier";
import { getAppUrl } from "@/lib/utils/app-url";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emailPipelineAuthorizationHeaders,
  requireEmailCompanyAccess,
} from "@/lib/email/email-route-auth";

// Uses OPENAI_API_KEY_IMPORT — initial inbox scan.
function getOpenAI() {
  return getImportOpenAI();
}

export const maxDuration = 800; // Pro plan max

// ─── Valid stages for safety checks ──────────────────────────────────────────

// Safe lowercase helper — Gmail messages can have null/undefined fields
const safe = (s: string | null | undefined): string => (s || "").toLowerCase();

// ─── Thread map types ────────────────────────────────────────────────────────

interface ThreadInfo {
  /** Logical lead key. Form submissions are message-scoped. */
  threadId: string;
  /** Raw provider thread used only for mailbox operations and ordinary replies. */
  providerThreadId: string;
  mayInheritProviderThread: boolean;
  emails: NormalizedEmail[];
  subject: string; // original subject (stripped of Re:/Fwd:)
  participants: string[]; // all unique email addresses
  firstSender: string; // who initiated the thread (email)
  firstSenderName: string; // display name of first sender
  latestSnippet: string; // snippet of most recent message
  direction: "inbound" | "outbound";
  messageCount: number;
  outboundCount: number;
  hasUserReply: boolean;
  dateRange: { first: string; last: string };
  patternSource: "estimate_pattern" | "platform" | "forwarder" | null;
}

export async function POST(request: NextRequest) {
  const { connectionId, companyId } = await request.json();

  if (!connectionId || !companyId) {
    return NextResponse.json(
      { error: "connectionId and companyId required" },
      { status: 400 }
    );
  }

  const authError = await requireEmailCompanyAccess(request, companyId);
  if (authError) return authError;

  // Use service-role client for the initial connection lookup. The ALS
  // binding survives across awaits without colliding with concurrent requests.
  const supabase = getServiceRoleClient();
  const connection = await runWithSupabase(supabase, () =>
    EmailService.getConnection(connectionId)
  );

  if (!connection || connection.companyId !== companyId) {
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
    .in("status", [
      "pending",
      "analyzing_sent",
      "detecting_platforms",
      "classifying_ai",
      "analyzing_threads",
      "building_leads",
    ])
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingJobs && existingJobs.length > 0) {
    const jobAge = Date.now() - new Date(existingJobs[0].created_at).getTime();
    if (jobAge < STALE_THRESHOLD_MS) {
      // Job is still fresh — reconnect to it
      return NextResponse.json({ jobId: existingJobs[0].id });
    }
    // Job is stale — mark it as error and create a new one
    console.log(
      `[email-analyze] Stale job ${existingJobs[0].id} (${Math.round(jobAge / 1000)}s old), marking as error`
    );
    await supabase
      .from("gmail_scan_jobs")
      .update({
        status: "error",
        error_message: "Timed out — function exceeded max duration",
      })
      .eq("id", existingJobs[0].id);
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
  // Each phase gets its own 800s budget. runWithSupabase binds the
  // service-role client to this async chain so nested requireSupabase() calls
  // can't be clobbered by concurrent request handlers.
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    await runWithSupabase(bgSupabase, async () => {
      try {
        await runPhaseA(
          job.id,
          connection,
          companyId,
          connectionId,
          bgSupabase
        );
      } catch (err) {
        console.error("[email-analyze] Phase A failed:", err);
        await bgSupabase
          .from("gmail_scan_jobs")
          .update({
            status: "error",
            error_message: (err as Error).message,
          })
          .eq("id", job.id);
      }
    });
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
        progress: {
          stage,
          message,
          percent,
          discoveredLeadNames: discoveredLeadNames.slice(-12),
        },
      })
      .eq("id", jobId);
  };

  // ─── Phase 1: Pattern detection ──────────────────────────────────────────
  await updateProgress(
    "analyzing_sent",
    "Scanning your inbox and sent mail...",
    5
  );

  const detection = await PatternDetectionService.detect(connection, {
    monthsBack: 3,
  });

  const totalEmails =
    detection.allInboxEmails.length + detection.allSentEmails.length;
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
  console.log(
    `[email-analyze] Phase 2: ${detection.allInboxEmails.length} inbox + ${detection.allSentEmails.length} sent = ${validEmails.length} valid emails`
  );

  // Determine owner email — fall back to detecting it from sent mail if connection.email is empty
  let ownerEmailLower = safe(connection.email);
  if (!ownerEmailLower && detection.allSentEmails.length > 0) {
    // The FROM address of sent emails IS the owner
    const firstSentFrom = detection.allSentEmails[0].from;
    const match = firstSentFrom.match(/<([^>]+)>/);
    ownerEmailLower = (match ? match[1] : firstSentFrom).toLowerCase().trim();
    console.log(
      `[email-analyze] Owner email was empty on connection — detected from sent mail: ${ownerEmailLower}`
    );
    // Also fix the connection so future runs don't hit this
    await supabase
      .from("email_connections")
      .update({ email: ownerEmailLower })
      .eq("id", connectionId);
  }
  if (!ownerEmailLower) {
    console.error(
      "[email-analyze] CRITICAL: Cannot determine owner email — results will be unreliable"
    );
  }

  // ─── Build company domain set ─────────────────────────────────────────────
  // Include: pattern detection domains + employee email domains + company name match
  const companyDomainSet = new Set(
    detection.companyDomains.map((d) => d.toLowerCase())
  );

  // Add domains from employee emails (users table)
  const { data: companyUsers } = await supabase
    .from("users")
    .select("email, first_name, last_name")
    .eq("company_id", companyId);

  const employeeEmailSet = new Set<string>();
  const employeeNameSet = new Set<string>();
  for (const u of companyUsers || []) {
    if (u.email) employeeEmailSet.add(u.email.toLowerCase().trim());
    const fullName =
      `${(u.first_name || "").trim()} ${(u.last_name || "").trim()}`
        .trim()
        .toLowerCase();
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
  const companyNameLower = (company?.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (companyNameLower.length >= 4) {
    const allDomains = new Set<string>();
    for (const email of validEmails) {
      for (const addr of [email.from, ...email.to, ...email.cc]) {
        const cleaned = (addr.match(/<([^>]+)>/)?.[1] || addr)
          .toLowerCase()
          .trim();
        const domain = cleaned.split("@")[1];
        if (domain) allDomains.add(domain);
      }
    }
    for (const domain of allDomains) {
      const domainClean = domain.replace(/[^a-z0-9]/g, "");
      if (
        domainClean.includes(companyNameLower) ||
        companyNameLower.includes(
          domainClean.replace(/\.(com|ca|net|org)$/g, "")
        )
      ) {
        if (!PUBLIC_EMAIL_DOMAINS.has(domain)) {
          companyDomainSet.add(domain);
          console.log(
            `[email-analyze] Detected company domain from name match: ${domain}`
          );
        }
      }
    }
  }

  console.log(
    `[email-analyze] Company domains: [${[...companyDomainSet].join(", ")}], Employee emails: ${employeeEmailSet.size}, Employee names: ${employeeNameSet.size}`
  );
  const forwarderEmailSet = new Set(
    detection.teamForwarders.map((f) => f.toLowerCase())
  );
  const estimateThreadIds = new Set(
    detection.detectedSources
      .filter((s) => s.type === "estimate_pattern")
      .flatMap(() => {
        // Get thread IDs from emailSourceMap
        return validEmails
          .filter((e) => detection.emailSourceMap[e.id] === "estimate_pattern")
          .map((e) => e.threadId);
      })
  );

  // Also collect all estimate-pattern thread IDs from the emailSourceMap directly
  for (const email of validEmails) {
    if (detection.emailSourceMap[email.id] === "estimate_pattern") {
      estimateThreadIds.add(email.threadId);
    }
  }

  const persistedDirection = (email: NormalizedEmail) =>
    resolvePersistedEmailDirection(email, {
      connectionEmail: connection.email,
      companyDomains: [...companyDomainSet],
      userEmailAddresses: [...employeeEmailSet],
    });

  // Ordinary conversations retain provider-thread grouping. Known contact-form
  // notifications are message-scoped because Gmail/platform forwarders may
  // reuse one raw thread for unrelated customers.
  const threadMap = new Map<string, ThreadInfo>();

  for (const email of validEmails) {
    const routing = buildLeadRoutingIdentity(email);
    const groupingKey = routing.sourceKey;

    if (!threadMap.has(groupingKey)) {
      const direction = persistedDirection(email);

      // Determine pattern source for this thread
      let patternSource: ThreadInfo["patternSource"] = null;
      if (estimateThreadIds.has(email.threadId)) {
        patternSource = "estimate_pattern";
      } else if (matchPlatform(email.from)) {
        patternSource = "platform";
      } else if (forwarderEmailSet.has(safe(email.from))) {
        patternSource = "forwarder";
      }

      threadMap.set(groupingKey, {
        threadId: groupingKey,
        providerThreadId: routing.providerThreadId,
        mayInheritProviderThread: routing.mayInheritProviderThread,
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

    const thread = threadMap.get(groupingKey)!;
    thread.emails.push(email);
    thread.messageCount++;

    const isOutbound = persistedDirection(email) === "outbound";
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
      thread.direction = isOutbound ? "outbound" : "inbound";
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

  console.log(
    `[email-analyze] Built thread map: ${threadMap.size} threads from ${validEmails.length} emails (${validEmails.length - detection.allInboxEmails.length} filtered for invalid threadId)`
  );

  // ─── Phase 3: Split threads into pattern-matched and unmatched ───────────
  const patternThreads: ThreadInfo[] = [];
  const unmatchedThreads: ThreadInfo[] = [];

  for (const thread of threadMap.values()) {
    // Skip threads from the owner's company domains (internal threads)
    const firstSenderDomain = safe(thread.firstSender).split("@")[1] || "";
    const isInternal =
      firstSenderDomain &&
      companyDomainSet.has(firstSenderDomain) &&
      !thread.patternSource; // Don't skip if it's a forwarder match

    if (isInternal && thread.direction !== "outbound") {
      // Internal inbound from company domain and not a forwarder — skip
      continue;
    }

    if (thread.patternSource) {
      patternThreads.push(thread);
    } else {
      unmatchedThreads.push(thread);
    }
  }

  console.log(
    `[email-analyze] Pattern-matched threads: ${patternThreads.length}, unmatched for AI: ${unmatchedThreads.length}`
  );

  // ─── Phase 4: AI triage of unmatched threads (lead or not?) ───────────────
  await updateProgress(
    "classifying_ai",
    `Triaging ${unmatchedThreads.length} threads with AI...`,
    35
  );

  // Build triage inputs — last 3 messages with FULL body text (no cap)
  const triageInputs: TriageInput[] = unmatchedThreads.map((t) => {
    const sorted = [...t.emails].sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );
    const lastThree = sorted.slice(0, 3).reverse(); // chronological order

    return {
      threadId: t.threadId,
      subject: t.subject,
      participants: t.participants,
      messageCount: t.messageCount,
      hasUserReply: t.hasUserReply,
      direction: t.direction,
      outboundCount: t.outboundCount,
      messages: lastThree.map((e) => ({
        from: e.from,
        fromName: e.fromName,
        to: e.to,
        date: e.date.toISOString(),
        direction: persistedDirection(e),
        body: stripQuotedContent(
          e.bodyText || e.snippet || "",
          e.subject || t.subject
        ),
      })),
    };
  });

  const triageResults = await EmailAIClassifier.triageThreads(
    triageInputs,
    {
      companyName: company?.name || "",
      industry: (company?.industry as string) || "trades",
      ownerEmail: connection.email,
      companyDomains: detection.companyDomains,
    },
    async (processed, total) => {
      const aiProgress = 35 + Math.round((processed / total) * 30);
      await updateProgress(
        "classifying_ai",
        `AI triaged ${processed} of ${total} threads...`,
        aiProgress
      );
    }
  );

  // Build a map of triage results by threadId
  const triageMap = new Map(triageResults.map((r) => [r.threadId, r]));

  // ─── Phase 5: Build confirmed leads list ────────────────────────────────
  await updateProgress("analyzing_threads", "Building lead list...", 70);

  // Collect all lead threads: pattern-matched + AI-triaged leads
  const leadThreads: Array<{
    thread: ThreadInfo;
    source: "pattern" | "platform" | "forwarder" | "ai";
  }> = [];

  // Pattern-matched threads are AUTOMATICALLY leads
  for (const thread of patternThreads) {
    const source: "pattern" | "platform" | "forwarder" =
      thread.patternSource === "estimate_pattern"
        ? "pattern"
        : thread.patternSource === "platform"
          ? "platform"
          : "forwarder";
    leadThreads.push({ thread, source });
  }

  // AI-triaged leads with confidence >= 0.5
  for (const thread of unmatchedThreads) {
    const triage = triageMap.get(thread.threadId);
    if (triage && triage.verdict === "lead" && triage.confidence >= 0.5) {
      leadThreads.push({ thread, source: "ai" });
    }
  }

  console.log(
    `[email-analyze] Lead threads: ${leadThreads.length} (${patternThreads.length} pattern + ${leadThreads.length - patternThreads.length} AI)`
  );

  // ─── Phase 5b: AI-extract client info from forwarder/platform form bodies ─
  // Pre-extract all form submissions so the sync helpers can use a lookup map.
  // Runs in parallel for speed. Cost: ~$0.001 per email, < $0.05 for 30 forms.
  const formExtractionMap = new Map<string, ExtractedFormClient>();
  const formExtractionThreads = leadThreads.filter(
    (lt) => lt.source === "forwarder" || lt.source === "platform"
  );

  if (formExtractionThreads.length > 0) {
    console.log(
      `[email-analyze] Extracting client info from ${formExtractionThreads.length} form submission threads via AI...`
    );
    const extractionPromises = formExtractionThreads.map(async ({ thread }) => {
      for (const email of thread.emails) {
        const extracted = await extractClientFromFormBody(
          email.bodyText || "",
          email.snippet
        );
        if (extracted) {
          formExtractionMap.set(thread.threadId, extracted);
          return;
        }
      }
    });
    await Promise.all(extractionPromises);
    console.log(
      `[email-analyze] AI form extraction complete: ${formExtractionMap.size}/${formExtractionThreads.length} threads had extractable client info`
    );
  }

  // ─── Lightweight lead building ─────────────────────────────────────────────
  // Builds AnalyzedLead[] with fallback names and correspondence-based stages.
  // Phase B will override names, stages, sub-contacts, and excerpts via deep extraction.
  await updateProgress("building_leads", "Building leads...", 75);

  const leads: AnalyzedLead[] = [];

  for (const { thread, source } of leadThreads) {
    // Determine the client email (who is NOT the owner)
    const clientEmail = cleanEmailAddress(
      findClientEmail(
        thread,
        ownerEmailLower,
        companyDomainSet,
        formExtractionMap
      )
    );

    // Fallback name extraction — will be overridden by Phase B deep extraction
    let clientName =
      capitalizeName(
        findClientName(
          thread,
          ownerEmailLower,
          companyDomainSet,
          formExtractionMap,
          clientEmail,
          employeeEmailSet
        )
      ) || "";

    // Name refinement from email body (still useful as fallback)
    if (isNameSuspicious(clientName, clientEmail)) {
      const sigName = extractSignatureName(
        thread.emails,
        ownerEmailLower,
        employeeEmailSet
      );
      if (sigName) {
        clientName = capitalizeName(sigName);
      } else {
        const greetName = extractGreetingName(thread.emails, ownerEmailLower);
        if (greetName && greetName.length > (clientName || "").length) {
          clientName = capitalizeName(greetName);
        }
      }
    }
    if ((clientName || "").split(" ").length < 2) {
      const sigName = extractSignatureName(
        thread.emails,
        ownerEmailLower,
        employeeEmailSet
      );
      if (sigName && sigName.split(" ").length >= 2) {
        clientName = capitalizeName(sigName);
      }
    }

    // Stage = correspondence-based for ALL sources (Phase B will override with AI extraction)
    const stage = correspondenceBasedStage(thread);
    const stageConfidence = 0.5; // Low confidence — Phase B will refine

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
        threadId: thread.mayInheritProviderThread
          ? thread.providerThreadId
          : undefined,
        connectionId: connection.id,
      }
    );

    let existingClientName: string | null = null;
    if (matchResult.clientId) {
      const { data: clientData } = await supabase
        .from("clients")
        .select("name")
        .eq("id", matchResult.clientId)
        .single();
      existingClientName = clientData?.name || null;
    }

    // Track discovered name for the fading UI display
    if (clientName && !discoveredLeadNames.includes(clientName)) {
      discoveredLeadNames.push(clientName);
    }

    const safeName = capitalizeName(clientName);
    const extracted = formExtractionMap.get(thread.threadId);

    leads.push({
      id: `lead-${thread.threadId}`,
      threadId: thread.threadId,
      providerThreadId: thread.providerThreadId,
      emails: thread.emails.map((e) => ({
        id: e.id,
        providerThreadId: e.threadId,
        from: e.from,
        subject: e.subject,
        date: e.date.toISOString(),
        direction: persistedDirection(e),
      })),
      client: {
        name: safeName,
        email: clientEmail,
        phone: extracted?.phone || null,
        description: extracted?.message || thread.subject,
        address: null, // Phase B AI extraction will populate
      },
      stage,
      stageConfidence,
      estimatedValue: null, // Phase B will extract
      correspondenceCount: thread.messageCount,
      outboundCount: thread.outboundCount,
      lastMessageDate: thread.dateRange.last,
      source,
      sourceLabel: SOURCE_LABELS[source] || "AI detected",
      subContacts: [], // Phase B will populate via deep extraction
      emailExcerpts: undefined, // Phase B will build from fetched thread messages
      duplicateGroupId: null,
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
  console.log(
    `[email-analyze] Phase A complete: ${leads.length} raw leads built. Saving intermediate data and chaining to Phase B...`
  );

  await supabase
    .from("gmail_scan_jobs")
    .update({
      status: "building_leads",
      progress: {
        stage: "building_leads",
        percent: 70,
        message: "Building leads...",
        discoveredLeadNames: discoveredLeadNames.slice(-12),
      },
      result: {
        phase: "leads_built",
        detection: {
          estimatePattern: detection.estimatePattern,
          estimatePatternConfidence: detection.estimatePatternConfidence,
          estimateThreadCount: detection.estimateThreadCount,
          detectedSources: [
            ...detection.detectedSources,
            // Add AI-detected source so Step 3 shows it as a toggleable source
            ...(leads.filter((l) => l.source === "ai").length > 0
              ? [
                  {
                    type: "ai_detected" as const,
                    label: "AI-detected customer conversations",
                    pattern: "ai",
                    count: leads.filter((l) => l.source === "ai").length,
                    enabled: true,
                    sampleEmails: [],
                  },
                ]
              : []),
          ],
          companyDomains: [...companyDomainSet],
          teamForwarders: detection.teamForwarders,
          totalEmailsScanned: detection.totalEmailsScanned,
        },
        leads: leads, // The raw AnalyzedLead[] before filtering
        ownerEmail: ownerEmailLower,
        discoveredLeadNames,
      },
    })
    .eq("id", jobId);

  // Chain to Phase B — a separate function invocation with its own 800s budget
  const baseUrl = getAppUrl();
  await fetch(`${baseUrl}/api/integrations/email/analyze-continue`, {
    method: "POST",
    headers: emailPipelineAuthorizationHeaders(),
    body: JSON.stringify({ jobId, connectionId, companyId }),
  });
}

// ─── Helper functions ──────────────────────────────────────────────────────

// ─── Clean "Name <email>" format ──────────────────────────────────────────
// Gmail stores addresses as "Laura Eby <laurakeby@gmail.com>" — extract just the email part.

function cleanEmailAddress(raw: string | null | undefined): string {
  if (!raw) return "";
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
  "reply-to+",
  "noreply",
  "no-reply",
  "notifications@",
  "mailer-daemon",
  "postmaster@",
  // OPS internal addresses (inbound lead capture, system emails)
  "inbound.opsapp.co",
  "@opsapp.co",
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
  const deterministic = extractContactFormSubmission("", text);
  if (deterministic) {
    return {
      name: deterministic.name || deterministic.email.split("@")[0],
      email: deterministic.email,
      phone: deterministic.phone,
      message: deterministic.message,
    };
  }

  // Quick check — does this even look like a form submission?
  // Look for at least one email address in the body
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
  if (!hasEmail) return null;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract the customer's contact information from this form submission email. Return ONLY a JSON object with: name, email, phone (null if not found), message (null if not found). If you cannot identify a customer email, return null.`,
        },
        {
          role: "user",
          content: text.slice(0, 2000), // Cap to control tokens
        },
      ],
      temperature: 0,
      max_tokens: 100,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    if (!parsed.email || isPlatformEmail(parsed.email)) return null;

    return {
      name: parsed.name || parsed.email.split("@")[0],
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
  const daysSinceLastMessage =
    (Date.now() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24);

  if (outboundCount === 0) return "new_lead";
  if (hasUserReply && daysSinceLastMessage > 5) return "follow_up";
  if (outboundCount >= 3 && messageCount >= 6) return "quoted";
  if (outboundCount >= 2 && messageCount >= 4) return "quoting";
  if (outboundCount === 1 && messageCount <= 3) return "qualifying";
  return "qualifying";
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
  if (
    thread.patternSource === "forwarder" ||
    thread.patternSource === "platform"
  ) {
    const extracted = formExtraction.get(thread.threadId);
    if (extracted?.email) return cleanEmailAddress(extracted.email);
  }

  console.log(
    `[findClientEmail] Thread ${thread.threadId} (source: ${thread.patternSource}): ${thread.participants.length} participants, ${thread.emails.length} emails`
  );

  // For estimate threads, the client is the RECIPIENT of the owner's outbound email.
  // Check 'to' addresses from outbound emails first.
  for (const email of thread.emails) {
    if (!safe(email.from).includes(ownerEmailLower)) continue; // only outbound emails
    for (const toAddr of email.to) {
      const cleaned = cleanEmailAddress(toAddr);
      if (!cleaned) continue;
      if (cleaned.includes(ownerEmailLower)) continue;
      const domain = cleaned.split("@")[1] || "";
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
    const domain = cleaned.split("@")[1] || "";
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
    const domain = cleaned.split("@")[1] || "";
    if (domain && companyDomainSet.has(domain)) continue;
    if (isPlatformEmail(cleaned)) continue;
    console.log(`[findClientEmail] → Found via inbound sender: ${cleaned}`);
    return cleaned;
  }

  // Last resort: return empty (will be filtered out)
  console.log(
    `[findClientEmail] → FAILED to find client email. Participants: ${thread.participants.map((p) => cleanEmailAddress(p)).join(", ")}`
  );
  return "";
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
  if (
    thread.patternSource === "forwarder" ||
    thread.patternSource === "platform"
  ) {
    const extracted = formExtraction.get(thread.threadId);
    if (extracted?.name) return extracted.name;
  }

  const clientEmailLower = clientEmail?.toLowerCase() || "";

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
    const domain = fromClean.split("@")[1] || "";
    if (domain && companyDomainSet.has(domain)) continue;
    if (employeeEmailSet?.has(fromClean)) continue;
    if (isPlatformEmail(fromClean)) continue;
    if (email.fromName && email.fromName !== (email.from || "").split("@")[0]) {
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

/** Capitalize a name properly — "shaii mnl" → "Shaii Mnl", "KARA BEACH" → "Kara Beach" */
function capitalizeName(name: string): string {
  if (!name) return name;
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Extract a person's name from the owner's outbound greeting.
 * Looks for "Hi [Name]", "Hello [Name]", "Hey [Name]", "Dear [Name]" patterns
 * in the owner's replies. Returns the greeting name or null.
 */
function extractGreetingName(
  emails: NormalizedEmail[],
  ownerEmailLower: string
): string | null {
  // Check outbound (owner's) emails for greeting patterns
  const outbound = emails
    .filter((e) => safe(e.from).includes(ownerEmailLower))
    .sort((a, b) => a.date.getTime() - b.date.getTime()); // oldest first

  for (const email of outbound) {
    const body = email.bodyText || email.snippet || "";
    // Match "Hi Name," or "Hi Name and Name," etc.
    // The name must start with an uppercase letter or we'll capitalize it
    const match = body.match(
      /(?:^|\n)\s*(?:hi|hello|hey|dear|good\s+(?:morning|afternoon|evening)),?\s+([A-Za-z][A-Za-z'-]+(?:\s+(?:and\s+)?[A-Za-z][A-Za-z'-]+)*)\b[,.\s!?\r\n]/im
    );
    if (match) {
      const name = match[1].trim();
      // Reject if it looks like a generic greeting (e.g., "Hi there", "Hi team")
      const GENERIC = ["there", "team", "all", "everyone", "folks", "guys"];
      if (!GENERIC.includes(name.toLowerCase())) {
        return capitalizeName(name);
      }
    }
  }

  return null;
}

/**
 * Extract a person's full name from inbound email signatures.
 * Looks for common sign-off patterns like "Sincerely, Name", "Thanks, Name",
 * and names on standalone lines near the end of the email body.
 */
function extractSignatureName(
  emails: NormalizedEmail[],
  ownerEmailLower: string,
  employeeEmailSet: Set<string>
): string | null {
  // Check inbound (client's) emails for signature patterns
  const inbound = emails.filter((e) => {
    const fromClean = cleanEmailAddress(e.from);
    return (
      !safe(e.from).includes(ownerEmailLower) &&
      !employeeEmailSet.has(fromClean)
    );
  });

  for (const email of inbound) {
    const body = email.bodyText || "";
    if (!body || body.length < 10) continue;

    // Pattern 1: Sign-off followed by name
    // "Sincerely, Earl Abbott" or "Thanks,\nEarl Abbott" or "Best regards, Earl Abbott"
    const signOffMatch = body.match(
      /(?:sincerely|regards|best regards|kind regards|thanks|thank you|cheers|best|warmly|respectfully)[,\s]*\r?\n\s*([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)+)/m
    );
    if (signOffMatch) {
      return signOffMatch[1].trim();
    }

    // Pattern 2: Name on a standalone line near the end (last 500 chars)
    // Look for "FirstName LastName" on its own line (2 or 3 capitalized words)
    const tail = body.slice(-500);
    const lines = tail
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 8); i--) {
      const line = lines[i];
      // Must be a short line (under 50 chars) with 2-3 capitalized words
      if (line.length > 50 || line.length < 3) continue;
      const nameMatch = line.match(
        /^([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){1,2})$/
      );
      if (nameMatch) {
        return nameMatch[1].trim();
      }
    }
  }

  return null;
}

/**
 * Checks if a name looks suspicious and should be refined.
 * Returns true if the name appears to be:
 * - A username/handle (all lowercase, no spaces)
 * - A domain/institution name (matches a domain component)
 * - Very short or generic
 */
function isNameSuspicious(name: string, clientEmail: string): boolean {
  if (!name) return true;
  // All lowercase (no capitalized words) — likely a username
  if (name === name.toLowerCase() && !name.includes(" ")) return true;
  // Name matches the email domain prefix (e.g., "Uvic" for uvic.ca)
  const domain = clientEmail.split("@")[1] || "";
  const domainPrefix = domain.split(".")[0]?.toLowerCase() || "";
  if (domainPrefix && name.toLowerCase() === domainPrefix) return true;
  // Name has digits — likely derived from email address
  if (/\d/.test(name)) return true;
  return false;
}

/** Normalize a subject line: strip Re:, Fwd:, and extra whitespace */
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
    .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
    .trim();
}
