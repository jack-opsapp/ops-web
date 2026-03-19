// src/lib/api/services/ai-sync-reviewer.ts
// Feature-gated AI review that runs on each sync cycle.
// Only called when ai_email_review is enabled for the company.

import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { EmailAIClassifier } from "./email-ai-classifier";
import { EmailService } from "./email-service";
import type { NormalizedEmail } from "./email-provider";
import type {
  EmailConnection,
  SyncProfile,
} from "@/lib/types/email-connection";

export interface AIClassifiedLead {
  email: NormalizedEmail;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  description: string;
  stage: string;
  estimatedValue: number | null;
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
   * Only called if ai_email_review is enabled.
   */
  async reviewUnmatchedEmails(
    unmatchedEmails: NormalizedEmail[],
    connection: EmailConnection,
    companyContext: { name: string; industry: string; domains: string[] }
  ): Promise<AIReviewResult> {
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      connection.companyId,
      "ai_email_review"
    );
    if (!enabled) return emptyReviewResult();

    const threshold =
      (connection.syncFilters as SyncProfile).aiClassificationThreshold || 0.7;

    const classifications = await EmailAIClassifier.classifyBatch(
      unmatchedEmails.map((e) => ({
        id: e.id,
        threadId: e.threadId,
        from: e.from,
        to: e.to,
        subject: e.subject,
        snippet: e.snippet,
        date: e.date.toISOString(),
        direction: e.to.some((t) => t.includes(connection.email))
          ? ("outbound" as const)
          : ("inbound" as const),
      })),
      {
        companyName: companyContext.name,
        industry: companyContext.industry,
        ownerEmail: connection.email,
        companyDomains: companyContext.domains,
      }
    );

    const leads = classifications.filter(
      (c) => c.verdict === "lead" && c.confidence >= threshold
    );

    // Build classified leads with their source emails for persistence
    const classifiedLeads: AIClassifiedLead[] = leads
      .map((c) => {
        const sourceEmail = unmatchedEmails.find((e) => e.id === c.id);
        if (!sourceEmail || !c.client) return null;
        return {
          email: sourceEmail,
          clientName: c.client.name,
          clientEmail: c.client.email,
          clientPhone: c.client.phone,
          description: c.client.description,
          stage: c.stage || "new_lead",
          estimatedValue: c.estimatedValue,
        };
      })
      .filter((l): l is AIClassifiedLead => l !== null);

    return {
      newLeadsClassified: leads.length,
      classifiedLeads,
      stageChanges: 0,
      terminalFlags: [],
      duplicatesDetected: classifications.filter(
        (c) => c.duplicateOf.length > 0
      ).length,
    };
  },

  /**
   * Re-evaluate stages for active leads that received new emails.
   * Only called if ai_email_review is enabled.
   */
  async evaluateStages(
    activeLeadThreadIds: string[],
    connection: EmailConnection,
    companyContext: { name: string }
  ): Promise<
    Array<{
      threadId: string;
      newStage: string;
      terminalFlag: string | null;
    }>
  > {
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      connection.companyId,
      "ai_email_review"
    );
    if (!enabled) return [];

    const provider = EmailService.getProvider(connection);

    // Fetch full threads for analysis — cap at 20 per sync
    const threadInputs = [];
    for (const threadId of activeLeadThreadIds.slice(0, 20)) {
      try {
        const messages = await provider.fetchThread(threadId);
        threadInputs.push({
          threadId,
          messages: messages.map((m) => ({
            from: m.from,
            to: m.to,
            subject: m.subject,
            bodyText: m.bodyText,
            date: m.date.toISOString(),
            direction: (
              m.from.includes(connection.email) ? "outbound" : "inbound"
            ) as "inbound" | "outbound",
          })),
        });
      } catch (err) {
        console.error(
          `[ai-sync-reviewer] Failed to fetch thread ${threadId}:`,
          err
        );
      }
    }

    if (threadInputs.length === 0) return [];

    const analyses = await EmailAIClassifier.analyzeThreads(threadInputs, {
      companyName: companyContext.name,
      ownerEmail: connection.email,
    });

    return analyses.map((a) => ({
      threadId: a.threadId,
      newStage: a.stage,
      terminalFlag: a.terminalFlag,
    }));
  },
};
