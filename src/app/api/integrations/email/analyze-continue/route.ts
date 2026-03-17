/**
 * OPS Web - Email Analyze Continue Endpoint (Phase B)
 *
 * POST /api/integrations/email/analyze-continue
 * Continues email analysis after Phase A has built raw leads.
 * Reads intermediate data from the job record and runs:
 * 6. Full thread content fetch for AI-classified leads (stage refinement)
 * 7b. Hard-filter invalid leads
 * 8. Deduplicate leads by client email
 * 9. AI validation pass
 * → Saves final results
 *
 * Chained from /api/integrations/email/analyze (Phase A) via fetch().
 * Each phase gets its own 800s Vercel function budget.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { EmailAIClassifier } from "@/lib/api/services/email-ai-classifier";
import { PLATFORM_DOMAINS } from "@/lib/api/services/known-platforms";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import OpenAI from 'openai';
import type { AnalyzedLead } from "@/lib/types/email-import";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Lazy OpenAI client ──────────────────────────────────────────────────────
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export const maxDuration = 800; // Pro plan max

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

// ─── Duplicated helpers from analyze route (Phase A) ─────────────────────────
// These are intentionally duplicated rather than shared to keep the two routes
// independently deployable and avoid import coupling.

function cleanEmailAddress(raw: string | null | undefined): string {
  if (!raw) return '';
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).toLowerCase().trim();
}

const PLATFORM_EMAIL_PATTERNS = [
  'reply-to+', 'noreply', 'no-reply', 'notifications@',
  'mailer-daemon', 'postmaster@',
  'inbound.opsapp.co', '@opsapp.co',
  ...Object.keys(PLATFORM_DOMAINS),
];

function isPlatformEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return PLATFORM_EMAIL_PATTERNS.some((p) => lower.includes(p));
}

/** Deduplicate leads by client email — merge leads from the same client */
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

// ─── AI Validation ──────────────────────────────────────────────────────────
// Second-pass AI check: sends a compact enumerated list of candidate leads
// plus company context. AI returns just the approved numbers.

