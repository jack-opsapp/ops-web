import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";

export type LeadFeedbackReason =
  | "spam"
  | "job_applicant"
  | "vendor_sales"
  | "internal"
  | "platform_notification"
  | "test_traffic"
  | "duplicate"
  | "not_a_fit"
  | "other"
  | "legacy_unspecified";

export type LeadFeedbackLearningPolarity = "negative" | "positive" | "neutral";

export interface LeadFeedbackEvidence {
  id: string;
  reasonCode: LeadFeedbackReason;
  learningPolarity: LeadFeedbackLearningPolarity;
  sourceConnectionId: string | null;
  sourceProviderThreadId: string | null;
  sourceMessageId: string | null;
  sourceThreadKey: string | null;
  senderEmail: string | null;
  senderDomain: string | null;
}

export interface LeadFeedbackCandidate {
  providerThreadId: string;
  providerMessageId: string;
  senderEmail: string;
}

export interface LeadFeedbackBaseline {
  verdict: "lead" | "not_lead";
  confidence: number;
}

export type LeadFeedbackReviewReason =
  | "feedback_boundary"
  | "duplicate_feedback"
  | "neutral_feedback"
  | "positive_feedback_conflict";

export interface LeadFeedbackPriorDecision {
  outcome: "lead" | "not_lead" | "defer";
  adjustedLeadScore: number;
  adjustment: number;
  reviewReason: LeadFeedbackReviewReason | null;
  appliedFeedbackIds: string[];
  evidence: {
    exactMessage: boolean;
    exactThread: boolean;
    senderNegativeIndependentCount: number;
    domainNegativeIndependentThreadCount: number;
    domainNegativeIndependentSenderCount: number;
    domainMature: boolean;
    hasSuppressionAuthority: boolean;
  };
}

const DOMAIN_ELIGIBLE_NEGATIVE_REASONS = new Set<LeadFeedbackReason>([
  "spam",
  "vendor_sales",
  "test_traffic",
]);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

function independentEvidenceKey(feedback: LeadFeedbackEvidence): string {
  return (
    feedback.sourceThreadKey?.trim() ||
    feedback.sourceMessageId?.trim() ||
    feedback.sourceProviderThreadId?.trim() ||
    `feedback:${feedback.id}`
  );
}

