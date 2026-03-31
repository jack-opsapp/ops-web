// src/lib/api/services/email-ai-classifier.ts
// Redesigned AI classification — thread-first approach.
// Classifies threads (not individual emails) as leads, extracts client info,
// assigns pipeline stages, and detects duplicates across threads.
//
// Key design:
// - Accepts thread summaries, not individual emails
// - Returns per-thread structured data
// - Detects duplicates across threads
// - Assigns pipeline stages based on thread context
// - Validates stage values — allows won/lost as direct stages, rescues likely_won/likely_lost to terminalFlag

import { getImportOpenAI } from './openai-clients';

// Re-export from shared utility — keeps existing imports working
export { stripQuotedContent } from '@/lib/utils/email-parsing';

// Uses OPENAI_API_KEY_IMPORT for initial inbox scan (Phase A triage + Phase B extraction).
// Accepts an optional client override so the sync reviewer can pass its SYNC key client.
function getOpenAI(override?: import('openai').default): import('openai').default {
  return override ?? getImportOpenAI();
}

// Valid pipeline stages — used for validation
const VALID_STAGES = ['new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up', 'negotiation', 'won', 'lost'] as const;
type ValidStage = typeof VALID_STAGES[number];

function isValidStage(stage: string): stage is ValidStage {
  return (VALID_STAGES as readonly string[]).includes(stage);
}

/** Sanitize a stage value from AI output. Derives terminalFlag from won/lost stages. */
function sanitizeStageAndFlag(
  rawStage: string | null | undefined,
  rawFlag: string | null | undefined
): { stage: string; terminalFlag: 'likely_won' | 'likely_lost' | null } {
  const stage = rawStage && isValidStage(rawStage) ? rawStage : 'new_lead';
  // Derive terminal flag from stage or explicit flag
  let terminalFlag: 'likely_won' | 'likely_lost' | null =
    (rawFlag === 'likely_won' || rawFlag === 'likely_lost') ? rawFlag : null;
  if (!terminalFlag && rawStage === 'likely_won') terminalFlag = 'likely_won';
  if (!terminalFlag && rawStage === 'likely_lost') terminalFlag = 'likely_lost';
  // If AI directly set won/lost as the stage, also set the terminal flag
  if (!terminalFlag && stage === 'won') terminalFlag = 'likely_won';
  if (!terminalFlag && stage === 'lost') terminalFlag = 'likely_lost';
  return { stage, terminalFlag };
}

// ─── Legacy single-email classification (kept for backward compatibility) ─────

export interface ClassificationInput {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  snippet: string;
  date: string;
  direction: 'inbound' | 'outbound';
}

export interface ClassificationResult {
  id: string;
  verdict: 'lead' | 'biz' | 'skip';
  confidence: number;
  stage: string | null;
  estimatedValue: number | null;
  client: {
    name: string;
    email: string;
    phone: string | null;
    description: string;
  } | null;
  duplicateOf: string[];
  terminalFlag: 'likely_won' | 'likely_lost' | null;
}

// ─── Thread-based classification (new primary approach) ─────────────────────

export interface ThreadSummaryInput {
  threadId: string;
  subject: string;
  participants: string[];
  messageCount: number;
  hasUserReply: boolean;
  latestSnippet: string;
  firstSender: string;
  firstSenderName: string;
  direction: 'inbound' | 'outbound';
  dateRange: { first: string; last: string };
  outboundCount: number;
  /** Up to 6 email excerpts (3 client + 3 owner) for context-rich classification */
  emailExcerpts?: Array<{
    from: string;
    fromName: string;
    to: string[];
    date: string;
    direction: 'inbound' | 'outbound';
    body: string; // first 500 chars
  }>;
}

export interface ThreadClassificationResult {
  threadId: string;
  verdict: 'lead' | 'biz' | 'skip';
  confidence: number;
  stage: string;
  estimatedValue: number | null;
  client: {
    name: string;
    email: string;
    phone: string | null;
    description: string;
  } | null;
  additionalContacts: Array<{ name: string; email: string; phone: string | null }>;
  duplicateOf: string[];
  terminalFlag: 'likely_won' | 'likely_lost' | null;
}

// ─── Thread analysis (full content for stage determination) ─────────────────

export interface ThreadAnalysisInput {
  threadId: string;
  messages: Array<{
    from: string;
    to: string[];
    subject: string;
    bodyText: string;
    date: string;
    direction: 'inbound' | 'outbound';
  }>;
}

export interface ThreadAnalysisResult {
  threadId: string;
  stage: string;
  confidence: number;
  estimatedValue: number | null;
  signals: string[];
  terminalFlag: 'likely_won' | 'likely_lost' | null;
}

// ─── Triage types (Phase A: cheap lead/not_lead pass) ───────────────────────

export interface TriageInput {
  threadId: string;
  subject: string;
  participants: string[];
  messageCount: number;
  hasUserReply: boolean;
  direction: 'inbound' | 'outbound';
  outboundCount: number;
  /** Last 3 messages with full body text (no cap) */
  messages: Array<{
    from: string;
    fromName: string;
    to: string[];
    date: string;
    direction: 'inbound' | 'outbound';
    body: string;
  }>;
}