async function validateLeadsWithAI(
  leads: AnalyzedLead[],
  context: {
    companyName: string;
    companyDomain: string;
    industry: string;
    ownerEmail: string;
    employeeEmails: string[];
    employeeNames: string[];
    employeeDescriptions: string[];
  }
): Promise<AnalyzedLead[]> {
  if (leads.length === 0) return [];

  const systemPrompt = `You are validating a list of potential leads for a ${context.industry} business.

Company: ${context.companyName}
Company domain(s): ${context.companyDomain || 'unknown'}
Owner email: ${context.ownerEmail}
Team members:
${context.employeeDescriptions.length > 0 ? context.employeeDescriptions.map(d => `  - ${d}`).join('\n') : '  (none known)'}

Below is a numbered list of candidates detected from the owner's email inbox.
Review each one and return ONLY the numbers of legitimate customer/client leads.

REJECT (do not include):
- Company employees or team members (emails matching company domain or employee list, OR names matching team members even if the email differs)
- The company owner themselves
- Vendors, suppliers, or subtrades selling TO the company (not buying FROM the company). Read the email excerpts — if they are pitching their services or sending invoices TO the company, they are a vendor, not a client.
- Spam, newsletters, automated notifications
- Platform/service accounts (noreply, notifications, system emails)
- Internal business contacts (accountants, lawyers, insurance) unless they're also clients

APPROVE:
- Homeowners, property owners, or residents requesting work
- Builders, general contractors, or developers hiring the company as a subtrade
- Commercial clients requesting quotes or estimates
- Anyone the company has sent an estimate/quote to
- Referral contacts who are potential customers

CRITICAL RULE: Candidates with source "Estimate thread" have RECEIVED a quote/estimate from the company. They are definitively customers — APPROVE them UNLESS their email matches a team member.

Each candidate includes up to 6 email excerpts. Use these to verify the relationship direction (is the company selling TO them or buying FROM them?).

RESPOND WITH JSON: { "approved": [1, 3, 5, ...] }
Only the numbers. No explanation.`;

  // Build candidate list with email excerpts for informed validation
  const candidateList = leads.map((lead, i) => {
    const header = [
      `--- #${i + 1} ---`,
      `Name: ${lead.client.name}`,
      `Email: ${lead.client.email}`,
      `Source: ${lead.sourceLabel}`,
      `Stage: ${lead.stage}`,
      `Messages: ${lead.correspondenceCount} total, ${lead.outboundCount} outbound`,
    ].join('\n');

    // Include email excerpts with body content
    let emailSection = '';
    if (lead.emailExcerpts?.length) {
      emailSection = '\nEmails:\n' + lead.emailExcerpts.map((e) => {
        const bodyPreview = e.body || '';
        return `  [${e.direction.toUpperCase()}] ${e.fromName || e.from} (${e.date.slice(0, 10)})\n    ${bodyPreview}`;
      }).join('\n');
    }

    return header + emailSection;
  }).join('\n\n');

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: candidateList },
      ],
      temperature: 0,
      max_tokens: Math.max(leads.length * 4, 100),
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('[email-analyze-continue] AI validation returned empty response — keeping all leads');
      return leads;
    }

    const parsed = JSON.parse(content);
    const approved = new Set<number>(
      (parsed.approved || []).map((n: number) => n)
    );

    console.log(`[email-analyze-continue] AI validation: ${approved.size}/${leads.length} approved`);

    // Log rejected leads for debugging
    leads.forEach((lead, i) => {
      if (!approved.has(i + 1)) {
        console.log(`[ai-validate] REJECTED #${i + 1}: ${lead.client.name} (${lead.client.email}) — ${lead.sourceLabel}`);
      }
    });

    return leads.filter((_, i) => approved.has(i + 1));
  } catch (err) {
    console.error('[email-analyze-continue] AI validation failed — keeping all leads:', err);
    return leads; // Fail open — don't lose leads if validation fails
  }
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

  // Validate that the job exists and has Phase A data
  const supabase = getServiceRoleClient();
  const { data: job } = await supabase
    .from("gmail_scan_jobs")
    .select("id, result, status")
    .eq("id", jobId)
    .single();

  if (!job) {
    return NextResponse.json(
      { error: "Job not found" },
      { status: 404 }
    );
  }

  const result = job.result as Record<string, unknown> | null;
  if (!result || result.phase !== "leads_built") {
    return NextResponse.json(
      { error: "Job does not have Phase A intermediate data" },
      { status: 400 }
    );
  }

  // Run Phase B in background — return immediately
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    setSupabaseOverride(bgSupabase);
    try {
      await runPhaseB(jobId, connectionId, companyId, bgSupabase);
    } catch (err) {
      console.error("[email-analyze-continue] Phase B failed:", err);
      await bgSupabase
        .from("gmail_scan_jobs")
        .update({
          status: "error",
          error_message: `Phase B failed: ${(err as Error).message}`,
        })
        .eq("id", jobId);
    } finally {
      setSupabaseOverride(null);
    }
  });

  return NextResponse.json({ ok: true });
}

// ─── Phase B: Full thread analysis, filtering, dedup, AI validation ──────────

