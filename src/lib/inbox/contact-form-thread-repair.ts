import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import {
  sanitizeContactFormPhoneValue,
  type ContactFormSubmissionIdentity,
} from "@/lib/utils/email-parsing";

export interface ContactFormRepairThreadRow {
  id: string;
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  subject: string | null;
  latest_sender_email: string | null;
  latest_sender_name: string | null;
  participants: string[] | null;
  client_id: string | null;
  opportunity_id: string | null;
}

export interface ContactFormRepairClientRow {
  id: string;
  company_id: string;
  name: string | null;
  email: string | null;
}

export interface ContactFormRepairSubClientRow {
  id: string;
  company_id: string;
  client_id: string;
  name: string | null;
  email: string | null;
}

export interface ContactFormRepairOpportunityRow {
  id: string;
  company_id: string;
  client_id: string | null;
  title: string | null;
  stage: string | null;
}

export type SubmitterMatch =
  | {
      action: "link_existing_client";
      confidence: "exact_client";
      clientId: string;
      clientName: string | null;
      reason: string;
    }
  | {
      action: "link_existing_client";
      confidence: "exact_sub_client";
      clientId: string;
      subClientId: string;
      clientName: string | null;
      reason: string;
    }
  | {
      action: "create_sub_client";
      confidence: "domain";
      clientId: string;
      clientName: string | null;
      reason: string;
    }
  | {
      action: "manual_review";
      confidence: "domain" | "name" | "unmatched";
      suggestedClientId: string | null;
      reason: string;
    }
  | {
      action: "create_new_client";
      confidence: "unmatched";
      clientId: null;
      reason: string;
    };

export type ContactFormRepairDecisionStatus =
  | "safe"
  | "manual_review"
  | "no_change";

export interface ContactFormRepairDecision {
  status: ContactFormRepairDecisionStatus;
  reason: string;
  threadId: string;
  providerThreadId: string;
  dataQualityWarnings: string[];
  current: {
    latestSenderEmail: string | null;
    latestSenderName: string | null;
    clientId: string | null;
    clientName: string | null;
    clientEmail: string | null;
    opportunityId: string | null;
    opportunityClientId: string | null;
    participants: string[];
  };
  parsed: ContactFormSubmissionIdentity;
  match: SubmitterMatch;
  proposed: {
    latestSenderEmail: string;
    latestSenderName: string;
    participants: string[];
    clientAction:
      | "keep"
      | "link_existing_client"
      | "create_client"
      | "create_sub_client"
      | "manual_review";
    targetClientId: string | null;
    opportunityAction:
      | "keep"
      | "create_or_reuse_open"
      | "relink"
      | "manual_review";
    targetOpportunityId: string | null;
  };
}

export interface SubmitterMatchInput {
  submitter: ContactFormSubmissionIdentity;
  clients: ContactFormRepairClientRow[];
  subClients: ContactFormRepairSubClientRow[];
}

export interface BuildContactFormRepairDecisionInput {
  thread: ContactFormRepairThreadRow;
  submitter: ContactFormSubmissionIdentity;
  currentClient: ContactFormRepairClientRow | null;
  currentOpportunity: ContactFormRepairOpportunityRow | null;
  match: SubmitterMatch;
  internalEmails: Set<string>;
  internalDomains?: Set<string>;
  existingOpenOpportunityForTarget: ContactFormRepairOpportunityRow | null;
}

const SYSTEM_MAILBOX_RE =
  /^(?:noreply|no-reply|donotreply|mailer-daemon|postmaster)@/i;
const SYSTEM_DOMAIN_RE =
  /(?:wix-forms\.com|wixforms\.com|jotform\.com|typeform\.com|formstack\.com|wpforms\.com|squarespace\.com)$/i;

export function normalizeRepairEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isSystemOrPlatformEmail(email: string): boolean {
  const normalized = normalizeRepairEmail(email);
  return (
    SYSTEM_MAILBOX_RE.test(normalized) ||
    normalized.includes("notifications@") ||
    SYSTEM_DOMAIN_RE.test(normalized)
  );
}

export function isInternalOrSystemEmail(
  email: string | null | undefined,
  internalEmails: Set<string>,
  internalDomains: Set<string> = new Set()
): boolean {
  const normalized = normalizeRepairEmail(email);
  if (!normalized) return false;
  const domain = normalized.split("@")[1] ?? "";
  return (
    internalEmails.has(normalized) ||
    (!!domain &&
      !PUBLIC_EMAIL_DOMAINS.has(domain) &&
      internalDomains.has(domain)) ||
    isSystemOrPlatformEmail(normalized)
  );
}

