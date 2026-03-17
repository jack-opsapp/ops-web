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
// - Validates stage values — never allows likely_won/likely_lost as stage

import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Valid pipeline stages — used for validation
const VALID_STAGES = ['new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up', 'negotiation'] as const;
type ValidStage = typeof VALID_STAGES[number];

function isValidStage(stage: string): stage is ValidStage {
  return (VALID_STAGES as readonly string[]).includes(stage);
}

/** Sanitize a stage value from AI output. Moves likely_won/likely_lost to flag if needed. */
function sanitizeStageAndFlag(
  rawStage: string | null | undefined,
  rawFlag: string | null | undefined
): { stage: string; terminalFlag: 'likely_won' | 'likely_lost' | null } {
  const stage = rawStage && isValidStage(rawStage) ? rawStage : 'new_lead';
  // If AI put likely_won/likely_lost in the stage field, rescue it to flag
  let terminalFlag: 'likely_won' | 'likely_lost' | null =
    (rawFlag === 'likely_won' || rawFlag === 'likely_lost') ? rawFlag : null;
  if (!terminalFlag && (rawStage === 'likely_won' || rawStage === 'likely_lost')) {
    terminalFlag = rawStage;
  }
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
    // Batch 10 threads per API call (email excerpts make each thread ~3KB)
    const BATCH_SIZE = 10;
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
    context: { companyName: string; industry: string; ownerEmail: string; companyDomains: string[] }
  ): Promise<ClassificationResult[]> {
    if (emails.length === 0) return [];

    const results: ClassificationResult[] = [];
    for (let i = 0; i < emails.length; i += 50) {
      const batch = emails.slice(i, i + 50);
      const batchResults = await EmailAIClassifier.classifySingleBatch(batch, context);
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
- verdict: "lead" (customer inquiry/project conversation), "biz" (subtrade/vendor/contractor), "skip" (noise/spam/newsletter/internal)
- confidence: 0.0 to 1.0
- stage: pipeline stage if lead. MUST be one of: "new_lead", "qualifying", "quoting", "quoted", "follow_up", "negotiation". NEVER use "likely_won" or "likely_lost" as a stage — those go ONLY in the flag field.
  Stage heuristics when unsure:
  - 0 outbound replies → "new_lead"
  - 1 outbound reply → "qualifying"
  - 2+ outbound, 4+ total messages → "quoting"
  - 3+ outbound, 6+ total → "quoted"
  - last message is outbound and thread seems dormant → "follow_up"
- val: estimated dollar value if pricing is mentioned. null otherwise.
- client: { name, email, phone, desc } — extract the CUSTOMER's info (not the owner). null if not a lead.
  IMPORTANT: Always use the person's FULL NAME (first + last name). Check the "from" display name, email signature, and message body for the last name. If the email header says "Laura" but the body or signature says "Laura Eby", use "Laura Eby". Never return just a first name when a last name is available anywhere in the thread.
- additionalContacts: array of other people mentioned in the thread who are NOT the primary client and NOT the owner. Each has { name, email, phone }. These might be project managers, office staff, spouses, or other stakeholders cc'd or mentioned. Only include if you can identify a real name or email. null if none.
- dupes: array of other threadIds in this batch that appear to be the same client/project (for dedup)
- flag: "likely_won" if client confirmed/accepted, "likely_lost" if client declined/went elsewhere, null otherwise. This is the ONLY place for terminal flags.

IMPORTANT: In trades, any personal email thread with a non-company person about work/projects/quotes/estimates IS a lead. Be inclusive — err on the side of "lead" over "skip" for ambiguous threads.

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
        snip: t.latestSnippet.slice(0, 300),
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
    context: { companyName: string; industry: string; ownerEmail: string; companyDomains: string[] }
  ): Promise<ClassificationResult[]> {
    const systemPrompt = `You are classifying emails for a trades business.

Company: ${context.companyName}
Industry: ${context.industry}
Owner email: ${context.ownerEmail}
Company domains: ${context.companyDomains.join(', ')}

For each email, determine:
- verdict: "lead" (customer inquiry/conversation), "biz" (subtrade/vendor/contractor), "skip" (noise/spam/newsletter)
- confidence: 0.0 to 1.0
- stage: pipeline stage if lead. MUST be one of: "new_lead", "qualifying", "quoting", "quoted", "follow_up", "negotiation". NEVER use "likely_won" or "likely_lost" as a stage value — those go ONLY in the flag field. null if not a lead.
- val: estimated dollar value if pricing is mentioned. null otherwise.
- client: { name, email, phone, desc } if lead. Extract from email content. null otherwise.
- dupes: array of other email IDs in this batch that appear to be from the same client/project
- flag: "likely_won" if client confirmed, "likely_lost" if client declined, null otherwise. This is the ONLY place for terminal flags.

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
      const response = await getOpenAI().chat.completions.create({
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

CRITICAL: stage MUST be one of the above values. NEVER use "likely_won" or "likely_lost" as a stage value — those go ONLY in the flag field.

For each thread, determine:
- stage: most accurate pipeline stage based on content (MUST be one of the 6 stages above)
- c: confidence 0.0 to 1.0
- val: dollar value if pricing detected
- signals: array of short codes for what you detected (e.g., "pricing_sent", "photos_requested", "promo_mentioned")
- flag: "likely_won" or "likely_lost" if terminal language detected, null otherwise

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
};
