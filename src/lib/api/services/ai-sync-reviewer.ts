// src/lib/api/services/ai-sync-reviewer.ts
// Feature-gated AI review that runs on each sync cycle.
// Uses OPENAI_API_KEY_SYNC for all AI calls — separate from import key.
//
// evaluateStages performs a COMBINED stage evaluation + opportunity summary
// in a single API call to reduce cost and latency.

import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { EmailAIClassifier } from "./email-ai-classifier";
import { EmailService } from "./email-service";
import { getSyncOpenAI } from "./openai-clients";
import { detectTerminalStageFromMessages } from "@/lib/email/terminal-stage-decision";
import { resolvePersistedEmailDirection } from "@/lib/email/email-ingestion-routing";
import type { NormalizedEmail } from "./email-provider";
import type {
  EmailConnection,
  SyncProfile,
} from "@/lib/types/email-connection";

export interface AIClassifiedLead {
  email: NormalizedEmail;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  address: string | null;
  description: string;
  stage: string;
  estimatedValue: number | null;
  /** Model-reported classification confidence (0..1) for provenance. */
  confidence: number;
}

export interface AIReviewResult {
  newLeadsClassified: number;
  classifiedLeads: AIClassifiedLead[];
  stageChanges: number;
  terminalFlags: Array<{
    opportunityId: string;
    clientName: string;
    flag: "likely_won" | "likely_lost";
  }>;
  duplicatesDetected: number;
}

// ─── Stage validation ────────────────────────────────────────────────────────

const VALID_STAGES = [
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
] as const;
type ActiveOpportunityStage = (typeof VALID_STAGES)[number];

function sanitizeStage(
  raw: string | null | undefined
): ActiveOpportunityStage | null {
  if (raw && (VALID_STAGES as readonly string[]).includes(raw)) {
    return raw as ActiveOpportunityStage;
  }
  return null;
}

function sanitizeTerminalFlag(
  raw: string | null | undefined
): "likely_won" | "likely_lost" | null {
  if (raw === "likely_won" || raw === "likely_lost") return raw;
  return null;
}

// ─── Module-level helpers ───────────────────────────────────────────────────