export function nextParticipants(
  currentParticipants: string[] | null | undefined,
  submitterEmail: string
): string[] {
  const participants = new Set(
    (currentParticipants ?? [])
      .map((participant) => normalizeRepairEmail(participant))
      .filter(Boolean)
  );
  const normalizedSubmitter = normalizeRepairEmail(submitterEmail);
  if (normalizedSubmitter) participants.add(normalizedSubmitter);
  return Array.from(participants);
}

export function resolveSubmitterMatch(
  input: SubmitterMatchInput
): SubmitterMatch {
  const submitterEmail = normalizeRepairEmail(input.submitter.email);
  const exactClient = input.clients.find(
    (client) => normalizeRepairEmail(client.email) === submitterEmail
  );
  if (exactClient) {
    return {
      action: "link_existing_client",
      confidence: "exact_client",
      clientId: exactClient.id,
      clientName: exactClient.name,
      reason: "Exact email match on client",
    };
  }

  const exactSubClient = input.subClients.find(
    (subClient) => normalizeRepairEmail(subClient.email) === submitterEmail
  );
  if (exactSubClient) {
    const parentClient = input.clients.find(
      (client) => client.id === exactSubClient.client_id
    );
    return {
      action: "link_existing_client",
      confidence: "exact_sub_client",
      clientId: exactSubClient.client_id,
      subClientId: exactSubClient.id,
      clientName: parentClient?.name ?? null,
      reason: "Exact email match on sub-client",
    };
  }

  const domain = submitterEmail.split("@")[1] ?? "";
  if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
    const domainClientIds = new Set<string>();
    for (const client of input.clients) {
      if (normalizeRepairEmail(client.email).endsWith(`@${domain}`)) {
        domainClientIds.add(client.id);
      }
    }
    for (const subClient of input.subClients) {
      if (normalizeRepairEmail(subClient.email).endsWith(`@${domain}`)) {
        domainClientIds.add(subClient.client_id);
      }
    }

    if (domainClientIds.size === 1) {
      const clientId = Array.from(domainClientIds)[0];
      const client = input.clients.find((row) => row.id === clientId);
      return {
        action: "create_sub_client",
        confidence: "domain",
        clientId,
        clientName: client?.name ?? null,
        reason: `Domain match: same domain as existing client (@${domain})`,
      };
    }
    if (domainClientIds.size > 1) {
      return {
        action: "manual_review",
        confidence: "domain",
        suggestedClientId: Array.from(domainClientIds)[0] ?? null,
        reason: `Multiple clients share domain @${domain}`,
      };
    }
  }

  const lastName = (input.submitter.name ?? "")
    .trim()
    .split(/\s+/)
    .pop()
    ?.toLowerCase();
  if (lastName && lastName.length >= 3) {
    const nameMatch = input.clients.find((client) =>
      (client.name ?? "").toLowerCase().includes(lastName)
    );
    if (nameMatch) {
      return {
        action: "manual_review",
        confidence: "name",
        suggestedClientId: nameMatch.id,
        reason: `Name match needs review: ${input.submitter.name}`,
      };
    }
  }

  return {
    action: "create_new_client",
    confidence: "unmatched",
    clientId: null,
    reason: "No existing client match",
  };
}

