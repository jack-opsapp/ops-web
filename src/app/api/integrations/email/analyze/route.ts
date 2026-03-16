/**
 * OPS Web - Email Analyze Endpoint
 *
 * POST /api/integrations/email/analyze
 * Kicks off inbox analysis — pattern detection + AI classification.
 * Returns a jobId for polling via analyze-status.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { PatternDetectionService } from "@/lib/api/services/pattern-detection-service";
import { EmailAIClassifier } from "@/lib/api/services/email-ai-classifier";
import { EmailMatchingServiceV2 } from "@/lib/api/services/email-matching-service-v2";
import type { EmailConnection } from "@/lib/types/email-connection";
import type { AnalyzedLead } from "@/lib/types/email-import";
import type { ClassificationResult } from "@/lib/api/services/email-ai-classifier";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

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

  // Phase 1: Pattern detection
  await updateProgress("analyzing_sent", "Analyzing your sent emails...", 10);

  const detection = await PatternDetectionService.detect(connection, {
    monthsBack: 3,
  });

  await updateProgress(
    "detecting_platforms",
    `Found ${detection.detectedSources.length} sources. Classifying remaining emails...`,
    40
  );

  // Phase 2: AI classification of unmatched emails
  await updateProgress(
    "classifying_ai",
    `Classifying ${detection.unclassifiedPersonalEmails.length} emails with AI...`,
    50
  );

  // Fetch company info for AI context
  const { data: company } = await supabase
    .from("companies")
    .select("name, industry")
    .eq("id", companyId)
    .single();

  const classificationInputs = detection.unclassifiedPersonalEmails.map(
    (e) => ({
      id: e.id,
      threadId: e.threadId,
      from: e.from,
      to: e.to,
      subject: e.subject,
      snippet: e.snippet,
      date: e.date.toISOString(),
      direction: (e.from.toLowerCase().includes(connection.email.toLowerCase())
        ? "outbound"
        : "inbound") as "inbound" | "outbound",
    })
  );

  const classifications = await EmailAIClassifier.classifyBatch(
    classificationInputs,
    {
      companyName: company?.name || "",
      industry: (company?.industry as string) || "trades",
      ownerEmail: connection.email,
      companyDomains: detection.companyDomains,
    }
  );

  await updateProgress(
    "analyzing_threads",
    "Analyzing conversation threads...",
    70
  );

  // Phase 3: Thread analysis for stage placement
  const provider = EmailService.getProvider(connection);
  const leadClassifications = classifications.filter(
    (c) => c.verdict === "lead" && c.confidence >= 0.7
  );

  const uniqueThreadIds = [
    ...new Set(
      leadClassifications
        .map((c) => {
          const input = classificationInputs.find((i) => i.id === c.id);
          return input?.threadId;
        })
        .filter(Boolean)
    ),
  ] as string[];

  // Fetch threads in batches (cap at 100)
  const threadAnalysisInputs = [];
  for (const threadId of uniqueThreadIds.slice(0, 100)) {
    try {
      const thread = await provider.fetchThread(threadId);
      threadAnalysisInputs.push({
        threadId,
        messages: thread.map((m) => ({
          from: m.from,
          to: m.to,
          subject: m.subject,
          bodyText: m.bodyText,
          date: m.date.toISOString(),
          direction: (m.from
            .toLowerCase()
            .includes(connection.email.toLowerCase())
            ? "outbound"
            : "inbound") as "inbound" | "outbound",
        })),
      });
    } catch (err) {
      console.error(
        `[email-analyze] Failed to fetch thread ${threadId}:`,
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

  // Phase 4: Build AnalyzedLead[] from classifications + thread analyses
  const threadAnalysisMap = new Map(
    threadAnalyses.map((ta) => [ta.threadId, ta])
  );

  const leads: AnalyzedLead[] = [];
  const processedThreadIds = new Set<string>();

  for (const classification of leadClassifications) {
    const input = classificationInputs.find((i) => i.id === classification.id);
    if (!input) continue;

    // Skip if we already processed this thread (dedup by thread)
    if (processedThreadIds.has(input.threadId)) continue;
    processedThreadIds.add(input.threadId);

    // Thread analysis takes priority over classification for stage
    const threadAnalysis = threadAnalysisMap.get(input.threadId);
    const stage =
      threadAnalysis?.stage || classification.stage || "new_lead";
    const stageConfidence =
      threadAnalysis?.confidence || classification.confidence;

    // Get all emails in this thread from our classification inputs
    const threadEmails = classificationInputs.filter(
      (ci) => ci.threadId === input.threadId
    );

    // Run client matching
    const matchResult = await EmailMatchingServiceV2.match(
      companyId,
      classification.client?.email || input.from,
      {
        name: classification.client?.name,
        threadId: input.threadId,
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

    const outboundCount = threadEmails.filter(
      (e) => e.direction === "outbound"
    ).length;

    leads.push({
      id: `lead-${input.threadId}`,
      threadId: input.threadId,
      emails: threadEmails.map((e) => ({
        id: e.id,
        from: e.from,
        subject: e.subject,
        date: e.date,
        direction: e.direction,
      })),
      client: classification.client || {
        name: extractNameFromEmail(input.from),
        email: input.from,
        phone: null,
        description: input.subject,
      },
      stage,
      stageConfidence,
      estimatedValue:
        threadAnalysis?.estimatedValue ||
        classification.estimatedValue ||
        null,
      correspondenceCount: threadEmails.length,
      outboundCount,
      lastMessageDate:
        threadEmails.sort(
          (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        )[0]?.date || input.date,
      source: "ai",
      sourceLabel: "AI detected",
      duplicateGroupId:
        classification.duplicateOf.length > 0
          ? classification.duplicateOf[0]
          : null,
      matchResult: {
        existingClientId: matchResult.clientId,
        existingClientName,
        action: matchResult.action,
        confidence: matchResult.confidence,
      },
      enabled: true,
    });
  }

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
        leads,
        totalScanned: detection.totalEmailsScanned,
      },
    })
    .eq("id", jobId);
}

/** Extract a display name from an email address like "john.smith@example.com" → "John Smith" */
function extractNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] || email;
  return localPart
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