function emptyReviewResult(): AIReviewResult {
  return {
    newLeadsClassified: 0,
    classifiedLeads: [],
    stageChanges: 0,
    terminalFlags: [],
    duplicatesDetected: 0,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const AISyncReviewer = {
  /**
   * Run AI review on unmatched emails from the current sync cycle.
   * Only called if phase_c is enabled (collapsed from ai_email_review 2026-04-24).
   * Passes the SYNC OpenAI client to the classifier.
   */
  async reviewUnmatchedEmails(
    unmatchedEmails: NormalizedEmail[],
    connection: EmailConnection,
    companyContext: { name: string; industry: string; domains: string[] }
  ): Promise<AIReviewResult> {
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      connection.companyId,
      "phase_c"
    );
    if (!enabled) return emptyReviewResult();

    const threshold =
      (connection.syncFilters as SyncProfile | undefined)
        ?.aiClassificationThreshold || 0.7;

    // Pass the SYNC OpenAI client so classification uses the sync API key
    const syncClient = getSyncOpenAI();

    const sourceEmailById = new Map<string, NormalizedEmail>();
    for (const sourceEmail of unmatchedEmails) {
      if (!sourceEmail.id || sourceEmailById.has(sourceEmail.id)) {
        throw new Error(
          `[ai-sync-reviewer] duplicate unmatched input ${sourceEmail.id || "<empty>"}`
        );
      }
      sourceEmailById.set(sourceEmail.id, sourceEmail);
    }

    const classificationInputs = unmatchedEmails.map((e) => ({
      id: e.id,
      threadId: e.threadId,
      from: e.from,
      to: e.to,
      subject: e.subject,
      snippet: e.snippet,
      // Pass the cleaned body so the classifier can recover address/scope;
      // it is capped to 1500 chars inside classifySingleBatch.
      body: e.bodyTextClean || e.bodyText || e.snippet,
      date: e.date.toISOString(),
      direction: resolvePersistedEmailDirection(e, {
        connectionEmail: connection.email,
        companyDomains:
          connection.syncFilters?.companyDomains ?? companyContext.domains,
        userEmailAddresses: connection.syncFilters?.userEmailAddresses ?? [],
      }),
    }));
    const classifications = await EmailAIClassifier.classifyBatch(
      classificationInputs,
      {
        companyName: companyContext.name,
        industry: companyContext.industry,
        ownerEmail: connection.email,
        companyDomains: companyContext.domains,
      },
      syncClient
    );

    const classificationById = new Map<
      string,
      (typeof classifications)[number]
    >();
    for (const classification of classifications) {
      if (!sourceEmailById.has(classification.id)) {
        throw new Error(
          `[ai-sync-reviewer] classifier returned unknown input ${classification.id}`
        );
      }
      if (classificationById.has(classification.id)) {
        throw new Error(
          `[ai-sync-reviewer] classifier duplicated input ${classification.id}`
        );
      }
      classificationById.set(classification.id, classification);
    }

    const orderedClassifications = unmatchedEmails.map((sourceEmail) => {
      const classification = classificationById.get(sourceEmail.id);
      if (!classification) {
        throw new Error(
          `[ai-sync-reviewer] classifier omitted input ${sourceEmail.id}`
        );
      }
      return classification;
    });

    const leads = orderedClassifications.filter(
      (c) => c.verdict === "lead" && c.confidence >= threshold
    );

    // Build classified leads with their source emails for persistence
    const classifiedLeads: AIClassifiedLead[] = leads.map((c) => ({
      email: sourceEmailById.get(c.id)!,
      clientName: c.client?.name ?? null,
      clientEmail: c.client?.email ?? null,
      clientPhone: c.client?.phone ?? null,
      address: c.client?.address ?? null,
      description: c.client?.description ?? "",
      stage: c.stage || "new_lead",
      estimatedValue: c.estimatedValue,
      confidence: c.confidence,
    }));

    return {
      newLeadsClassified: leads.length,
      classifiedLeads,
      stageChanges: 0,
      terminalFlags: [],
      duplicatesDetected: orderedClassifications.filter(
        (c) => c.duplicateOf.length > 0
      ).length,
    };
  },

  /**
   * Re-evaluate stages AND generate a 1-2 sentence opportunity summary
   * for active leads that received new emails. Combined into a single
   * API call to minimize cost.
   *
   * Only called if phase_c is enabled (collapsed from ai_email_review 2026-04-24).
   * Uses OPENAI_API_KEY_SYNC directly (no delegation to EmailAIClassifier).
   */
  async evaluateStagesWithSummary(
    activeLeadTargets: Array<
      | string
      | {
          /** Logical evaluation key; message-scoped for contact forms. */
          threadId: string;
          /** Explicit messages prevent fetching a reused platform thread. */
          messages: NormalizedEmail[];
        }
    >,
    connection: EmailConnection,
    companyContext: { name: string }
  ): Promise<
    Array<{
      threadId: string;
      newStage: string | null;
      terminalFlag: "likely_won" | "likely_lost" | null;
      summary: string | null;
    }>
  > {
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      connection.companyId,
      "phase_c"
    );
    if (!enabled) return [];

    const provider = EmailService.getProvider(connection);

    // Fetch every active thread. Silently truncating this list leaves later
    // opportunities permanently stale when a busy sync contains >20 threads.
    const threadInputs: Array<{
      threadId: string;
      messages: Array<{
        from: string;
        to: string[];
        subject: string;
        bodyText: string;
        date: string;
        direction: "inbound" | "outbound";
      }>;
    }> = [];

    for (const target of activeLeadTargets) {
      const threadId = typeof target === "string" ? target : target.threadId;
      let messages: NormalizedEmail[];
      if (typeof target === "string") {
        try {
          messages = await provider.fetchThread(threadId);
        } catch (err) {
          throw new Error(
            `[ai-sync-reviewer] failed to fetch thread ${threadId}: ${err instanceof Error ? err.message : "unknown error"}`,
            { cause: err }
          );
        }
      } else {
        messages = target.messages;
      }
      threadInputs.push({
        threadId,
        messages: messages.map((m) => ({
          from: m.from,
          to: m.to,
          subject: m.subject,
          bodyText: m.bodyText,
          date: m.date.toISOString(),
          direction: resolvePersistedEmailDirection(m, {
            connectionEmail: connection.email,
            companyDomains: connection.syncFilters?.companyDomains ?? [],
            userEmailAddresses:
              connection.syncFilters?.userEmailAddresses ?? [],
          }),
        })),
      });
    }

    if (threadInputs.length === 0) return [];

    // Process in batches of 5 threads per API call
    const results: Array<{
      threadId: string;
      newStage: string | null;
      terminalFlag: "likely_won" | "likely_lost" | null;
      summary: string | null;
    }> = [];

    const BATCH_SIZE = 5;
    for (let i = 0; i < threadInputs.length; i += BATCH_SIZE) {
      const batch = threadInputs.slice(i, i + BATCH_SIZE);
      const batchResults = await this.evaluateSingleBatch(
        batch,
        companyContext.name,
        connection.email
      );
      results.push(...batchResults);
      if (i + BATCH_SIZE < threadInputs.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return results;
  },

  /**
   * Internal: Combined stage + summary evaluation for a batch of threads.
   * Single API call returns both stage and a concise opportunity summary.
   */
  async evaluateSingleBatch(
    threads: Array<{
      threadId: string;
      messages: Array<{
        from: string;
        to: string[];
        subject: string;
        bodyText: string;
        date: string;
        direction: "inbound" | "outbound";
      }>;
    }>,
    companyName: string,
    ownerEmail: string
  ): Promise<
    Array<{
      threadId: string;
      newStage: string | null;
      terminalFlag: "likely_won" | "likely_lost" | null;
      summary: string | null;
    }>
  > {
    const systemPrompt = `You are analyzing email threads for a trades business to determine pipeline stage and generate a brief opportunity summary.

Company: ${companyName}
Owner: ${ownerEmail}

Pipeline stages (in order):
- new_lead: inquiry received, no reply yet
- qualifying: initial contact made, gathering info (photos, measurements)
- quoting: actively building an estimate
- quoted: estimate with pricing has been sent
- follow_up: waiting for client response after quote
- negotiation: client responded to quote, discussing terms

CRITICAL: stage MUST be one of the above values. NEVER use "likely_won" or "likely_lost" as a stage value — those go ONLY in the flag field.

For each thread, return:
- stage: most accurate pipeline stage based on content (MUST be one of the 6 stages above)
- c: confidence 0.0 to 1.0
- val: dollar value if pricing detected
- flag: "likely_won" or "likely_lost" if terminal language detected, null otherwise
- summary: 1-2 sentence summary of this opportunity. Include: what the client needs, any pricing discussed, and current status. This becomes the at-a-glance description in the CRM pipeline. Be specific — mention addresses, materials, dollar amounts if known.

Terminal won signals include: client says "go ahead", "let's book it", "sounds good let's proceed", "sounds great" in response to an estimate/schedule, accepted/signed estimate mentioned, scheduling/start date confirmed, crew arrival discussed, deposit/payment discussed, or work instructions given. Silence after a quote is never a won signal.

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
      const response = await getSyncOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        // Stage (~15 tokens) + summary (~50 tokens) + metadata (~10 tokens) per thread
        max_tokens: threads.length * 80,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || '{"results":[]}';
      const parsed = JSON.parse(content);
      const rawResults = parsed.results || parsed;
      if (!Array.isArray(rawResults)) {
        throw new Error("model response did not contain a results array");
      }
      const threadById = new Map(
        threads.map((thread) => [thread.threadId, thread])
      );
      const resultByThreadId = new Map<string, Record<string, unknown>>();

      for (const rawResult of rawResults) {
        if (!rawResult || typeof rawResult !== "object") {
          throw new Error("model response contained an invalid result");
        }
        const result = rawResult as Record<string, unknown>;
        const threadId =
          typeof result.tid === "string"
            ? result.tid
            : typeof result.threadId === "string"
              ? result.threadId
              : null;
        if (!threadId || !threadById.has(threadId)) {
          throw new Error("model response contained an unknown evaluation key");
        }
        if (resultByThreadId.has(threadId)) {
          throw new Error(
            `model response duplicated evaluation key ${threadId}`
          );
        }
        resultByThreadId.set(threadId, result);
      }

      return threads.map((thread) => {
        const result = resultByThreadId.get(thread.threadId);
        if (!result) {
          throw new Error(
            `model response omitted evaluation key ${thread.threadId}`
          );
        }
        if (typeof result.summary !== "string" || !result.summary.trim()) {
          throw new Error(
            `model response omitted summary for ${thread.threadId}`
          );
        }
        const rawStage =
          typeof result?.stage === "string" ? result.stage : null;
        const rawFlag =
          typeof result?.flag === "string"
            ? result.flag
            : typeof result?.terminalFlag === "string"
              ? result.terminalFlag
              : null;

        // Rescue terminal flags from stage field
        let stage = sanitizeStage(rawStage);
        let terminalFlag = sanitizeTerminalFlag(rawFlag);
        if (
          !terminalFlag &&
          (rawStage === "likely_won" || rawStage === "likely_lost")
        ) {
          terminalFlag = rawStage;
          stage = null;
        }

        const deterministicTerminal = detectTerminalStageFromMessages(
          thread.messages.map((message) => ({
            direction: message.direction,
            body: message.bodyText,
          }))
        );
        if (deterministicTerminal) {
          terminalFlag = deterministicTerminal.terminalFlag;
        }

        return {
          threadId: thread.threadId,
          newStage: stage,
          terminalFlag,
          summary: result.summary.trim(),
        };
      });
    } catch (err) {
      throw new Error(
        `[ai-sync-reviewer] stage and summary evaluation failed: ${err instanceof Error ? err.message : "unknown error"}`,
        { cause: err }
      );
    }
  },
};