export function buildContactFormRepairDecision(
  input: BuildContactFormRepairDecisionInput
): ContactFormRepairDecision {
  const submitterEmail = normalizeRepairEmail(input.submitter.email);
  const phoneSanitization = sanitizeContactFormPhoneValue(
    input.submitter.phone
  );
  const dataQualityWarnings = phoneSanitization.warning
    ? [phoneSanitization.warning]
    : [];
  const currentSenderEmail = normalizeRepairEmail(
    input.thread.latest_sender_email
  );
  const currentClientEmail = normalizeRepairEmail(input.currentClient?.email);
  const participants = (input.thread.participants ?? [])
    .map((participant) => normalizeRepairEmail(participant))
    .filter(Boolean);
  const proposedParticipants = nextParticipants(
    input.thread.participants,
    submitterEmail
  );
  const latestSenderName =
    (input.submitter.name ?? "").trim() || submitterEmail;

  const targetClientId =
    input.match.action === "link_existing_client" ||
    input.match.action === "create_sub_client"
      ? input.match.clientId
      : null;

  const currentClientIsSameSubmitter =
    !!input.currentClient && currentClientEmail === submitterEmail;
  const currentClientIsBugLink =
    !!input.currentClient &&
    isInternalOrSystemEmail(
      input.currentClient.email,
      input.internalEmails,
      input.internalDomains
    );
  const parsedIsUnsafe = isInternalOrSystemEmail(
    submitterEmail,
    input.internalEmails,
    input.internalDomains
  );
  const hasConflictingClient =
    !!input.currentClient &&
    !currentClientIsSameSubmitter &&
    !currentClientIsBugLink;
  const currentOpportunityMatchesTarget =
    !!targetClientId && input.currentOpportunity?.client_id === targetClientId;
  const currentOpportunityIsBugLink =
    !!input.currentOpportunity?.client_id &&
    input.currentOpportunity.client_id === input.currentClient?.id &&
    currentClientIsBugLink;

  let status: ContactFormRepairDecisionStatus = "safe";
  let reason = "Safe contact-form identity repair";
  let clientAction: ContactFormRepairDecision["proposed"]["clientAction"] =
    "keep";
  let opportunityAction: ContactFormRepairDecision["proposed"]["opportunityAction"] =
    "keep";
  let proposedTargetClientId = targetClientId;
  const proposedTargetOpportunityId =
    currentOpportunityMatchesTarget && input.currentOpportunity
      ? input.currentOpportunity.id
      : (input.existingOpenOpportunityForTarget?.id ?? null);

  if (parsedIsUnsafe) {
    status = "manual_review";
    reason = "Parsed submitter is an internal or platform mailbox";
    clientAction = "manual_review";
    opportunityAction = "manual_review";
  } else if (input.match.action === "manual_review") {
    status = "manual_review";
    reason = input.match.reason;
    clientAction = "manual_review";
    opportunityAction = "manual_review";
  } else if (hasConflictingClient) {
    status = "manual_review";
    reason =
      "Existing non-internal client link conflicts with parsed submitter";
    clientAction = "manual_review";
    opportunityAction = "manual_review";
  } else if (
    input.currentOpportunity?.client_id &&
    !currentOpportunityMatchesTarget &&
    !currentOpportunityIsBugLink
  ) {
    status = "manual_review";
    reason =
      "Existing opportunity link belongs to a different non-internal client";
    clientAction = "manual_review";
    opportunityAction = "manual_review";
  } else if (
    currentSenderEmail === submitterEmail &&
    currentClientIsSameSubmitter &&
    participants.includes(submitterEmail)
  ) {
    status = "no_change";
    reason = "Thread already points at parsed submitter";
    clientAction = "keep";
    opportunityAction = currentOpportunityMatchesTarget
      ? "keep"
      : "create_or_reuse_open";
  } else {
    if (input.match.action === "create_new_client") {
      clientAction = currentClientIsSameSubmitter ? "keep" : "create_client";
      proposedTargetClientId = currentClientIsSameSubmitter
        ? (input.currentClient?.id ?? null)
        : null;
    } else if (input.match.action === "create_sub_client") {
      clientAction = "create_sub_client";
    } else {
      clientAction = currentClientIsSameSubmitter
        ? "keep"
        : "link_existing_client";
    }

    opportunityAction = currentOpportunityMatchesTarget
      ? "keep"
      : input.currentOpportunity
        ? "relink"
        : "create_or_reuse_open";
  }

  return {
    status,
    reason,
    threadId: input.thread.id,
    providerThreadId: input.thread.provider_thread_id,
    dataQualityWarnings,
    current: {
      latestSenderEmail: input.thread.latest_sender_email,
      latestSenderName: input.thread.latest_sender_name,
      clientId: input.thread.client_id,
      clientName: input.currentClient?.name ?? null,
      clientEmail: input.currentClient?.email ?? null,
      opportunityId: input.thread.opportunity_id,
      opportunityClientId: input.currentOpportunity?.client_id ?? null,
      participants,
    },
    parsed: {
      ...input.submitter,
      email: submitterEmail,
      phone: phoneSanitization.phone,
    },
    match: input.match,
    proposed: {
      latestSenderEmail: submitterEmail,
      latestSenderName,
      participants: proposedParticipants,
      clientAction,
      targetClientId: proposedTargetClientId,
      opportunityAction,
      targetOpportunityId: proposedTargetOpportunityId,
    },
  };
}