function normalizedDomain(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

/**
 * Extract one normalized mailbox address. The result is used only for exact
 * string/domain comparison; names and surrounding text never become model
 * instructions.
 */
export function normalizeLeadFeedbackEmail(value: string): {
  email: string | null;
  domain: string | null;
} {
  const angleMatch = value.match(/<\s*([^<>]+)\s*>/);
  const candidate = (angleMatch?.[1] ?? value).trim().toLowerCase();
  const match = candidate.match(
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/
  );
  if (!match) return { email: null, domain: null };
  return { email: candidate, domain: match[1] };
}

function baselineLeadProbability(baseline: LeadFeedbackBaseline): number {
  const confidence = clamp01(baseline.confidence);
  return baseline.verdict === "lead" ? confidence : 1 - confidence;
}

function preservedBaselineOutcome(
  baseline: LeadFeedbackBaseline,
  threshold: number
): "lead" | "not_lead" {
  return baseline.verdict === "lead" && baseline.confidence >= threshold
    ? "lead"
    : "not_lead";
}

/**
 * Apply bounded structured evidence after the model response.
 *
 * The function never accepts or reads feedback notes. A single sender signal
 * may defer a borderline lead, but automatic suppression requires an exact
 * source match or repeated independent sender/domain evidence.
 */
export function applyLeadFeedbackPrior(input: {
  connectionId: string;
  baseline: LeadFeedbackBaseline;
  candidate: LeadFeedbackCandidate;
  feedback: LeadFeedbackEvidence[];
  threshold: number;
  protectedDomains: string[];
}): LeadFeedbackPriorDecision {
  const threshold = clamp01(input.threshold);
  const candidateIdentity = normalizeLeadFeedbackEmail(
    input.candidate.senderEmail
  );
  const protectedDomains = new Set(
    input.protectedDomains
      .map((domain) => normalizedDomain(domain))
      .filter((domain): domain is string => Boolean(domain))
  );
  for (const publicDomain of PUBLIC_EMAIL_DOMAINS) {
    protectedDomains.add(publicDomain.toLowerCase());
  }

  const exactMessage = input.feedback.filter(
    (item) =>
      item.sourceConnectionId === input.connectionId &&
      Boolean(item.sourceMessageId) &&
      item.sourceMessageId === input.candidate.providerMessageId
  );
  const exactThread = input.feedback.filter(
    (item) =>
      item.sourceConnectionId === input.connectionId &&
      Boolean(item.sourceProviderThreadId) &&
      item.sourceProviderThreadId === input.candidate.providerThreadId
  );
  const exact = new Map(
    [...exactMessage, ...exactThread].map((item) => [item.id, item])
  );

  const exactDuplicate = [...exact.values()].find(
    (item) => item.reasonCode === "duplicate"
  );
  if (exactDuplicate) {
    return {
      outcome: "defer",
      adjustedLeadScore: round6(baselineLeadProbability(input.baseline)),
      adjustment: 0,
      reviewReason: "duplicate_feedback",
      appliedFeedbackIds: [exactDuplicate.id],
      evidence: {
        exactMessage: exactMessage.length > 0,
        exactThread: exactThread.length > 0,
        senderNegativeIndependentCount: 0,
        domainNegativeIndependentThreadCount: 0,
        domainNegativeIndependentSenderCount: 0,
        domainMature: false,
        hasSuppressionAuthority: false,
      },
    };
  }

  const exactNeutral = [...exact.values()].find(
    (item) => item.learningPolarity === "neutral"
  );
  if (exactNeutral) {
    return {
      outcome: "defer",
      adjustedLeadScore: round6(baselineLeadProbability(input.baseline)),
      adjustment: 0,
      reviewReason: "neutral_feedback",
      appliedFeedbackIds: [exactNeutral.id],
      evidence: {
        exactMessage: exactMessage.length > 0,
        exactThread: exactThread.length > 0,
        senderNegativeIndependentCount: 0,
        domainNegativeIndependentThreadCount: 0,
        domainNegativeIndependentSenderCount: 0,
        domainMature: false,
        hasSuppressionAuthority: false,
      },
    };
  }

  const negative = input.feedback.filter(
    (item) => item.learningPolarity === "negative"
  );
  const positive = input.feedback.filter(
    (item) => item.learningPolarity === "positive"
  );
  const senderNegative = negative.filter(
    (item) =>
      candidateIdentity.email !== null &&
      normalizeLeadFeedbackEmail(item.senderEmail ?? "").email ===
        candidateIdentity.email
  );
  const senderNegativeKeys = new Set(
    senderNegative.map(independentEvidenceKey)
  );

  const domainNegative = negative.filter((item) => {
    const domain =
      normalizedDomain(item.senderDomain) ??
      normalizeLeadFeedbackEmail(item.senderEmail ?? "").domain;
    return (
      candidateIdentity.domain !== null &&
      domain === candidateIdentity.domain &&
      DOMAIN_ELIGIBLE_NEGATIVE_REASONS.has(item.reasonCode) &&
      !protectedDomains.has(domain)
    );
  });
  const domainThreadKeys = new Set(domainNegative.map(independentEvidenceKey));
  const domainSenders = new Set(
    domainNegative
      .map((item) => normalizeLeadFeedbackEmail(item.senderEmail ?? "").email)
      .filter((email): email is string => Boolean(email))
  );
  const domainMature = domainThreadKeys.size >= 3 && domainSenders.size >= 2;

  const exactNegativeMessage = exactMessage.some(
    (item) => item.learningPolarity === "negative"
  );
  const exactNegativeThread = exactThread.some(
    (item) => item.learningPolarity === "negative"
  );
  const exactPositiveMessage = exactMessage.some(
    (item) => item.learningPolarity === "positive"
  );
  const exactPositiveThread = exactThread.some(
    (item) => item.learningPolarity === "positive"
  );
  const senderPositive = positive.filter(
    (item) =>
      candidateIdentity.email !== null &&
      normalizeLeadFeedbackEmail(item.senderEmail ?? "").email ===
        candidateIdentity.email
  );

  let adjustment = 0;
  if (exactNegativeMessage) adjustment -= 0.42;
  else if (exactNegativeThread) adjustment -= 0.32;

  if (senderNegativeKeys.size >= 2) adjustment -= 0.24;
  else if (senderNegativeKeys.size === 1) adjustment -= 0.16;
  if (domainMature) adjustment -= 0.12;

  if (exactPositiveMessage || exactPositiveThread) adjustment += 0.25;
  else if (senderPositive.length > 0) adjustment += 0.12;

  adjustment = round6(Math.max(-0.45, Math.min(0.3, adjustment)));
  const adjustedLeadScore = round6(
    clamp01(baselineLeadProbability(input.baseline) + adjustment)
  );
  const hasSuppressionAuthority =
    exactNegativeMessage ||
    exactNegativeThread ||
    senderNegativeKeys.size >= 2 ||
    domainMature;
  const appliedFeedbackIds = [
    ...new Set(
      [
        ...exactMessage,
        ...exactThread,
        ...senderNegative,
        ...(domainMature ? domainNegative : []),
        ...senderPositive,
      ].map((item) => item.id)
    ),
  ].sort();

  const evidence = {
    exactMessage: exactMessage.length > 0,
    exactThread: exactThread.length > 0,
    senderNegativeIndependentCount: senderNegativeKeys.size,
    domainNegativeIndependentThreadCount: domainThreadKeys.size,
    domainNegativeIndependentSenderCount: domainSenders.size,
    domainMature,
    hasSuppressionAuthority,
  };

  if (appliedFeedbackIds.length === 0 || adjustment === 0) {
    return {
      outcome: preservedBaselineOutcome(input.baseline, threshold),
      adjustedLeadScore,
      adjustment,
      reviewReason: null,
      appliedFeedbackIds: [],
      evidence,
    };
  }

  if (adjustment > 0) {
    if (input.baseline.verdict === "lead" || adjustedLeadScore >= threshold) {
      return {
        outcome: "lead",
        adjustedLeadScore,
        adjustment,
        reviewReason: null,
        appliedFeedbackIds,
        evidence,
      };
    }
    return {
      outcome: "defer",
      adjustedLeadScore,
      adjustment,
      reviewReason: "positive_feedback_conflict",
      appliedFeedbackIds,
      evidence,
    };
  }

  if (input.baseline.verdict === "not_lead") {
    return {
      outcome: "not_lead",
      adjustedLeadScore,
      adjustment,
      reviewReason: null,
      appliedFeedbackIds,
      evidence,
    };
  }
  if (adjustedLeadScore >= threshold) {
    return {
      outcome: "lead",
      adjustedLeadScore,
      adjustment,
      reviewReason: null,
      appliedFeedbackIds,
      evidence,
    };
  }
  if (
    hasSuppressionAuthority &&
    adjustedLeadScore <= Math.max(0, threshold - 0.2)
  ) {
    return {
      outcome: "not_lead",
      adjustedLeadScore,
      adjustment,
      reviewReason: null,
      appliedFeedbackIds,
      evidence,
    };
  }
  return {
    outcome: "defer",
    adjustedLeadScore,
    adjustment,
    reviewReason: "feedback_boundary",
    appliedFeedbackIds,
    evidence,
  };
}

type FeedbackRow = {
  id: string;
  reason_code: LeadFeedbackReason;
  learning_polarity: LeadFeedbackLearningPolarity;
  source_connection_id: string | null;
  source_provider_thread_id: string | null;
  source_message_id: string | null;
  source_thread_key: string | null;
  sender_email: string | null;
  sender_domain: string | null;
};

export async function loadActiveLeadFeedback(
  companyId: string,
  client: SupabaseClient = getServiceRoleClient()
): Promise<LeadFeedbackEvidence[]> {
  const { data, error } = await client
    .from("lead_disposition_feedback")
    .select(
      "id, reason_code, learning_polarity, source_connection_id, source_provider_thread_id, source_message_id, source_thread_key, sender_email, sender_domain"
    )
    .eq("company_id", companyId)
    .eq("learning_state", "active")
    .eq("phase_c_enabled", true)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    throw new Error(
      `[lead-feedback-prior] feedback read failed: ${error.message}`
    );
  }

  return ((data ?? []) as FeedbackRow[]).map((row) => ({
    id: row.id,
    reasonCode: row.reason_code,
    learningPolarity: row.learning_polarity,
    sourceConnectionId: row.source_connection_id,
    sourceProviderThreadId: row.source_provider_thread_id,
    sourceMessageId: row.source_message_id,
    sourceThreadKey: row.source_thread_key,
    senderEmail: row.sender_email,
    senderDomain: row.sender_domain,
  }));
}