async function runPhaseB(
  jobId: string,
  connectionId: string,
  companyId: string,
  supabase: SupabaseClient
) {
  console.log(`[email-analyze-continue] Phase B starting for job ${jobId}`);

  // ─── 1. Read intermediate data from job ────────────────────────────────────
  const { data: job } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  if (!job?.result) {
    throw new Error("Job result is empty — Phase A may not have completed");
  }

  const intermediate = job.result as {
    phase: string;
    detection: {
      estimatePattern: string | null;
      estimatePatternConfidence: number;
      estimateThreadCount: number;
      detectedSources: Array<{ type: string; pattern: string; count: number }>;
      companyDomains: string[];
      teamForwarders: string[];
      totalEmailsScanned: number;
    };
    leads: AnalyzedLead[];
    ownerEmail: string;
    discoveredLeadNames: string[];
  };

  if (intermediate.phase !== "leads_built") {
    throw new Error(`Unexpected phase: ${intermediate.phase} — expected 'leads_built'`);
  }

  const leads = intermediate.leads;
  const ownerEmailLower = intermediate.ownerEmail;
  const discoveredLeadNames = [...(intermediate.discoveredLeadNames || [])];
  const detectionData = intermediate.detection;

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

  // ─── 2. Re-fetch connection, company, employees from DB ───────────────────
  setSupabaseOverride(supabase);
  let connection;
  try {
    connection = await EmailService.getConnection(connectionId);
  } finally {
    setSupabaseOverride(null);
  }

  if (!connection) {
    throw new Error(`Connection ${connectionId} not found`);
  }

  const companyDomainSet = new Set(detectionData.companyDomains.map((d: string) => d.toLowerCase()));

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

  const { data: company } = await supabase
    .from("companies")
    .select("name, industry")
    .eq("id", companyId)
    .single();

  // ─── 3. Phase 6: Full thread fetch + stage analysis for AI leads ──────────
  await updateProgress(
    "analyzing_threads",
    "Analyzing thread stages...",
    75
  );

  const provider = EmailService.getProvider(connection);

  // Only fetch threads for AI-classified leads (pattern leads already have correspondence-based stages)
  const aiLeadIndices: number[] = [];
  for (let i = 0; i < leads.length; i++) {
    if (leads[i].source === 'ai') {
      aiLeadIndices.push(i);
    }
  }

  // Cap at 15 to avoid Gmail API rate limits (reduced from 20 since we're in Phase B)
  const threadsToFetch = aiLeadIndices.slice(0, 15);
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

  let fetchedCount = 0;
  let skippedCount = 0;

  for (const idx of threadsToFetch) {
    const lead = leads[idx];
    try {
      // 10-second timeout per thread to prevent hangs on large threads or rate limits
      const fetchedMessages = await fetchWithTimeout(
        provider.fetchThread(lead.threadId),
        10_000
      );

      if (!fetchedMessages) {
        console.warn(`[email-analyze-continue] Thread ${lead.threadId} timed out after 10s — skipping`);
        skippedCount++;
        await delay(200);
        continue;
      }

      threadMessageCounts.set(lead.threadId, fetchedMessages.length);
      threadAnalysisInputs.push({
        threadId: lead.threadId,
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
        `[email-analyze-continue] Failed to fetch thread ${lead.threadId}:`,
        err
      );
      skippedCount++;
    }

    // 200ms delay between fetches to avoid Gmail API rate limits
    await delay(200);
  }

  console.log(`[email-analyze-continue] Thread fetch complete: ${fetchedCount} fetched, ${skippedCount} skipped (timeout/error), ${Math.max(0, aiLeadIndices.length - 15)} beyond cap`);

  // Run AI thread analysis on fetched threads
  if (threadAnalysisInputs.length > 0) {
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

    // Update lead stages from thread analysis results
    for (const lead of leads) {
      const analysis = threadAnalysisMap.get(lead.threadId);
      if (analysis) {
        lead.stage = sanitizeStage(analysis.stage);
        lead.stageConfidence = analysis.confidence;
        if (analysis.estimatedValue) {
          lead.estimatedValue = analysis.estimatedValue;
        }
      }

      // Update correspondence count from actual thread fetch
      const actualCount = threadMessageCounts.get(lead.threadId);
      if (actualCount) {
        lead.correspondenceCount = actualCount;
      }
    }
  }

  // ─── Stage fallback: correspondence-based heuristic for unfetched AI leads ─
  // AI leads beyond the 15-thread cap keep their raw "new_lead" default.
  // Apply a message-count heuristic so 51-message threads don't show as "new_lead".
  for (const lead of leads) {
    if (lead.source !== 'ai') continue;
    // Skip leads that already got refined by thread analysis
    if (threadAnalysisInputs.some((t) => t.threadId === lead.threadId)) continue;

    // Heuristic based on correspondence counts
    const msgs = lead.correspondenceCount;
    const out = lead.outboundCount;
    if (out === 0) {
      lead.stage = 'new_lead';
    } else if (msgs >= 6 && out >= 3) {
      lead.stage = 'quoted';
    } else if (msgs >= 4 && out >= 2) {
      lead.stage = 'quoting';
    } else if (out >= 1) {
      lead.stage = 'qualifying';
    }
    // If the thread has 10+ messages, it's at least quoting
    if (msgs >= 10 && (lead.stage === 'new_lead' || lead.stage === 'qualifying')) {
      lead.stage = 'quoting';
    }
    if (msgs >= 20) {
      lead.stage = 'quoted';
    }
  }

  await updateProgress("analyzing_threads", "Filtering leads...", 85);

  // ─── 4. Phase 7b: Hard-filter obvious invalid leads ───────────────────────
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
    if (employeeEmailSet.has(email)) {
      console.log(`[filter] REMOVED (employee): ${email}`);
      return false;
    }
    const domain = email.split('@')[1] || '';
    if (domain && companyDomainSet.has(domain)) {
      console.log(`[filter] REMOVED (company domain ${domain}): ${email}`);
      return false;
    }
    if (isPlatformEmail(email)) {
      console.log(`[filter] REMOVED (platform): ${email}`);
      return false;
    }
    return true;
  });

  console.log(`[email-analyze-continue] Leads after hard-filter: ${filteredLeads.length} (${leads.length - filteredLeads.length} removed — owner/platform/null)`);

  await updateProgress("analyzing_threads", "Deduplicating leads...", 92);

  // ─── 5. Phase 8: Deduplicate leads by client email ────────────────────────
  const deduplicatedLeads = deduplicateLeads(filteredLeads);

  console.log(`[email-analyze-continue] Leads after dedup: ${deduplicatedLeads.length} (${filteredLeads.length} before dedup)`);

  // ─── 6. Phase 9: AI Validation Pass ───────────────────────────────────────
  await updateProgress("analyzing_threads", "Validating leads...", 95);

  // Build employee context strings for the AI
  const employeeDescriptions = (companyUsers || []).map((u: { email: string; first_name: string; last_name: string }) =>
    `${(u.first_name || '').trim()} ${(u.last_name || '').trim()} (${u.email})`
  ).filter((s: string) => s.trim() !== '()');

  const validatedLeads = await validateLeadsWithAI(
    deduplicatedLeads,
    {
      companyName: company?.name || "",
      companyDomain: [...companyDomainSet].join(', ') || ownerEmailLower.split('@')[1] || "",
      industry: (company?.industry as string) || "trades",
      ownerEmail: ownerEmailLower,
      employeeEmails: [...employeeEmailSet],
      employeeNames: [...employeeNameSet],
      employeeDescriptions,
    }
  );

  console.log(`[email-analyze-continue] Leads after AI validation: ${validatedLeads.length} (${deduplicatedLeads.length - validatedLeads.length} rejected by AI)`);

  // ─── 7. Save final results ────────────────────────────────────────────────
  await supabase
    .from("gmail_scan_jobs")
    .update({
      status: "complete",
      progress: { stage: "complete", message: "Analysis complete!", percent: 100, discoveredLeadNames: discoveredLeadNames.slice(-12) },
      result: {
        estimatePattern: detectionData.estimatePattern,
        estimatePatternConfidence: detectionData.estimatePatternConfidence,
        estimateThreadCount: detectionData.estimateThreadCount,
        detectedSources: detectionData.detectedSources,
        companyDomains: detectionData.companyDomains,
        teamForwarders: detectionData.teamForwarders,
        leads: validatedLeads,
        totalScanned: detectionData.totalEmailsScanned,
      },
    })
    .eq("id", jobId);

  // ─── 8. Update connection wizard state on completion ──────────────────────
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

  console.log(`[email-analyze-continue] Phase B complete. ${validatedLeads.length} leads saved.`);
}