export interface TriageResult {
  threadId: string;
  verdict: 'lead' | 'not_lead';
  confidence: number;
}

// ─── Deep extraction types (Phase B: full context extraction) ───────────────

export interface DeepExtractionInput {
  threadId: string;
  subject: string;
  participants: string[];
  messageCount: number;
  outboundCount: number;
  /** Last 6 messages with full body text (no cap) */
  messages: Array<{
    from: string;
    fromName: string;
    to: string[];
    date: string;
    direction: 'inbound' | 'outbound';
    body: string;
  }>;
}

export interface DeepExtractionResult {
  threadId: string;
  client: {
    name: string;
    email: string;
    phone: string | null;
    description: string;
    address: string | null;
  };
  subContacts: Array<{ name: string; email: string; phone: string | null }>;
  companyName: string | null;
  stage: string;
  stageConfidence: number;
  estimatedValue: number | null;
  isLead: boolean;
  needsReview: boolean;
  reviewReason: 'legal' | 'job_seeker' | 'collections' | 'platform_bid' | 'warranty' | 'ambiguous' | null;
  reason: string | null;
  terminalFlag: 'likely_won' | 'likely_lost' | null;
}

export const EmailAIClassifier = {
  /**
   * Classify a batch of THREAD SUMMARIES — the primary classification method.
   * Each entry represents one email thread, not an individual message.
   * Returns per-thread classification with client info and stage.
   */
  async classifyThreadBatch(
    threads: ThreadSummaryInput[],
    context: { companyName: string; industry: string; ownerEmail: string; companyDomains: string[] },
    onProgress?: (processed: number, total: number, batchResults: ThreadClassificationResult[]) => Promise<void>
  ): Promise<ThreadClassificationResult[]> {
    if (threads.length === 0) return [];

    const results: ThreadClassificationResult[] = [];
    // Batch 15 threads per API call — balances payload size vs round-trip count
    // At 2KB per thread (6 emails × 2000 chars each worst case), 15 threads ≈ 30KB ≈ 8K tokens
    const BATCH_SIZE = 15;
    for (let i = 0; i < threads.length; i += BATCH_SIZE) {
      const batch = threads.slice(i, i + BATCH_SIZE);
      const batchResults = await EmailAIClassifier.classifySingleThreadBatch(batch, context);
      results.push(...batchResults);
      if (onProgress) {
        await onProgress(Math.min(i + BATCH_SIZE, threads.length), threads.length, batchResults);
      }
      if (i + BATCH_SIZE < threads.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return results;
  },

  /**
   * Legacy: Classify a batch of individual emails.
   * Kept for backward compatibility but the thread-based method is preferred.
   */
  async classifyBatch(
    emails: ClassificationInput[],
    context: { companyName: string; industry: string; ownerEmail: string; companyDomains: string[] },
    openaiClient?: import('openai').default
  ): Promise<ClassificationResult[]> {
    if (emails.length === 0) return [];

    const results: ClassificationResult[] = [];
    for (let i = 0; i < emails.length; i += 50) {
      const batch = emails.slice(i, i + 50);
      const batchResults = await EmailAIClassifier.classifySingleBatch(batch, context, openaiClient);
      results.push(...batchResults);
      if (i + 50 < emails.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return results;
  },

  /**
   * Analyze full thread content to determine accurate pipeline stage.
   * Used during initial import for threads within 3-month window.
   */
  async analyzeThreads(
    threads: ThreadAnalysisInput[],
    context: { companyName: string; ownerEmail: string }
  ): Promise<ThreadAnalysisResult[]> {
    if (threads.length === 0) return [];

    const results: ThreadAnalysisResult[] = [];
    for (let i = 0; i < threads.length; i += 5) {
      const batch = threads.slice(i, i + 5);
      const batchResults = await EmailAIClassifier.analyzeThreadBatch(batch, context);
      results.push(...batchResults);
      if (i + 5 < threads.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return results;
  },

  /**
   * Triage threads — cheap first pass that only decides lead/not_lead.
   * Used in Phase A to identify which threads are worth extracting.
   * Sends last 3 messages with full body text per thread. Batches 15/call.
   */
  async triageThreads(
    threads: TriageInput[],
    context: { companyName: string; industry: string; ownerEmail: string; companyDomains: string[] },
    onProgress?: (processed: number, total: number) => Promise<void>
  ): Promise<TriageResult[]> {
    if (threads.length === 0) return [];

    const results: TriageResult[] = [];
    const BATCH_SIZE = 15;

    for (let i = 0; i < threads.length; i += BATCH_SIZE) {
      const batch = threads.slice(i, i + BATCH_SIZE);
      const batchResults = await EmailAIClassifier.triageSingleBatch(batch, context);
      results.push(...batchResults);
      if (onProgress) {
        await onProgress(Math.min(i + BATCH_SIZE, threads.length), threads.length);
      }
      if (i + BATCH_SIZE < threads.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return results;
  },

  /**
   * Deep extract leads — rich second pass that extracts everything from full thread context.
   * Used in Phase B after full thread fetch. Sends last 6 messages with full body text.
   * Batches 5/call for rich context per thread.
   */
  async deepExtractLeads(
    threads: DeepExtractionInput[],
    context: {
      companyName: string;
      industry: string;
      industries?: string[];
      ownerEmail: string;
      companyDomains: string[];
      employeeNames: string[];
      employeeEmails: string[];
    },
    onProgress?: (processed: number, total: number) => Promise<void>
  ): Promise<DeepExtractionResult[]> {
    if (threads.length === 0) return [];

    const results: DeepExtractionResult[] = [];
    const BATCH_SIZE = 5;
    const CONCURRENCY = 2; // Run 2 API calls concurrently — reduces rate limit pressure
    const STRIDE = BATCH_SIZE * CONCURRENCY; // 10 threads per round
    const MAX_RETRIES = 2;

    for (let i = 0; i < threads.length; i += STRIDE) {
      // Launch up to CONCURRENCY batches in parallel
      const batchInputs: DeepExtractionInput[][] = [];
      for (let j = 0; j < CONCURRENCY; j++) {
        const start = i + j * BATCH_SIZE;
        if (start >= threads.length) break;
        batchInputs.push(threads.slice(start, start + BATCH_SIZE));
      }

      const promises = batchInputs.map((batch) =>
        EmailAIClassifier.deepExtractSingleBatch(batch, context)
      );

      const settled = await Promise.allSettled(promises);

      // Collect results + identify failed batches for retry
      let failedBatches: DeepExtractionInput[][] = [];
      for (let k = 0; k < settled.length; k++) {
        const result = settled[k];
        if (result.status === 'fulfilled') {
          const allFallback = result.value.every((r) => r.stageConfidence === 0.3 && r.reason === 'extraction_failed');
          if (allFallback && result.value.length > 0) {
            failedBatches.push(batchInputs[k]);
          } else {
            results.push(...result.value);
          }
        } else {
          failedBatches.push(batchInputs[k]);
        }
      }

      // Retry failed batches sequentially with multiple attempts
      for (let attempt = 1; attempt <= MAX_RETRIES && failedBatches.length > 0; attempt++) {
        console.log(`[deep-extract] Retry attempt ${attempt}/${MAX_RETRIES} for ${failedBatches.length} failed batches...`);
        const stillFailed: DeepExtractionInput[][] = [];
        for (const batch of failedBatches) {
          await new Promise((r) => setTimeout(r, 1000 * attempt)); // increasing delay: 1s, 2s
          const retryResult = await EmailAIClassifier.deepExtractSingleBatch(batch, context);
          const allFallback = retryResult.every((r) => r.stageConfidence === 0.3 && r.reason === 'extraction_failed');
          if (allFallback && retryResult.length > 0) {
            stillFailed.push(batch);
          } else {
            results.push(...retryResult);
          }
        }
        failedBatches = stillFailed;
      }

      // Accept remaining failures as fallback
      for (const batch of failedBatches) {
        console.warn(`[deep-extract] Batch permanently failed after ${MAX_RETRIES} retries — using fallback for ${batch.length} threads`);
        const fallback = await EmailAIClassifier.deepExtractSingleBatch(batch, context);
        results.push(...fallback);
      }

      if (onProgress) {
        await onProgress(Math.min(i + STRIDE, threads.length), threads.length);
      }
      if (i + STRIDE < threads.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return results;
  },

  // ─── Private ────────────────────────────────────────────────────────────────

  async classifySingleThreadBatch(
    threads: ThreadSummaryInput[],
    context: { companyName: string; industry: string; ownerEmail: string; companyDomains: string[] }
  ): Promise<ThreadClassificationResult[]> {
    const systemPrompt = `You are classifying email THREADS for a trades/construction business.
Each item is a THREAD SUMMARY with up to 6 email excerpts (3 from client, 3 from owner). Use the email content, signatures, and headers to extract accurate client information.

Company: ${context.companyName}
Industry: ${context.industry}
Owner email: ${context.ownerEmail}
Company domains: ${context.companyDomains.join(', ')}

For each thread, determine:
- verdict: "lead" (customer inquiry/project conversation), "biz" (subtrade/vendor/contractor pitching THEIR services TO the company), "skip" (noise/spam/newsletter/internal/marketing agency)
  VERDICT RULES:
  - If a person or business is REQUESTING WORK, ASKING FOR QUOTES, or RECEIVING ESTIMATES from the company → "lead" (they are a customer)
  - If a business is asking "when will you invoice?" or similar → "lead" (they hired the company and are waiting to pay)
  - General contractors, property managers, or strata/co-ops requesting work → "lead"
  - Marketing agencies, advertisers, SEO firms, PR firms, content creators → "skip" (NOT leads even if they emailed the owner)
  - Vendors pitching their products/services TO the company → "biz"
  - Be inclusive — err on the side of "lead" over "skip" for ambiguous threads
- confidence: 0.0 to 1.0
- stage: pipeline stage if lead. MUST be one of: "new_lead", "qualifying", "quoting", "quoted", "follow_up", "negotiation", "won", "lost".
  Use "won" ONLY when there is CLEAR EVIDENCE the job was awarded — client explicitly confirmed, scheduling/start dates discussed, deposit/payment made, or work began.
  Use "lost" ONLY when there is CLEAR EVIDENCE — client declined, chose another contractor, said "no thanks", or 60+ days of repeated follow-ups with no response.
  When in doubt, choose an active stage ("quoted", "follow_up"). It is better to let the user triage than to guess wrong.
  Stage heuristics when unsure:
  - 0 outbound replies → "new_lead"
  - 1 outbound reply → "qualifying"
  - 2+ outbound, 4+ total messages → "quoting"
  - 3+ outbound, 6+ total → "quoted"
  - last message is outbound and thread seems dormant → "follow_up"
- val: estimated dollar value if pricing is mentioned. null otherwise.
- client: { name, email, phone, desc } — extract the CUSTOMER's info (not the owner). null if not a lead.

  ⚠️ CRITICAL NAME EXTRACTION RULES:
  1. NEVER derive a name from the email address local part. "paulkaren101@shaw.ca" does NOT mean the person is named "Paul Karen" or "Karen Paul". Only use names found in the email body, signatures, or FROM display name.
  2. Always use the person's FULL NAME (first + last). Search these locations in order:
     a. Email signature blocks (look for a name on its own line, often followed by a title or phone number)
     b. Sign-offs: "Sincerely, [Name]", "Thanks, [Name]", "Best regards, [Name]", "Cheers, [Name]"
     c. The owner's greeting in outbound replies: "Hi [Name]," — this gives the first name
     d. The FROM display name in email headers
  3. If a FROM display name looks like a username, handle, or abbreviation (e.g., "shaii mnl", "prism renovations"), DO NOT use it as the person's name. Search the email body for a real name instead.
  4. If you can only find a first name (e.g., from "Hi Earl," in the owner's reply), search the email body and signature for the last name. Return the first name alone ONLY as a last resort.
  5. For shared email accounts (e.g., "paulkaren101" = "Paul and Karen"), identify the primary person from the email content. If both are named, use the one who writes/signs the emails.
  6. If the email is from a business address (e.g., maintenance@marigoldcoop.ca), the client name is the PERSON (e.g., "Patrick"), not the business. Extract the person's name from greetings, signatures, or body text.

- additionalContacts: array of other people mentioned in the thread who are NOT the primary client and NOT the owner. Each has { name, email, phone }. These might be project managers, office staff, spouses, or other stakeholders cc'd or mentioned. Only include if you can identify a real name or email. null if none.
- dupes: array of other threadIds in this batch that appear to be the same client/project (for dedup)
- flag: OMIT this field. Use the stage field directly ("won" or "lost") instead.

RESPOND WITH JSON: { "results": [...] }. No explanation. Minimize tokens.`;

    const userPrompt = JSON.stringify(
      threads.map((t) => ({
        tid: t.threadId,
        subj: t.subject,
        from: t.firstSender,
        fromName: t.firstSenderName,
        participants: t.participants.slice(0, 5),
        msgs: t.messageCount,
        outbound: t.outboundCount,
        replied: t.hasUserReply,
        dir: t.direction,
        snip: t.latestSnippet,
        dates: t.dateRange,
        // Include email excerpts for context-rich classification
        ...(t.emailExcerpts?.length ? {
          emails: t.emailExcerpts.map((e) => ({
            from: e.from,
            name: e.fromName,
            to: e.to.slice(0, 3),
            dir: e.direction,
            date: e.date,
            body: e.body,
          }))
        } : {}),
      }))
    );

    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: threads.length * 150,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{"results":[]}';
      const parsed = JSON.parse(content);
      const rawResults = parsed.results || parsed;

      return (Array.isArray(rawResults) ? rawResults : []).map((r: Record<string, unknown>) => {
        const { stage, terminalFlag } = sanitizeStageAndFlag(
          (r.stage as string) || null,
          (r.flag as string) || (r.terminalFlag as string) || null
        );

        return {
          threadId: (r.tid as string) || (r.threadId as string),
          verdict: ((r.verdict as string) || 'skip') as ThreadClassificationResult['verdict'],
          confidence: (r.confidence as number) || (r.c as number) || 0,
          stage,
          estimatedValue: (r.val as number) || (r.estimatedValue as number) || null,
          client: (r.client as ThreadClassificationResult['client']) || null,
          additionalContacts: (r.additionalContacts as ThreadClassificationResult['additionalContacts']) || [],
          duplicateOf: (r.dupes as string[]) || (r.duplicateOf as string[]) || [],
          terminalFlag,
        };
      });
    } catch (err) {
      console.error('[email-ai-classifier] Thread batch classification failed:', err);
      return threads.map((t) => ({
        threadId: t.threadId,
        verdict: 'skip' as const,
        confidence: 0,
        stage: 'new_lead',
        estimatedValue: null,
        client: null,
        additionalContacts: [],
        duplicateOf: [],
        terminalFlag: null,
      }));
    }
  },

  async classifySingleBatch(
    emails: ClassificationInput[],
    context: { companyName: string; industry: string; ownerEmail: string; companyDomains: string[] },
    openaiClient?: import('openai').default
  ): Promise<ClassificationResult[]> {
    const systemPrompt = `You are classifying emails for a trades business.

Company: ${context.companyName}
Industry: ${context.industry}
Owner email: ${context.ownerEmail}
Company domains: ${context.companyDomains.join(', ')}

For each email, determine:
- verdict: "lead" (customer inquiry/conversation), "biz" (subtrade/vendor/contractor), "skip" (noise/spam/newsletter)
- confidence: 0.0 to 1.0
- stage: pipeline stage if lead. MUST be one of: "new_lead", "qualifying", "quoting", "quoted", "follow_up", "negotiation", "won", "lost". null if not a lead.
  Use "won" ONLY with CLEAR EVIDENCE — client explicitly confirmed, scheduling/start dates discussed, deposit/payment made, or work began. Silence after a quote does NOT mean won.
  Use "lost" ONLY with CLEAR EVIDENCE — client declined, chose another contractor, or 60+ days of follow-ups with no response.
  When in doubt, choose an active stage ("quoted", "follow_up").
- val: estimated dollar value if pricing is mentioned. null otherwise.
- client: { name, email, phone, desc } if lead. Extract from email content. null otherwise.
- dupes: array of other email IDs in this batch that appear to be from the same client/project
- flag: OMIT this field. Use the stage field directly ("won" or "lost") instead.

RESPOND WITH A JSON OBJECT: { "results": [...] }. No explanation. Minimize output tokens.`;

    const userPrompt = JSON.stringify(
      emails.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        subj: e.subject,
        snip: e.snippet.slice(0, 200),
        date: e.date,
        dir: e.direction,
      }))
    );

    try {
      const response = await getOpenAI(openaiClient).chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: emails.length * 80,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{"results":[]}';
      const parsed = JSON.parse(content);
      const rawResults = parsed.results || parsed;

      return (Array.isArray(rawResults) ? rawResults : []).map((r: Record<string, unknown>) => {
        const rawStage = (r.stage as string) || null;
        const rawFlag = (r.flag as string) || (r.terminalFlag as string) || null;
        const { stage, terminalFlag } = sanitizeStageAndFlag(rawStage, rawFlag);

        return {
          id: r.id as string,
          verdict: ((r.verdict as string) || 'skip') as ClassificationResult['verdict'],
          confidence: (r.confidence as number) || (r.c as number) || 0,
          stage: r.verdict === 'lead' ? stage : null,
          estimatedValue: (r.val as number) || (r.estimatedValue as number) || null,
          client: (r.client as ClassificationResult['client']) || null,
          duplicateOf: (r.dupes as string[]) || (r.duplicateOf as string[]) || [],
          terminalFlag,
        };
      });
    } catch (err) {
      console.error('[email-ai-classifier] Batch classification failed:', err);
      return emails.map((e) => ({
        id: e.id,
        verdict: 'skip' as const,
        confidence: 0,
        stage: null,
        estimatedValue: null,
        client: null,
        duplicateOf: [],
        terminalFlag: null,
      }));
    }
  },

  async analyzeThreadBatch(
    threads: ThreadAnalysisInput[],
    context: { companyName: string; ownerEmail: string }
  ): Promise<ThreadAnalysisResult[]> {
    const systemPrompt = `You are analyzing email threads for a trades business to determine pipeline stage.

Company: ${context.companyName}
Owner: ${context.ownerEmail}

Pipeline stages (in order):
- new_lead: inquiry received, no reply yet
- qualifying: initial contact made, gathering info (photos, measurements)
- quoting: actively building an estimate
- quoted: estimate with pricing has been sent
- follow_up: waiting for client response after quote
- negotiation: client responded to quote, discussing terms
- won: client EXPLICITLY confirmed — "go ahead", "let's book it", scheduling confirmed, deposit paid
- lost: client EXPLICITLY declined — "went with someone else", "not going ahead", "too expensive", or 60+ days of follow-ups with zero response

CRITICAL: Use "won" or "lost" ONLY with clear evidence in the email content. Silence after a quote does NOT mean won — many clients ghost quotes they don't like. When in doubt, use an active stage ("quoted", "follow_up").

For each thread, determine:
- stage: most accurate pipeline stage based on content (MUST be one of the 8 stages above)
- c: confidence 0.0 to 1.0
- val: dollar value if pricing detected
- signals: array of short codes for what you detected (e.g., "pricing_sent", "photos_requested", "promo_mentioned")
- flag: OMIT this field. Use the stage field directly ("won" or "lost") instead.

RESPOND WITH JSON: { "results": [...] }. No explanation.`;

    const userPrompt = JSON.stringify(
      threads.map((t) => ({
        tid: t.threadId,
        msgs: t.messages.map((m) => ({
          dir: m.direction,
          from: m.from,
          subj: m.subject,
          body: m.bodyText.slice(0, 500),
          date: m.date,
        })),
      }))
    );

    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: threads.length * 50,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{"results":[]}';
      const parsed = JSON.parse(content);
      const rawResults = parsed.results || parsed;

      return (Array.isArray(rawResults) ? rawResults : []).map((r: Record<string, unknown>) => {
        const { stage, terminalFlag } = sanitizeStageAndFlag(
          (r.stage as string) || null,
          (r.flag as string) || (r.terminalFlag as string) || null
        );

        return {
          threadId: (r.tid as string) || (r.threadId as string),
          stage,
          confidence: (r.c as number) || (r.confidence as number) || 0.5,
          estimatedValue: (r.val as number) || (r.estimatedValue as number) || null,
          signals: (r.signals as string[]) || [],
          terminalFlag,
        };
      });
    } catch (err) {
      console.error('[email-ai-classifier] Thread analysis failed:', err);
      return threads.map((t) => ({
        threadId: t.threadId,
        stage: 'new_lead',
        confidence: 0.5,
        estimatedValue: null,
        signals: [],
        terminalFlag: null,
      }));
    }
  },

  async triageSingleBatch(
    threads: TriageInput[],
    context: { companyName: string; industry: string; ownerEmail: string; companyDomains: string[] }
  ): Promise<TriageResult[]> {
    const systemPrompt = `You are triaging email threads for a trades/construction business. Your ONLY job is to decide: is this a potential customer lead, or not?

Company: ${context.companyName}
Industry: ${context.industry}
Owner email: ${context.ownerEmail}
Company domains: ${context.companyDomains.join(', ')}

For each thread, return:
- verdict: "lead" or "not_lead"
- confidence: 0.0 to 1.0

LEAD = customer inquiry, project conversation, quote request, someone hiring the company, property manager/GC requesting work, someone the company sent an estimate to
NOT_LEAD = spam, newsletter, vendor pitching TO the company, marketing agency, internal, automated notification

CRITICAL: When in doubt, say "lead". It is far better to include a questionable thread than to lose a real customer. Be generous.

RESPOND WITH JSON: { "results": [{ "tid": "...", "v": "lead"|"not_lead", "c": 0.0-1.0 }] }. No explanation.`;

    const userPrompt = JSON.stringify(
      threads.map((t) => ({
        tid: t.threadId,
        subj: t.subject,
        participants: t.participants.slice(0, 5),
        msgs: t.messageCount,
        out: t.outboundCount,
        replied: t.hasUserReply,
        dir: t.direction,
        emails: t.messages.map((m) => ({
          from: m.from,
          name: m.fromName,
          to: m.to.slice(0, 3),
          dir: m.direction,
          date: m.date,
          body: m.body,
        })),
      }))
    );

    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: threads.length * 20,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{"results":[]}';
      const parsed = JSON.parse(content);
      const rawResults = parsed.results || parsed;

      return (Array.isArray(rawResults) ? rawResults : []).map((r: Record<string, unknown>) => ({
        threadId: (r.tid as string) || (r.threadId as string),
        verdict: ((r.v as string) || (r.verdict as string) || 'not_lead') as TriageResult['verdict'],
        confidence: (r.c as number) || (r.confidence as number) || 0,
      }));
    } catch (err) {
      console.error('[email-ai-classifier] Triage batch failed:', err);
      // Fail open — mark all as leads so we don't lose anything
      return threads.map((t) => ({
        threadId: t.threadId,
        verdict: 'lead' as const,
        confidence: 0.5,
      }));
    }
  },

  async deepExtractSingleBatch(
    threads: DeepExtractionInput[],
    context: {
      companyName: string;
      industry: string;
      industries?: string[];
      ownerEmail: string;
      companyDomains: string[];
      employeeNames: string[];
      employeeEmails: string[];
    }
  ): Promise<DeepExtractionResult[]> {
    const teamList = context.employeeEmails.length > 0
      ? context.employeeEmails.map((e, i) => `${context.employeeNames[i] || 'unknown'} (${e})`).join(', ')
      : 'none known';

    const servicesLine = context.industries?.length
      ? `Services offered: ${context.industries.join(', ')}`
      : `Industry: ${context.industry}`;

    const systemPrompt = `You are extracting lead information from email threads for a trades/construction business.

Company: ${context.companyName}
${servicesLine}
Owner email: ${context.ownerEmail}
Company domains: ${context.companyDomains.join(', ')}
Team members: ${teamList}

UNDERSTANDING THE BUSINESS: ${context.companyName} PROVIDES the services listed above. They build, install, and repair things for their CLIENTS. Their clients are homeowners, property managers, general contractors, developers, and businesses who HIRE them. Anyone who SELLS products, materials, or services TO ${context.companyName} is a VENDOR, not a client.

STEP 1 — CLASSIFY each thread into one of three categories:

LEAD (include in "leads") — a CUSTOMER who hires or pays ${context.companyName}:
- Someone REQUESTING work, quotes, or estimates FROM ${context.companyName}
- Someone who RECEIVED an estimate/quote from ${context.companyName}
- A homeowner, property manager, GC, or developer HIRING the company
- A strata/co-op requesting maintenance or repairs
- A general contractor who hires ${context.companyName} as a subtrade for THEIR projects

REVIEW (include in "review") — not a standard client lead but needs the owner's attention:
- Legal matters: settlement agreements, disputes, liens, lawyer correspondence about a project
- Job seekers: someone looking for work/employment (the owner may want to hire them)
- Collections/credit: invoice disputes, overdue payment follow-ups from creditors
- Platform bid requests: notifications from Procore, Buildertrend, BuildingConnected, SmartBidNet, or similar construction platforms about bid invitations or submittals — the ACTUAL client is behind the platform and should be reviewed
- Warranty/callback: a past client reporting an issue after project completion
- Anything ambiguous where the relationship direction is unclear

SKIP (include in "skip") — definitely NOT a lead or review item:
- A SUPPLIER/VENDOR selling materials TO ${context.companyName} (glass, lumber, railing supplies). Signal: THEY send invoices/POs/delivery notices TO the company, signature says "Sales Rep"/"Account Manager"
- A SERVICE PROVIDER working FOR the company (accountants, insurance, marketing, bookkeepers) — UNLESS it's a legal matter (→ review)
- Spam, newsletters, automated notifications, app/software platform emails
- Internal company emails between employees

STEP 2 — FOR LEADS ONLY, extract:

CLIENT INFO:
- client.name: For PERSONAL clients (gmail/yahoo/hotmail/shaw/telus/icloud/outlook), extract the person's FULL NAME from signatures, sign-offs, or owner's greeting ("Hi [Name],"). NEVER derive from email address.
  For BUSINESS clients (custom domain like @storyconstruction.ca, @firstgeneral.ca), the client.name MUST be the COMPANY name with PROPER formatting. Do NOT just lowercase or capitalize the email domain. Look for the real company name in email signatures, the email body, or letterhead. Split concatenated domain words and capitalize properly:
  - "colyvanpacific.com" → "Colyvan Pacific"
  - "wjconstruction.ca" → "W&J Construction Ltd." (look for the real name in email content)
  - "firstgeneral.ca" → "First General Services" (from their signature block)
  - "kpfstructural.com" → "KPF Structural" (preserve acronyms)
  - "marketreadyltd.com" → "Market Ready Ltd."
  - "lorvalcapital.ca" → "Lorval Capital"
  The individual person goes in subContacts.
- client.email: The primary contact email for this client
- client.phone: Primary contact phone if found (omit if not found)
- client.addr: Physical address if mentioned — project site address, client home address, or job location. Extract the most complete address found (street, city, province/state). Omit if not found.
- client.desc: What they need (1-2 sentences) — this becomes the pipeline opportunity title in CRM. Be specific: include measurements, materials mentioned.

SUBCONTACTS — People at the client who are NOT the owner and NOT employees of ${context.companyName}:
- For BUSINESS clients: the primary person MUST be the first subContact (same email/phone as client). Add any other people from CC/signatures.
- For PERSONAL clients: only add if there are additional people involved (spouse, project manager, etc.)
- Each subContact: { name, email, phone }. The name MUST be a real person's name — NEVER an email address, NEVER a phone number. If you can only find a first name, use just the first name. Omit phone if not found.
- CRITICAL: The email field must contain an email address. The phone field must contain a phone number. Never swap them.

PIPELINE:
- stage: "new_lead"|"qualifying"|"quoting"|"quoted"|"follow_up"|"negotiation"|"won"|"lost"
  Use "won" when there is CLEAR EVIDENCE the job was awarded — the client explicitly confirmed, scheduling/start dates were discussed, a deposit/payment was made, or work clearly began. Do NOT assume won from silence alone.
  Use "lost" when there is CLEAR EVIDENCE the opportunity is dead — the client explicitly declined, chose another contractor, said "no thanks", or the thread shows repeated follow-ups with no response over 60+ days.
  When in doubt between won/lost and an active stage, choose the active stage. It is better to let the user triage than to guess wrong.
- stageC: Confidence 0.0-1.0
- val: Dollar value if pricing is mentioned (omit if none)
- flag: OMIT this field. Use the stage field directly ("won" or "lost") instead.

STAGE DECISION GUIDE (read the email content carefully):
- "won" signals: client says "go ahead", "let's book it", "sounds good let's proceed", scheduling/start date confirmed, deposit/payment discussed, work instructions given
- "lost" signals: client says "we went with someone else", "not going ahead", "too expensive", "no longer needed", repeated follow-ups with zero response over 60+ days
- "quoted" signals: estimate/quote was sent, waiting for response (even if old — do NOT assume won from silence)
- "follow_up" signals: quote sent, follow-up emails sent, still no definitive answer
- Silence after a quote does NOT mean won. Many clients ghost quotes they don't like. Only mark "won" if there is positive confirmation in the emails.

STEP 3 — FOR REVIEW items, extract minimal info:
- tid, client.name, client.email, client.desc (what the thread is about — "Settlement agreement for Mike Geric project", "Job application from Grade 12 student", "Procore bid invitation for Royal Bay Apartments")
- reviewReason: one of "legal"|"job_seeker"|"collections"|"platform_bid"|"warranty"|"ambiguous"

TOKEN EFFICIENCY RULES:
- OMIT any field that would be null, empty, or []. Do not include it at all.
- For skipped threads, include ONLY the tid in the "skip" array.
- Keep desc concise but specific (it becomes the opportunity title in CRM).

RESPOND WITH JSON:
{
  "leads": [{ "tid": "...", "client": {...}, "stage": "...", "stageC": 0.8, ... }],
  "review": [{ "tid": "...", "client": {...}, "reviewReason": "legal" }],
  "skip": ["tid1", "tid2", ...]
}
No explanation.`;

    const userPrompt = JSON.stringify(
      threads.map((t) => ({
        tid: t.threadId,
        subj: t.subject,
        participants: t.participants.slice(0, 8),
        msgs: t.messageCount,
        out: t.outboundCount,
        emails: t.messages.map((m) => ({
          from: m.from,
          name: m.fromName,
          to: m.to.slice(0, 3),
          dir: m.direction,
          date: m.date,
          body: m.body,
        })),
      }))
    );

    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{"leads":[],"skip":[]}';
      const parsed = JSON.parse(content);

      // Format: { "leads": [...], "review": [...], "skip": ["tid1", ...] }
      const rawLeads: Record<string, unknown>[] = parsed.leads || parsed.results || [];
      const rawReview: Record<string, unknown>[] = parsed.review || [];
      const skipTids = new Set<string>((parsed.skip || []) as string[]);

      console.log(`[deep-extract] Batch of ${threads.length} threads → ${rawLeads.length} leads, ${rawReview.length} review, ${skipTids.size} skipped`);

      const results: DeepExtractionResult[] = [];

      // Parse leads
      for (let idx = 0; idx < rawLeads.length; idx++) {
        const r = rawLeads[idx];
        const { stage, terminalFlag } = sanitizeStageAndFlag(
          (r.stage as string) || null,
          (r.flag as string) || null
        );
        const client = r.client as { name?: string; email?: string; phone?: string | null; desc?: string; description?: string; addr?: string; address?: string } | null;

        let threadId = (r.tid as string) || (r.threadId as string);
        if (!threadId && idx < threads.length) {
          threadId = threads[idx].threadId;
        }

        results.push({
          threadId,
          client: {
            name: client?.name || '',
            email: client?.email || '',
            phone: client?.phone || null,
            description: client?.desc || client?.description || '',
            address: client?.addr || client?.address || null,
          },
          subContacts: ((r.subContacts || r.additionalContacts) as Array<{ name: string; email: string; phone: string | null }>) || [],
          companyName: (r.companyName as string) || null,
          stage,
          stageConfidence: (r.stageC as number) || (r.stageConfidence as number) || 0.5,
          estimatedValue: (r.val as number) || (r.estimatedValue as number) || null,
          isLead: true,
          needsReview: false,
          reviewReason: null,
          reason: (r.reason as string) || null,
          terminalFlag,
        });
      }

      // Parse review items — flagged for user attention
      for (const r of rawReview) {
        const client = r.client as { name?: string; email?: string; phone?: string | null; desc?: string; description?: string; addr?: string; address?: string } | null;
        const threadId = (r.tid as string) || (r.threadId as string);
        const reviewReason = (r.reviewReason as string) || 'ambiguous';
        console.log(`[deep-extract] REVIEW: tid=${threadId} reason=${reviewReason} name=${client?.name || '?'}`);

        results.push({
          threadId,
          client: {
            name: client?.name || '',
            email: client?.email || '',
            phone: client?.phone || null,
            description: client?.desc || client?.description || '',
            address: client?.addr || client?.address || null,
          },
          subContacts: [],
          companyName: null,
          stage: 'new_lead',
          stageConfidence: 0.5,
          estimatedValue: null,
          isLead: true, // Keep in results — user decides
          needsReview: true,
          reviewReason: reviewReason as DeepExtractionResult['reviewReason'],
          reason: null,
          terminalFlag: null,
        });
      }

      // Mark skipped threads as not-lead
      for (const tid of skipTids) {
        results.push({
          threadId: tid,
          client: { name: '', email: '', phone: null, description: '', address: null },
          subContacts: [],
          companyName: null,
          stage: 'new_lead',
          stageConfidence: 0,
          estimatedValue: null,
          isLead: false,
          needsReview: false,
          reviewReason: null,
          reason: 'skipped by extraction',
          terminalFlag: null,
        });
      }

      // Fill any threads not accounted for (fail open)
      const accountedTids = new Set(results.map((r) => r.threadId));
      for (const t of threads) {
        if (!accountedTids.has(t.threadId)) {
          console.warn(`[deep-extract] Thread ${t.threadId} not in leads/review/skip — keeping as lead (fail open)`);
          results.push({
            threadId: t.threadId,
            client: { name: '', email: '', phone: null, description: '', address: null },
            subContacts: [],
            companyName: null,
            stage: 'new_lead',
            stageConfidence: 0.3,
            estimatedValue: null,
            isLead: true,
            needsReview: false,
            reviewReason: null,
            reason: null,
            terminalFlag: null,
          });
        }
      }

      return results;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errDetail = (err as Record<string, unknown>)?.status || (err as Record<string, unknown>)?.code || '';
      console.error(`[email-ai-classifier] Deep extraction batch FAILED: ${errMsg} ${errDetail}`);
      // Return empty results so leads aren't lost — Phase B will use fallback data
      return threads.map((t) => ({
        threadId: t.threadId,
        client: { name: '', email: '', phone: null, description: '', address: null },
        subContacts: [],
        companyName: null,
        stage: 'new_lead',
        stageConfidence: 0.3,
        estimatedValue: null,
        isLead: true,
        needsReview: false,
        reviewReason: null,
        reason: 'extraction_failed',
        terminalFlag: null,
      }));
    }
  },
};