export async function evaluateLeadFeedbackPriorBatch(input: {
  companyId: string;
  connectionId: string;
  candidates: Array<{
    baseline: LeadFeedbackBaseline;
    candidate: LeadFeedbackCandidate;
  }>;
  threshold: number;
  protectedDomains: string[];
  client?: SupabaseClient;
}): Promise<LeadFeedbackPriorDecision[]> {
  const feedback = await loadActiveLeadFeedback(input.companyId, input.client);
  return input.candidates.map(({ baseline, candidate }) =>
    applyLeadFeedbackPrior({
      connectionId: input.connectionId,
      baseline,
      candidate,
      feedback,
      threshold: input.threshold,
      protectedDomains: input.protectedDomains,
    })
  );
}

export async function queueLeadClassificationReview(input: {
  companyId: string;
  connectionId: string;
  candidate: LeadFeedbackCandidate;
  baseline: LeadFeedbackBaseline;
  decision: LeadFeedbackPriorDecision;
  client?: SupabaseClient;
}): Promise<void> {
  if (
    input.decision.outcome !== "defer" ||
    input.decision.reviewReason === null
  ) {
    throw new Error(
      "[lead-feedback-prior] only deferred decisions can enter review"
    );
  }
  const client = input.client ?? getServiceRoleClient();
  const identity = normalizeLeadFeedbackEmail(input.candidate.senderEmail);
  const now = new Date().toISOString();
  const { error } = await client.from("lead_classification_reviews").upsert(
    {
      company_id: input.companyId,
      connection_id: input.connectionId,
      provider_thread_id: input.candidate.providerThreadId,
      provider_message_id: input.candidate.providerMessageId,
      sender_email: identity.email,
      sender_domain: identity.domain,
      baseline_verdict: input.baseline.verdict,
      baseline_confidence: clamp01(input.baseline.confidence),
      adjusted_lead_score: input.decision.adjustedLeadScore,
      review_reason: input.decision.reviewReason,
      evidence: {
        policy_version: "phase_c_lead_feedback_v1",
        adjustment: input.decision.adjustment,
        feedback_ids: input.decision.appliedFeedbackIds,
        ...input.decision.evidence,
      },
      status: "pending",
      resolved_at: null,
      updated_at: now,
    },
    { onConflict: "company_id,connection_id,provider_message_id" }
  );
  if (error) {
    throw new Error(
      `[lead-feedback-prior] review persistence failed: ${error.message}`
    );
  }
}

