/**
 * OPS Web - Email Analyze Continue Endpoint (Phase B)
 *
 * POST /api/integrations/email/analyze-continue
 * Continues email analysis after Phase A has built lightweight leads.
 * Reads intermediate data from the job record and runs:
 * 5. Full thread fetch for ALL confirmed leads (no cap)
 * 6. Deep AI extraction (names, stages, contacts, company names from full thread context)
 * 7. Hard-filter invalid leads + remove AI-flagged non-leads
 * 8. Deduplicate leads by client email
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
import type { AnalyzedLead } from "@/lib/types/email-import";
import type { DeepExtractionInput } from "@/lib/api/services/email-ai-classifier";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/** Capitalize a name properly — "shaii mnl" → "Shaii Mnl", "KARA BEACH" → "Kara Beach" */
function capitalizeName(name: string): string {
  if (!name) return name;
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Split a concatenated domain name into proper words using a business word dictionary.
 * "ardentproperties" → "Ardent Properties", "storyconstruction" → "Story Construction"
 */
function splitDomainName(domainLocal: string): string {
  const lower = domainLocal.toLowerCase();
  const SUFFIXES = [
    'construction', 'renovations', 'renovation', 'properties', 'property',
    'developments', 'development', 'contracting', 'contractors', 'contractor',
    'installations', 'installation', 'engineering', 'landscaping', 'restoration',
    'restorations', 'improvements', 'improvement', 'fabrication', 'consulting',
    'maintenance', 'enterprises', 'mechanical', 'management', 'industries',
    'associates', 'woodworks', 'woodwork', 'solutions', 'interiors', 'exteriors',
    'millwork', 'builders', 'building', 'services', 'plumbing', 'painting',
    'electric', 'electrical', 'flooring', 'roofing', 'fencing', 'decking',
    'masonry', 'welding', 'designs', 'design', 'studios', 'studio',
    'realty', 'supply', 'homes', 'home', 'group', 'works', 'hvac',
    'media', 'labs', 'corp', 'coop', 'pros', 'pro',
  ];
  for (const suffix of SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      const prefix = lower.slice(0, -suffix.length);
      if (prefix.length >= 2) {
        const capPrefix = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        let capSuffix = suffix.charAt(0).toUpperCase() + suffix.slice(1);
        if (suffix === 'coop') capSuffix = 'Co-op';
        return `${capPrefix} ${capSuffix}`;
      }
    }
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
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

// ─── Phase B: Full thread fetch, deep extraction, filtering, dedup ───────────

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
    .select("name, industry, industries")
    .eq("id", companyId)
    .single();

  // ─── 3. Full thread fetch for ALL confirmed leads (no cap) ─────────────────
  // Parallelized: fetch 5 threads concurrently to stay within 800s budget.
  // Sequential at ~2s/thread: 200 leads = 400s. Parallel 5×: 200 leads = ~80s.
  await updateProgress(
    "analyzing_threads",
    "Fetching full thread content...",
    75
  );

  const provider = EmailService.getProvider(connection);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchedThreads = new Map<string, Array<any>>();

  let fetchedCount = 0;
  let skippedCount = 0;
  const FETCH_CONCURRENCY = 5;

  for (let i = 0; i < leads.length; i += FETCH_CONCURRENCY) {
    const batch = leads.slice(i, i + FETCH_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (lead) => {
        const fetchedMessages = await fetchWithTimeout(
          provider.fetchThread(lead.threadId),
          10_000
        );
        return { lead, fetchedMessages };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.fetchedMessages) {
        const { lead, fetchedMessages } = result.value;
        fetchedThreads.set(lead.threadId, fetchedMessages);
        lead.correspondenceCount = fetchedMessages.length;
        lead.outboundCount = fetchedMessages.filter(
          (m: { from: string }) => safe(m.from).includes(ownerEmailLower)
        ).length;
        fetchedCount++;
      } else {
        skippedCount++;
        if (result.status === 'rejected') {
          console.error(`[email-analyze-continue] Thread fetch failed:`, result.reason);
        } else {
          console.warn(`[email-analyze-continue] Thread timed out — skipping`);
        }
      }
    }

    // 200ms delay between batches (not between individual fetches)
    if (i + FETCH_CONCURRENCY < leads.length) {
      await delay(200);
    }

    // Progress update every 2 batches
    if ((i / FETCH_CONCURRENCY) % 2 === 0) {
      const pct = 75 + Math.round(((fetchedCount + skippedCount) / leads.length) * 7);
      await updateProgress("analyzing_threads", `Fetched ${fetchedCount}/${leads.length} threads...`, pct);
    }
  }

  console.log(`[email-analyze-continue] Thread fetch complete: ${fetchedCount} fetched, ${skippedCount} skipped`);
  console.log(`[email-analyze-continue] Fetched threadIds sample: ${[...fetchedThreads.keys()].slice(0, 5).join(', ')}`);

  // ─── 4. Deep AI extraction ─────────────────────────────────────────────────
  await updateProgress("analyzing_threads", "Extracting lead details with AI...", 82);

  // Build deep extraction inputs — last 6 messages with full body text (no cap)
  const extractionInputs: DeepExtractionInput[] = [];
  const extractionThreadIds: string[] = [];
  let skippedNoMessages = 0;

  for (const lead of leads) {
    const messages = fetchedThreads.get(lead.threadId);
    if (!messages || messages.length === 0) {
      skippedNoMessages++;
      continue;
    }

    // Sort by date descending, take last 6, reverse to chronological
    const sorted = [...messages].sort((a: { date: Date }, b: { date: Date }) =>
      b.date.getTime() - a.date.getTime()
    );
    const lastSix = sorted.slice(0, 6).reverse();

    extractionInputs.push({
      threadId: lead.threadId,
      subject: lead.emails[0]?.subject || '',
      participants: [...new Set(
        messages.flatMap((m: { from: string; to: string[] }) => [m.from, ...m.to])
          .map((a: string) => a.toLowerCase())
      )],
      messageCount: messages.length,
      outboundCount: messages.filter(
        (m: { from: string }) => safe(m.from).includes(ownerEmailLower)
      ).length,
      messages: lastSix.map((m: { from: string; fromName: string; to: string[]; date: Date; bodyText: string; snippet: string }) => ({
        from: m.from,
        fromName: m.fromName || '',
        to: m.to,
        date: m.date.toISOString(),
        direction: (safe(m.from).includes(ownerEmailLower) ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
        body: m.bodyText || m.snippet || '',
      })),
    });
    extractionThreadIds.push(lead.threadId);
  }

  // Build parallel employee name/email arrays for the AI context
  const employeeNames: string[] = [];
  const employeeEmails: string[] = [];
  for (const u of (companyUsers || [])) {
    if (u.email) {
      employeeEmails.push(u.email.toLowerCase().trim());
      employeeNames.push(`${(u.first_name || '').trim()} ${(u.last_name || '').trim()}`.trim());
    }
  }

  const extractions = await EmailAIClassifier.deepExtractLeads(
    extractionInputs,
    {
      companyName: company?.name || '',
      industry: (company?.industry as string) || 'trades',
      industries: (company as Record<string, unknown>)?.industries as string[] || [],
      ownerEmail: ownerEmailLower,
      companyDomains: [...companyDomainSet],
      employeeNames,
      employeeEmails,
    },
    async (processed, total) => {
      const pct = 82 + Math.round((processed / total) * 8);
      await updateProgress("analyzing_threads", `Deep extraction: ${processed}/${total} threads...`, pct);
    }
  );

  console.log(`[email-analyze-continue] Extraction inputs: ${extractionInputs.length} threads (${skippedNoMessages} skipped — no fetched messages)`);
  console.log(`[email-analyze-continue] Extraction results: ${extractions.length} total`);

  // Log extraction threadId mapping quality
  const extractionsWithTid = extractions.filter((e) => e.threadId);
  const extractionsWithoutTid = extractions.filter((e) => !e.threadId);
  console.log(`[email-analyze-continue] Extraction tid mapping: ${extractionsWithTid.length} with tid, ${extractionsWithoutTid.length} missing tid`);

  // ─── 5. Apply extraction results to leads ──────────────────────────────────
  const extractionMap = new Map(extractions.filter((e) => e.threadId).map((e) => [e.threadId, e]));

  // Debug: track extraction application stats
  const extractionStats = { applied: 0, skippedNoExtraction: 0, nameOverridden: 0, stageOverridden: 0, companyApplied: 0, flaggedNotLead: 0 };

  for (const lead of leads) {
    const extraction = extractionMap.get(lead.threadId);
    if (!extraction) {
      extractionStats.skippedNoExtraction++;
      continue;
    }
    extractionStats.applied++;

    // Override client info if AI extracted better data
    if (extraction.client.name) {
      const oldName = lead.client.name;
      lead.client.name = capitalizeName(extraction.client.name);
      if (oldName !== lead.client.name) extractionStats.nameOverridden++;
    }
    if (extraction.client.email) {
      const extractedEmail = extraction.client.email.toLowerCase().trim();
      if (extractedEmail && !isPlatformEmail(extractedEmail)) {
        lead.client.email = extractedEmail;
      }
    }
    if (extraction.client.phone) {
      lead.client.phone = extraction.client.phone;
    }
    if (extraction.client.description) {
      lead.client.description = extraction.client.description;
    }

    // Override stage
    const oldStage = lead.stage;
    lead.stage = sanitizeStage(extraction.stage);
    lead.stageConfidence = extraction.stageConfidence;
    if (oldStage !== lead.stage) extractionStats.stageOverridden++;
    if (extraction.estimatedValue) {
      lead.estimatedValue = extraction.estimatedValue;
    }

    // Set subContacts from AI extraction
    if (extraction.subContacts?.length) {
      lead.subContacts = extraction.subContacts
        .filter((sc) => {
          const scEmail = sc.email?.toLowerCase().trim();
          return scEmail
            && scEmail !== ownerEmailLower
            && !employeeEmailSet.has(scEmail)
            && !isPlatformEmail(scEmail);
        })
        .map((sc) => ({
          name: capitalizeName(sc.name),
          email: sc.email.toLowerCase().trim(),
          phone: sc.phone || null,
        }));
    }

    // Company-as-client: if AI provided a company name, use it
    if (extraction.companyName) {
      extractionStats.companyApplied++;
      const currentName = lead.client.name;
      const aiCompanyName = capitalizeName(extraction.companyName);
      if (aiCompanyName && aiCompanyName.toLowerCase() !== currentName.toLowerCase()) {
        // Move individual to subContacts, company becomes client name
        const clientEmail = lead.client.email.toLowerCase();
        if (!lead.subContacts.some((sc) => sc.email === clientEmail)) {
          lead.subContacts.unshift({
            name: currentName,
            email: clientEmail,
            phone: lead.client.phone,
          });
        }
        lead.client.name = aiCompanyName;
      }
    } else {
      // Fallback: domain-based company-as-client for business email domains
      const clientEmailLower = lead.client.email.toLowerCase();
      const clientDomain = clientEmailLower.split('@')[1] || '';
      if (
        clientDomain
        && !PUBLIC_EMAIL_DOMAINS.has(clientDomain)
        && !companyDomainSet.has(clientDomain)
      ) {
        const PERSONAL_DOMAIN_PATTERNS = [
          '.edu', '.ac.', '.gov', '.mil', '.org',
          'university', 'college', 'school', 'uvic.', 'ubc.', 'sfu.',
          'bcit.', 'camosun.', 'viu.', 'unbc.',
        ];
        const isPersonalInstitution = PERSONAL_DOMAIN_PATTERNS.some((p) => clientDomain.includes(p));
        if (!isPersonalInstitution) {
          const companyFromDomain = splitDomainName(clientDomain.split('.')[0]);
          if (lead.client.name && companyFromDomain.toLowerCase() !== lead.client.name.toLowerCase()) {
            if (!lead.subContacts.some((sc) => sc.email === clientEmailLower)) {
              lead.subContacts.unshift({
                name: lead.client.name,
                email: clientEmailLower,
                phone: lead.client.phone,
              });
            }
            lead.client.name = companyFromDomain;
          }
        }
      }
    }

    // Mark non-leads flagged by deep extraction
    if (!extraction.isLead) {
      (lead as unknown as Record<string, unknown>)._aiRejected = true;
      extractionStats.flaggedNotLead++;
      console.log(`[deep-extract] Flagged not-lead: ${lead.client.name} (${lead.client.email}) — ${extraction.reason || 'no reason'}`);
    }
  }

  console.log(`[email-analyze-continue] Extraction stats: ${JSON.stringify(extractionStats)}`);

  // Build emailExcerpts from fetched thread messages for the wizard UI
  for (const lead of leads) {
    const messages = fetchedThreads.get(lead.threadId);
    if (!messages) continue;

    const sorted = [...messages].sort((a: { date: Date }, b: { date: Date }) =>
      b.date.getTime() - a.date.getTime()
    );
    const clientMsgs = sorted
      .filter((e: { from: string }) => !safe(e.from).includes(ownerEmailLower))
      .slice(0, 3);
    const ownerMsgs = sorted
      .filter((e: { from: string }) => safe(e.from).includes(ownerEmailLower))
      .slice(0, 3);

    lead.emailExcerpts = [...clientMsgs, ...ownerMsgs]
      .sort((a: { date: Date }, b: { date: Date }) => a.date.getTime() - b.date.getTime())
      .map((e: { from: string; fromName: string; date: Date; bodyText: string; snippet: string }) => ({
        from: e.from,
        fromName: e.fromName || '',
        direction: (safe(e.from).includes(ownerEmailLower) ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
        date: e.date.toISOString(),
        body: (e.bodyText || e.snippet || '').slice(0, 4000),
      }));
  }

  // Update discovered lead names
  for (const lead of leads) {
    if (lead.client.name && !discoveredLeadNames.includes(lead.client.name)) {
      discoveredLeadNames.push(lead.client.name);
    }
  }

  // ─── 6. Stage floor enforcement ────────────────────────────────────────────
  // A 44-message thread can NEVER be "new_lead" — catches bad AI values
  for (const lead of leads) {
    const msgs = lead.correspondenceCount;
    const out = lead.outboundCount;

    if (msgs >= 20 && (lead.stage === 'new_lead' || lead.stage === 'qualifying')) {
      lead.stage = 'quoted';
    } else if (msgs >= 10 && lead.stage === 'new_lead') {
      lead.stage = 'quoting';
    } else if (msgs >= 4 && out >= 1 && lead.stage === 'new_lead') {
      lead.stage = 'qualifying';
    }
  }

  await updateProgress("analyzing_threads", "Filtering leads...", 92);

  // ─── 7. Hard filter + AI rejection ─────────────────────────────────────────
  const filteredLeads = leads.filter((lead) => {
    // Remove AI-flagged non-leads from deep extraction
    if ((lead as unknown as Record<string, unknown>)._aiRejected) {
      console.log(`[filter] REMOVED (AI flagged not-lead): ${lead.client.name} (${lead.client.email})`);
      return false;
    }

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

  // Clean up internal flag
  for (const lead of filteredLeads) {
    delete (lead as unknown as Record<string, unknown>)._aiRejected;
  }

  console.log(`[email-analyze-continue] Leads after hard-filter: ${filteredLeads.length} (${leads.length - filteredLeads.length} removed)`);

  await updateProgress("analyzing_threads", "Deduplicating leads...", 95);

  // ─── 8. Deduplicate leads by client email ──────────────────────────────────
  const deduplicatedLeads = deduplicateLeads(filteredLeads);

  console.log(`[email-analyze-continue] Leads after dedup: ${deduplicatedLeads.length} (${filteredLeads.length} before dedup)`);

  // ─── 9. Save final results ─────────────────────────────────────────────────
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
        leads: deduplicatedLeads,
        totalScanned: detectionData.totalEmailsScanned,
        // Debug: extraction diagnostics for review
        _extractionDebug: {
          totalLeadsFromPhaseA: leads.length,
          threadsFetched: fetchedCount,
          threadsFetchSkipped: skippedCount,
          extractionInputCount: extractionInputs.length,
          extractionResultCount: extractions.length,
          extractionStats,
          // Sample of extractions for debugging (first 10)
          sampleExtractions: extractions.slice(0, 10).map((e) => ({
            tid: e.threadId,
            name: e.client.name,
            email: e.client.email,
            stage: e.stage,
            stageC: e.stageConfidence,
            isLead: e.isLead,
            reason: e.reason,
            companyName: e.companyName,
            subContactCount: e.subContacts.length,
          })),
          // All not-lead rejections with reasons
          notLeadReasons: extractions
            .filter((e) => !e.isLead)
            .map((e) => ({ tid: e.threadId, name: e.client.name, email: e.client.email, reason: e.reason })),
        },
      },
    })
    .eq("id", jobId);

  // ─── 10. Update connection wizard state on completion ─────────────────────
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

  console.log(`[email-analyze-continue] Phase B complete. ${deduplicatedLeads.length} leads saved.`);
}
