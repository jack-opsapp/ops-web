// src/lib/api/services/email-ai-classifier.ts
// Redesigned AI classification — validates ALL candidates, extracts client info,
// assigns pipeline stages, and detects duplicates across threads.
//
// Key differences from email-classifier.ts:
// - Validates pattern-matched leads (not just unmatched)
// - Returns per-email structured data (not just filter recommendations)
// - Detects duplicates across threads
// - Assigns pipeline stages based on thread content
// - Minimal output tokens (~50 per email)

import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

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
   * Classify a batch of emails — validates all candidates including pattern-matched ones.
   * Extracts client info, detects duplicates. Minimal output tokens.
   */
  async classifyBatch(
    emails: ClassificationInput[],
    context: { companyName: string; industry: string; ownerEmail: string; companyDomains: string[] }
  ): Promise<ClassificationResult[]> {
    if (emails.length === 0) return [];

    // Batch into groups of 50 to keep token counts manageable
    const results: ClassificationResult[] = [];
    for (let i = 0; i < emails.length; i += 50) {
      const batch = emails.slice(i, i + 50);
      const batchResults = await EmailAIClassifier.classifySingleBatch(batch, context);
      results.push(...batchResults);
      // Rate limit: 200ms between batches
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
    // Process 5 threads per API call to amortize system prompt
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

  // --- Private ---

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
- stage: pipeline stage if lead. One of: "new_lead", "qualifying", "quoting", "quoted", "follow_up", "negotiation". null if not a lead.
- val: estimated dollar value if pricing is mentioned. null otherwise.
- client: { name, email, phone, desc } if lead. Extract from email content. null otherwise.
- dupes: array of other email IDs in this batch that appear to be from the same client/project
- flag: "likely_won" if client confirmed, "likely_lost" if client declined, null otherwise

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

      return (Array.isArray(rawResults) ? rawResults : []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        verdict: ((r.verdict as string) || 'skip') as ClassificationResult['verdict'],
        confidence: (r.confidence as number) || (r.c as number) || 0,
        stage: (r.stage as string) || null,
        estimatedValue: (r.val as number) || (r.estimatedValue as number) || null,
        client: (r.client as ClassificationResult['client']) || null,
        duplicateOf: (r.dupes as string[]) || (r.duplicateOf as string[]) || [],
        terminalFlag: ((r.flag || r.terminalFlag) as ClassificationResult['terminalFlag']) || null,
      }));
    } catch (err) {
      console.error('[email-ai-classifier] Batch classification failed:', err);
      // Return all as skip on error — don't lose the emails
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

For each thread, determine:
- stage: most accurate pipeline stage based on content
- c: confidence 0.0 to 1.0
- val: dollar value if pricing detected
- signals: array of short codes for what you detected (e.g., "pricing_sent", "photos_requested", "promo_mentioned")
- flag: "likely_won" or "likely_lost" if terminal language detected, null otherwise

RESPOND ONLY WITH JSON ARRAY. No explanation.`;

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

      return (Array.isArray(rawResults) ? rawResults : []).map((r: Record<string, unknown>) => ({
        threadId: (r.tid as string) || (r.threadId as string),
        stage: (r.stage as string) || 'new_lead',
        confidence: (r.c as number) || (r.confidence as number) || 0.5,
        estimatedValue: (r.val as number) || (r.estimatedValue as number) || null,
        signals: (r.signals as string[]) || [],
        terminalFlag: ((r.flag || r.terminalFlag) as ThreadAnalysisResult['terminalFlag']) || null,
      }));
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