/**
 * Persist the authoritative review record first, then project the hold onto an
 * ordinary inbox thread. If the projection fails, the caller throws and a safe
 * retry replays the queue upsert before trying the projection again.
 */
export async function persistDeferredLeadClassification(input: {
  companyId: string;
  connectionId: string;
  candidate: LeadFeedbackCandidate;
  baseline: LeadFeedbackBaseline;
  decision: LeadFeedbackPriorDecision;
  mayProjectThread: boolean;
  client?: SupabaseClient;
}): Promise<boolean> {
  const client = input.client ?? getServiceRoleClient();
  await queueLeadClassificationReview({ ...input, client });
  if (!input.mayProjectThread) return false;

  const reason =
    input.decision.reviewReason === "duplicate_feedback"
      ? "A prior correction flagged this conversation as a duplicate."
      : input.decision.reviewReason === "positive_feedback_conflict"
        ? "A prior correction says this may be a real inquiry."
        : input.decision.reviewReason === "neutral_feedback"
          ? "A prior correction requires a human decision."
          : "Past lead corrections put this message on hold.";
  const { error } = await client
    .from("email_threads")
    .update({
      routing: "require_human_review",
      routing_reasons: [reason],
      router_confidence: input.decision.adjustedLeadScore,
      router_computed_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("connection_id", input.connectionId)
    .eq("provider_thread_id", input.candidate.providerThreadId)
    .is("opportunity_id", null);
  if (error) {
    throw new Error(
      `[lead-feedback-prior] inbox review projection failed: ${error.message}`
    );
  }
  return true;
}
