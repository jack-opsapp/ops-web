import { escapeIlikeLiteral } from "@/lib/supabase/ilike-literal";
import { resolveGuardedOpportunityClientId } from "@/lib/email/opportunity-client-identity";
import { normalizeAddress as normalizeCanonicalAddress } from "@/lib/utils/name-normalization";

export type OpportunityRelationshipConfidence =
  | "provider_thread"
  | "exact_contact_email"
  | "exact_participant_email"
  | "forwarded_participant_with_address"
  | "existing_sub_client"
  | "exact_phone"
  | "shared_active_address"
  | "active_project_address"
  | "quoted_prior_thread";

export interface OpportunityRelationshipProject {
  id: string;
  clientId?: string | null;
  /** Null only for an existing project that is safe to adopt on conversion. */
  opportunityId?: string | null;
  status: string | null;
  title: string | null;
  description: string | null;
  address: string | null;
  completedAt: string | null;
  deletedAt: string | null;
}

export interface OpportunityRelationshipCandidate {
  id: string;
  clientId: string | null;
  stage: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  title: string | null;
  description: string | null;
  sourceEmailId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  clientEmails: string[];
  subClientEmails: string[];
  clientPhones: string[];
  subClientPhones: string[];
  clientAddresses: string[];
  subClientAddresses: string[];
  project: OpportunityRelationshipProject | null;
}

export interface OpportunityRelationshipFacts {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  description: string | null;
  subject: string | null;
  providerThreadId: string | null;
  /** Provider From/To/CC identities after operator/company addresses are removed. */
  participantEmails?: string[];
  /** Strict forwarded-header identities; never authoritative without corroboration. */
  forwardedParticipantEmails?: string[];
  sourcePlatform: string | null;
  phaseCEnabled?: boolean;
}

export type OpportunityRelationshipDecision =
  | {
      action: "link";
      opportunityId: string;
      clientId: string | null;
      confidence: OpportunityRelationshipConfidence;
      reason: string;
      evidence: string[];
      /** A unique active project with no opportunity link that conversion may adopt. */
      existingProjectId?: string;
    }
  | {
      action: "create_new";
      reason: string;
      suggestedOpportunityId: string | null;
      evidence: string[];
    };

interface DecideInput {
  facts: OpportunityRelationshipFacts;
  candidates: OpportunityRelationshipCandidate[];
  providerLinkedOpportunityId?: string | null;
}

interface SupabaseLike {
  from: (table: string) => unknown;
}

interface QueryResult {
  data?: unknown;
  error?: { message?: string } | null;
}

interface QueryChain extends PromiseLike<QueryResult> {
  eq: (column: string, value: unknown) => QueryChain;
  ilike: (column: string, value: unknown) => QueryChain;
  is: (column: string, value: unknown) => QueryChain;
  in: (column: string, value: unknown[]) => QueryChain;
  or: (filters: string) => QueryChain;
  order: (column: string, options?: Record<string, unknown>) => QueryChain;
  limit: (count: number) => QueryChain;
  range: (from: number, to: number) => QueryChain;
  maybeSingle: () => Promise<QueryResult>;
}

interface TableBuilder {
  select: (columns: string) => QueryChain;
}

export interface FindOpportunityRelationshipMatchInput {
  supabase: SupabaseLike;
  companyId: string;
  connectionId: string | null;
  providerThreadId: string | null;
  clientId?: string | null;
  facts: OpportunityRelationshipFacts;
}

const ACTIVE_OPPORTUNITY_STAGES = new Set([
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
]);

const TERMINAL_OPPORTUNITY_STAGES = new Set([
  "won",
  "lost",
  "discarded",
  "archived",
  "merged",
  "converted",
  "disqualified",
]);

const ACTIVE_PROJECT_STATUSES = new Set([
  "rfq",
  "estimated",
  "accepted",
  "in_progress",
]);

const CLOSED_PROJECT_STATUSES = new Set(["completed", "closed", "archived"]);

const RELATIONSHIP_PAGE_SIZE = 100;

const ADDRESS_DISCOVERY_NOISE_TOKENS = new Set([
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "avenue",
  "street",
  "road",
  "boulevard",
  "drive",
  "crescent",
  "highway",
  "place",
  "court",
  "lane",
  "terrace",
  "parkway",
  "square",
  "unit",
]);

const STREET_IDENTITY_TOKENS = new Set([
  "avenue",
  "boulevard",
  "court",
  "crescent",
  "drive",
  "highway",
  "lane",
  "parkway",
  "place",
  "road",
  "square",
  "street",
  "terrace",
]);

const ADDRESS_UNIT_IDENTITY_PATTERN =
  /(?:^|[,\s]+)(?:apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*([a-z0-9]+(?:[-/][a-z0-9]+)*)/i;

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D+/g, "") ?? "";
  if (digits.length < 7) return null;
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

function normalizeAddress(value: string | null | undefined): string | null {
  const unitIdentifier =
    value?.match(ADDRESS_UNIT_IDENTITY_PATTERN)?.[1]?.toLowerCase() ?? null;
  const canonical = normalizeCanonicalAddress(value ?? "");
  if (!canonical || canonical.length < 8) return null;
  const tokens = canonical.split(" ");
  const streetTypeIndex = tokens.findIndex((token) =>
    STREET_IDENTITY_TOKENS.has(token)
  );
  // Optional municipality / province / postal text must not split the same
  // numbered street into two identities. Keep non-street/rural addresses fully
  // canonical instead of guessing where their identity ends.
  let streetIdentity = canonical;
  if (
    streetTypeIndex >= 2 &&
    /^[0-9]+[a-z]?(?:[-/][0-9a-z]+)?$/.test(tokens[0] ?? "")
  ) {
    streetIdentity = tokens.slice(0, streetTypeIndex + 1).join(" ");
  }
  return unitIdentifier
    ? `${streetIdentity} unit ${unitIdentifier}`
    : streetIdentity;
}

function addressDiscoveryPatterns(value: string | null | undefined): string[] {
  const raw = value?.trim() ?? "";
  const canonical = normalizeAddress(raw);
  if (!canonical) return [];

  // The database stores the original address text, so canonical equality
  // cannot discover spelling variants by itself. Use a conservative token
  // anchor that ignores only canonicalized street/directional words, then make
  // the final relationship decision with exact canonical equality in memory.
  const anchorTokens = canonical
    .split(" ")
    .filter((token) => token && !ADDRESS_DISCOVERY_NOISE_TOKENS.has(token));
  const anchorPattern =
    anchorTokens.length >= 2
      ? `${anchorTokens.map(escapeIlikeLiteral).join("%")}%`
      : null;

  return Array.from(
    new Set(
      [escapeIlikeLiteral(raw), anchorPattern].filter(Boolean) as string[]
    )
  );
}

function normalizeTokenText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string | null | undefined): Set<string> {
  return new Set(
    normalizeTokenText(value)
      .split(" ")
      .filter((token) => token.length >= 4)
  );
}

function hasMeaningfulScopeOverlap(
  incoming: OpportunityRelationshipFacts,
  candidate: OpportunityRelationshipCandidate
): boolean {
  const incomingTokens = tokenSet(
    [incoming.subject, incoming.description].filter(Boolean).join(" ")
  );
  if (incomingTokens.size === 0) return false;

  const existingTokens = tokenSet(
    [
      candidate.title,
      candidate.description,
      candidate.project?.title ?? null,
      candidate.project?.description ?? null,
    ]
      .filter(Boolean)
      .join(" ")
  );
  if (existingTokens.size === 0) return false;

  let overlap = 0;
  for (const token of incomingTokens) {
    if (existingTokens.has(token)) overlap++;
  }
  return overlap >= 2;
}

function isArchived(candidate: OpportunityRelationshipCandidate): boolean {
  return Boolean(candidate.archivedAt || candidate.deletedAt);
}

function normalizedStage(candidate: OpportunityRelationshipCandidate): string {
  return candidate.stage?.trim().toLowerCase() ?? "";
}

function isActiveOpportunity(
  candidate: OpportunityRelationshipCandidate
): boolean {
  if (isArchived(candidate)) return false;
  return ACTIVE_OPPORTUNITY_STAGES.has(normalizedStage(candidate));
}

function isTerminalOpportunity(
  candidate: OpportunityRelationshipCandidate
): boolean {
  if (isArchived(candidate)) return true;
  return TERMINAL_OPPORTUNITY_STAGES.has(normalizedStage(candidate));
}

function normalizedProjectStatus(
  candidate: OpportunityRelationshipCandidate
): string {
  return candidate.project?.status?.trim().toLowerCase() ?? "";
}

function hasActiveProject(
  candidate: OpportunityRelationshipCandidate
): boolean {
  if (!candidate.project || candidate.project.deletedAt) return false;
  return ACTIVE_PROJECT_STATUSES.has(normalizedProjectStatus(candidate));
}

function hasClosedProject(
  candidate: OpportunityRelationshipCandidate
): boolean {
  if (!candidate.project || candidate.project.deletedAt) return false;
  return CLOSED_PROJECT_STATUSES.has(normalizedProjectStatus(candidate));
}

function isEligibleActiveRelationship(
  candidate: OpportunityRelationshipCandidate
): boolean {
  return (
    !isArchived(candidate) &&
    (isActiveOpportunity(candidate) || hasActiveProject(candidate))
  );
}

function byNewest(
  a: OpportunityRelationshipCandidate,
  b: OpportunityRelationshipCandidate
): number {
  const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0;
  const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0;
  return bTime - aTime;
}

function linkDecision(
  candidate: OpportunityRelationshipCandidate,
  confidence: OpportunityRelationshipConfidence,
  reason: string,
  evidence: string[]
): OpportunityRelationshipDecision {
  const existingProjectId =
    candidate.project &&
    candidate.project.opportunityId === null &&
    hasActiveProject(candidate)
      ? candidate.project.id
      : undefined;
  return {
    action: "link",
    opportunityId: candidate.id,
    clientId: candidate.clientId,
    confidence,
    reason,
    evidence,
    ...(existingProjectId ? { existingProjectId } : {}),
  };
}

function normalizedCandidateEmails(
  candidate: OpportunityRelationshipCandidate
): {
  contactEmail: string | null;
  clientEmails: Set<string>;
  subClientEmails: Set<string>;
} {
  return {
    contactEmail: normalizeEmail(candidate.contactEmail),
    clientEmails: new Set(
      candidate.clientEmails.map(normalizeEmail).filter(Boolean) as string[]
    ),
    subClientEmails: new Set(
      candidate.subClientEmails.map(normalizeEmail).filter(Boolean) as string[]
    ),
  };
}

function candidatePhoneSet(
  candidate: OpportunityRelationshipCandidate
): Set<string> {
  return new Set(
    [
      candidate.contactPhone,
      ...candidate.clientPhones,
      ...candidate.subClientPhones,
    ]
      .map(normalizePhone)
      .filter(Boolean) as string[]
  );
}

function candidateAddressSet(
  candidate: OpportunityRelationshipCandidate
): Set<string> {
  return new Set(
    [
      candidate.address,
      candidate.project?.address ?? null,
      ...candidate.clientAddresses,
      ...candidate.subClientAddresses,
    ]
      .map(normalizeAddress)
      .filter(Boolean) as string[]
  );
}

function hasConflictingJobAddress(
  incomingAddress: string | null,
  candidate: OpportunityRelationshipCandidate
): boolean {
  if (!incomingAddress) return false;

  // Opportunity/project addresses identify the job itself and outrank broad
  // customer-address history. If either points elsewhere, an exact person or
  // participant identity is not permission to merge two jobs.
  const jobAddresses = [candidate.address, candidate.project?.address ?? null]
    .map(normalizeAddress)
    .filter(Boolean) as string[];
  if (jobAddresses.length > 0) {
    return jobAddresses.some((address) => address !== incomingAddress);
  }

  const relationshipAddresses = [
    ...candidate.clientAddresses,
    ...candidate.subClientAddresses,
  ]
    .map(normalizeAddress)
    .filter(Boolean) as string[];
  return (
    relationshipAddresses.length > 0 &&
    !relationshipAddresses.includes(incomingAddress)
  );
}

export function decideOpportunityRelationshipMatch({
  facts,
  candidates,
  providerLinkedOpportunityId,
}: DecideInput): OpportunityRelationshipDecision {
  if (providerLinkedOpportunityId) {
    const linkedCandidate = candidates.find(
      (candidate) => candidate.id === providerLinkedOpportunityId
    );
    if (!linkedCandidate) {
      throw new Error(
        "Provider-linked opportunity identity was not loaded in the mailbox company"
      );
    }
    return linkDecision(
      linkedCandidate,
      "provider_thread",
      "Existing provider thread link",
      ["provider_thread_link"]
    );
  }

  const sortedCandidates = [...candidates].sort(byNewest);
  const contactEmail = normalizeEmail(facts.contactEmail);
  const participantEmails = new Set(
    (facts.participantEmails ?? [])
      .map(normalizeEmail)
      .filter(Boolean) as string[]
  );
  if (contactEmail) participantEmails.delete(contactEmail);
  const contactPhone = normalizePhone(facts.contactPhone);
  const address = normalizeAddress(facts.address);

  // A fragmented thread may carry both a placeholder sender opportunity and
  // the real customer's alternate contacts in To/CC. A unique accepted or
  // in-progress project that is still unlinked is stronger relationship proof
  // than the placeholder's recency, provided one exact external participant
  // belongs to that project's active opportunity relationship.
  const committedProjectMatches = sortedCandidates.filter((candidate) => {
    const projectStatus = normalizedProjectStatus(candidate);
    if (
      isArchived(candidate) ||
      !candidate.project ||
      candidate.project.opportunityId !== null ||
      !["accepted", "in_progress"].includes(projectStatus)
    ) {
      return false;
    }
    if (hasConflictingJobAddress(address, candidate)) return false;
    const emails = normalizedCandidateEmails(candidate);
    const candidateEmails = new Set([
      ...(emails.contactEmail ? [emails.contactEmail] : []),
      ...emails.clientEmails,
      ...emails.subClientEmails,
    ]);
    return Boolean(
      (contactEmail && candidateEmails.has(contactEmail)) ||
      [...participantEmails].some((email) => candidateEmails.has(email))
    );
  });
  if (committedProjectMatches.length > 1) {
    throw new Error(
      "Multiple unlinked committed projects matched the same external participant; automatic association is blocked"
    );
  }
  if (committedProjectMatches.length === 1) {
    const candidate = committedProjectMatches[0];
    const emails = normalizedCandidateEmails(candidate);
    const contactMatched = Boolean(
      contactEmail &&
      (emails.contactEmail === contactEmail ||
        emails.clientEmails.has(contactEmail) ||
        emails.subClientEmails.has(contactEmail))
    );
    return linkDecision(
      candidate,
      contactMatched ? "exact_contact_email" : "exact_participant_email",
      "Unique unlinked committed project matched an exact external conversation participant",
      [
        `project_status:${normalizedProjectStatus(candidate)}`,
        "unique_unlinked_project",
      ]
    );
  }

  if (contactEmail) {
    const matches: Array<{
      candidate: OpportunityRelationshipCandidate;
      confidence: "exact_contact_email" | "existing_sub_client";
      evidence: string;
    }> = [];
    for (const candidate of sortedCandidates) {
      const emails = normalizedCandidateEmails(candidate);
      if (!isEligibleActiveRelationship(candidate)) continue;
      if (hasConflictingJobAddress(address, candidate)) continue;
      if (
        emails.contactEmail === contactEmail ||
        emails.clientEmails.has(contactEmail)
      ) {
        matches.push({
          candidate,
          confidence: "exact_contact_email",
          evidence: `email:${contactEmail}`,
        });
        continue;
      }
      if (emails.subClientEmails.has(contactEmail)) {
        matches.push({
          candidate,
          confidence: "existing_sub_client",
          evidence: `sub_client_email:${contactEmail}`,
        });
      }
    }
    if (matches.length > 1) {
      throw new Error(
        "Multiple active opportunities matched the exact customer email; automatic association is blocked"
      );
    }
    if (matches[0]) {
      return linkDecision(
        matches[0].candidate,
        matches[0].confidence,
        matches[0].confidence === "exact_contact_email"
          ? "Exact customer email matched a unique active opportunity"
          : "Existing sub-client email matched a unique active customer relationship",
        [matches[0].evidence]
      );
    }
  }

  const participantMatches = new Map<
    string,
    {
      candidate: OpportunityRelationshipCandidate;
      confidence: "exact_participant_email" | "existing_sub_client";
      evidence: string;
    }
  >();
  for (const participantEmail of participantEmails) {
    for (const candidate of sortedCandidates) {
      if (!isEligibleActiveRelationship(candidate)) continue;
      if (hasConflictingJobAddress(address, candidate)) continue;
      const emails = normalizedCandidateEmails(candidate);
      if (
        emails.contactEmail === participantEmail ||
        emails.clientEmails.has(participantEmail)
      ) {
        participantMatches.set(candidate.id, {
          candidate,
          confidence: "exact_participant_email",
          evidence: `participant_email:${participantEmail}`,
        });
        continue;
      }
      if (emails.subClientEmails.has(participantEmail)) {
        participantMatches.set(candidate.id, {
          candidate,
          confidence: "existing_sub_client",
          evidence: `sub_client_participant:${participantEmail}`,
        });
      }
    }
  }
  if (participantMatches.size > 1) {
    throw new Error(
      "Multiple active opportunities matched external conversation participants; automatic association is blocked"
    );
  }
  const participantMatch = [...participantMatches.values()][0];
  if (participantMatch) {
    return linkDecision(
      participantMatch.candidate,
      participantMatch.confidence,
      "Exact external participant matched a unique active customer relationship",
      [participantMatch.evidence]
    );
  }

  // Forwarded header text is untrusted evidence. It may participate only when
  // a second, exact address signal corroborates the same active relationship.
  if (address) {
    const forwardedEmails = new Set(
      (facts.forwardedParticipantEmails ?? [])
        .map(normalizeEmail)
        .filter(Boolean) as string[]
    );
    const forwardedMatches = new Map<
      string,
      {
        candidate: OpportunityRelationshipCandidate;
        email: string;
      }
    >();
    for (const forwardedEmail of forwardedEmails) {
      for (const candidate of sortedCandidates) {
        if (!isEligibleActiveRelationship(candidate)) continue;
        if (hasConflictingJobAddress(address, candidate)) continue;
        if (!candidateAddressSet(candidate).has(address)) continue;
        const emails = normalizedCandidateEmails(candidate);
        if (
          emails.contactEmail === forwardedEmail ||
          emails.clientEmails.has(forwardedEmail) ||
          emails.subClientEmails.has(forwardedEmail)
        ) {
          forwardedMatches.set(candidate.id, {
            candidate,
            email: forwardedEmail,
          });
        }
      }
    }
    if (forwardedMatches.size > 1) {
      throw new Error(
        "Multiple active opportunities matched the forwarded participant and address; automatic association is blocked"
      );
    }
    const forwardedMatch = [...forwardedMatches.values()][0];
    if (forwardedMatch) {
      return linkDecision(
        forwardedMatch.candidate,
        "forwarded_participant_with_address",
        "Strict forwarded participant and exact address matched a unique active opportunity",
        [`forwarded_participant:${forwardedMatch.email}`, `address:${address}`]
      );
    }
  }

  if (contactPhone) {
    const phoneMatches = sortedCandidates.filter(
      (candidate) =>
        isEligibleActiveRelationship(candidate) &&
        !hasConflictingJobAddress(address, candidate) &&
        candidatePhoneSet(candidate).has(contactPhone)
    );
    if (phoneMatches.length > 1) {
      throw new Error(
        "Multiple active opportunities matched the exact phone; automatic association is blocked"
      );
    }
    if (phoneMatches[0]) {
      return linkDecision(
        phoneMatches[0],
        "exact_phone",
        "Exact phone matched a unique active opportunity relationship",
        [`phone:${contactPhone}`]
      );
    }
  }

  if (address) {
    const addressMatches = sortedCandidates.filter(
      (candidate) =>
        isEligibleActiveRelationship(candidate) &&
        !hasConflictingJobAddress(address, candidate) &&
        candidateAddressSet(candidate).has(address)
    );
    if (addressMatches.length > 1) {
      throw new Error(
        "Multiple active opportunities matched the exact job address; automatic association is blocked"
      );
    }
    if (addressMatches[0]) {
      const candidate = addressMatches[0];
      return hasActiveProject(candidate)
        ? linkDecision(
            candidate,
            "active_project_address",
            "Address matched a unique active linked project",
            [
              `address:${address}`,
              `project_status:${normalizedProjectStatus(candidate)}`,
            ]
          )
        : linkDecision(
            candidate,
            "shared_active_address",
            "Address matched a unique active opportunity",
            [`address:${address}`, `stage:${normalizedStage(candidate)}`]
          );
    }

    const closedCandidate = sortedCandidates.find(
      (candidate) =>
        candidateAddressSet(candidate).has(address) &&
        (isTerminalOpportunity(candidate) || hasClosedProject(candidate))
    );
    if (closedCandidate && !hasMeaningfulScopeOverlap(facts, closedCandidate)) {
      return {
        action: "create_new",
        reason:
          "Prior same-address opportunity or project is terminal/closed and the incoming scope is distinct",
        suggestedOpportunityId: closedCandidate.id,
        evidence: [`address:${address}`, "distinct_scope"],
      };
    }
  }

  const scopeMatches = sortedCandidates.filter(
    (candidate) =>
      isEligibleActiveRelationship(candidate) &&
      !hasConflictingJobAddress(address, candidate) &&
      hasMeaningfulScopeOverlap(facts, candidate)
  );
  if (scopeMatches.length > 1) {
    throw new Error(
      "Multiple active opportunities matched the quoted prior-thread scope; automatic association is blocked"
    );
  }
  if (scopeMatches[0]) {
    return linkDecision(
      scopeMatches[0],
      "quoted_prior_thread",
      "Incoming message uniquely overlaps known prior thread scope",
      ["quoted_prior_thread_scope"]
    );
  }

  return {
    action: "create_new",
    reason:
      "No deterministic opportunity relationship signal met the P3 confidence bar",
    suggestedOpportunityId: sortedCandidates[0]?.id ?? null,
    evidence: [],
  };
}

async function rowsFrom(
  query: PromiseLike<QueryResult>
): Promise<Record<string, unknown>[]> {
  const { data, error } = await query;
  if (error) {
    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : "unknown error";
    throw new Error(`Opportunity relationship lookup failed: ${message}`, {
      cause: error,
    });
  }
  if (!data) return [];
  return Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : [data as Record<string, unknown>];
}

async function rowsFromAllPages(
  buildQuery: (from: number, to: number) => PromiseLike<QueryResult>
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += RELATIONSHIP_PAGE_SIZE) {
    const page = await rowsFrom(
      buildQuery(from, from + RELATIONSHIP_PAGE_SIZE - 1)
    );
    rows.push(...page);
    if (page.length < RELATIONSHIP_PAGE_SIZE) return rows;
  }
}

function table(supabase: SupabaseLike, name: string) {
  return supabase.from(name) as TableBuilder;
}

const OPPORTUNITY_SELECT = [
  "id",
  "client_id",
  "client_ref",
  "stage",
  "archived_at",
  "deleted_at",
  "contact_email",
  "contact_phone",
  "address",
  "title",
  "description",
  "source_email_id",
  "project_id",
  "project_ref",
  "created_at",
  "updated_at",
].join(", ");

function rowString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function uniqueRowsById(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = rowString(row, "id");
    if (id && !byId.has(id)) byId.set(id, row);
  }
  return Array.from(byId.values());
}

function rowToCandidate(
  row: Record<string, unknown>
): OpportunityRelationshipCandidate {
  return {
    id: rowString(row, "id") ?? "",
    clientId: resolveGuardedOpportunityClientId({
      clientId: rowString(row, "client_id"),
      clientRef: rowString(row, "client_ref"),
    }),
    stage: rowString(row, "stage"),
    archivedAt: rowString(row, "archived_at"),
    deletedAt: rowString(row, "deleted_at"),
    contactEmail: rowString(row, "contact_email"),
    contactPhone: rowString(row, "contact_phone"),
    address: rowString(row, "address"),
    title: rowString(row, "title"),
    description: rowString(row, "description"),
    sourceEmailId: rowString(row, "source_email_id"),
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
    clientEmails: [],
    subClientEmails: [],
    clientPhones: [],
    subClientPhones: [],
    clientAddresses: [],
    subClientAddresses: [],
    project: null,
  };
}

function projectRowToRelationshipProject(
  row: Record<string, unknown> | null | undefined
): OpportunityRelationshipProject | null {
  if (!row) return null;
  const id = rowString(row, "id");
  if (!id) return null;
  return {
    id,
    clientId: rowString(row, "client_id"),
    opportunityId:
      rowString(row, "opportunity_ref") ?? rowString(row, "opportunity_id"),
    status: rowString(row, "status"),
    title: rowString(row, "title"),
    description: rowString(row, "description"),
    address: rowString(row, "address"),
    completedAt: rowString(row, "completed_at"),
    deletedAt: rowString(row, "deleted_at"),
  };
}

async function fetchOpportunityRowsByColumn(
  supabase: SupabaseLike,
  companyId: string,
  column: "id" | "client_id" | "contact_email" | "contact_phone" | "address",
  value: string
): Promise<Record<string, unknown>[]> {
  return rowsFromAllPages((from, to) =>
    table(supabase, "opportunities")
      .select(OPPORTUNITY_SELECT)
      .eq("company_id", companyId)
      [column === "id" || column === "client_id" ? "eq" : "ilike"](
        column,
        column === "id" || column === "client_id"
          ? value
          : escapeIlikeLiteral(value)
      )
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function fetchOpportunityRowsByClientIdentity(
  supabase: SupabaseLike,
  companyId: string,
  clientId: string
): Promise<Record<string, unknown>[]> {
  return rowsFromAllPages((from, to) =>
    table(supabase, "opportunities")
      .select(OPPORTUNITY_SELECT)
      .eq("company_id", companyId)
      .or(`client_ref.eq.${clientId},client_id.eq.${clientId}`)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function fetchOpportunityRowsByAddressPattern(
  supabase: SupabaseLike,
  companyId: string,
  pattern: string
): Promise<Record<string, unknown>[]> {
  return rowsFromAllPages((from, to) =>
    table(supabase, "opportunities")
      .select(OPPORTUNITY_SELECT)
      .eq("company_id", companyId)
      .ilike("address", pattern)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function fetchClientRowsByColumn(
  supabase: SupabaseLike,
  companyId: string,
  column: "email" | "phone_number" | "address",
  value: string
): Promise<Record<string, unknown>[]> {
  return rowsFromAllPages((from, to) =>
    table(supabase, "clients")
      .select("id, email, phone_number, address")
      .eq("company_id", companyId)
      .ilike(column, escapeIlikeLiteral(value))
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function fetchSubClientRowsByColumn(
  supabase: SupabaseLike,
  companyId: string,
  column: "email" | "phone_number" | "address",
  value: string
): Promise<Record<string, unknown>[]> {
  return rowsFromAllPages((from, to) =>
    table(supabase, "sub_clients")
      .select("id, client_id, email, phone_number, address")
      .eq("company_id", companyId)
      .ilike(column, escapeIlikeLiteral(value))
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function fetchClientRowsByAddressPattern(
  supabase: SupabaseLike,
  companyId: string,
  pattern: string
): Promise<Record<string, unknown>[]> {
  return rowsFromAllPages((from, to) =>
    table(supabase, "clients")
      .select("id, email, phone_number, address")
      .eq("company_id", companyId)
      .ilike("address", pattern)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function fetchSubClientRowsByAddressPattern(
  supabase: SupabaseLike,
  companyId: string,
  pattern: string
): Promise<Record<string, unknown>[]> {
  return rowsFromAllPages((from, to) =>
    table(supabase, "sub_clients")
      .select("id, client_id, email, phone_number, address")
      .eq("company_id", companyId)
      .ilike("address", pattern)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function fetchProjectRowsByAddress(
  supabase: SupabaseLike,
  companyId: string,
  pattern: string
): Promise<Record<string, unknown>[]> {
  return rowsFromAllPages((from, to) =>
    table(supabase, "projects")
      .select(
        "id, opportunity_id, opportunity_ref, client_id, status, title, description, address, completed_at, deleted_at"
      )
      .eq("company_id", companyId)
      .ilike("address", pattern)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function fetchProjectRowsByClientId(
  supabase: SupabaseLike,
  companyId: string,
  clientId: string
): Promise<Record<string, unknown>[]> {
  return rowsFromAllPages((from, to) =>
    table(supabase, "projects")
      .select(
        "id, opportunity_id, opportunity_ref, client_id, status, title, description, address, completed_at, deleted_at"
      )
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function fetchProjectForOpportunity(
  supabase: SupabaseLike,
  companyId: string,
  candidate: OpportunityRelationshipCandidate,
  row: Record<string, unknown>
): Promise<OpportunityRelationshipProject | null> {
  const projectId =
    rowString(row, "project_id") ?? rowString(row, "project_ref");
  if (projectId) {
    const byId = await rowsFrom(
      table(supabase, "projects")
        .select(
          "id, client_id, opportunity_id, opportunity_ref, status, title, description, address, completed_at, deleted_at"
        )
        .eq("company_id", companyId)
        .eq("id", projectId)
        .limit(1)
    );
    const project = projectRowToRelationshipProject(byId[0]);
    if (project) return project;
  }

  const byOpportunity = await rowsFrom(
    table(supabase, "projects")
      .select(
        "id, client_id, opportunity_id, opportunity_ref, status, title, description, address, completed_at, deleted_at"
      )
      .eq("company_id", companyId)
      .eq("opportunity_id", candidate.id)
      .limit(1)
  );
  return projectRowToRelationshipProject(byOpportunity[0]);
}

async function hydrateCandidate(
  supabase: SupabaseLike,
  companyId: string,
  row: Record<string, unknown>
): Promise<OpportunityRelationshipCandidate | null> {
  const candidate = rowToCandidate(row);
  if (!candidate.id) return null;

  if (candidate.clientId) {
    const [clients, subClients] = await Promise.all([
      rowsFrom(
        table(supabase, "clients")
          .select("email, phone_number, address")
          .eq("company_id", companyId)
          .eq("id", candidate.clientId)
          .limit(1)
      ),
      rowsFromAllPages((from, to) =>
        table(supabase, "sub_clients")
          .select("id, email, phone_number, address")
          .eq("company_id", companyId)
          .eq("client_id", candidate.clientId)
          .is("deleted_at", null)
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);

    candidate.clientEmails = clients
      .map((client) => rowString(client, "email"))
      .filter(Boolean) as string[];
    candidate.clientPhones = clients
      .map((client) => rowString(client, "phone_number"))
      .filter(Boolean) as string[];
    candidate.clientAddresses = clients
      .map((client) => rowString(client, "address"))
      .filter(Boolean) as string[];
    candidate.subClientEmails = subClients
      .map((sub) => rowString(sub, "email"))
      .filter(Boolean) as string[];
    candidate.subClientPhones = subClients
      .map((sub) => rowString(sub, "phone_number"))
      .filter(Boolean) as string[];
    candidate.subClientAddresses = subClients
      .map((sub) => rowString(sub, "address"))
      .filter(Boolean) as string[];
  }

  candidate.project = await fetchProjectForOpportunity(
    supabase,
    companyId,
    candidate,
    row
  );
  return candidate;
}

async function attachUniqueStandaloneProject(
  supabase: SupabaseLike,
  companyId: string,
  candidate: OpportunityRelationshipCandidate,
  facts: OpportunityRelationshipFacts
): Promise<void> {
  if (candidate.project || !candidate.clientId) return;

  const incomingAddress = normalizeAddress(facts.address);
  const candidateJobAddress = normalizeAddress(candidate.address);
  if (
    incomingAddress &&
    candidateJobAddress &&
    incomingAddress !== candidateJobAddress
  ) {
    return;
  }

  const candidateAddresses = new Set(
    [candidate.address, facts.address, ...candidate.clientAddresses]
      .map(normalizeAddress)
      .filter(Boolean) as string[]
  );
  if (candidateAddresses.size === 0) return;

  const projects = (
    await fetchProjectRowsByClientId(supabase, companyId, candidate.clientId)
  )
    .map(projectRowToRelationshipProject)
    .filter(Boolean) as OpportunityRelationshipProject[];
  const matches = projects.filter((project) => {
    if (project.opportunityId != null || project.deletedAt) {
      return false;
    }
    if (
      !ACTIVE_PROJECT_STATUSES.has(project.status?.trim().toLowerCase() ?? "")
    ) {
      return false;
    }
    const projectAddress = normalizeAddress(project.address);
    return Boolean(projectAddress && candidateAddresses.has(projectAddress));
  });
  if (matches.length === 1) candidate.project = matches[0];
}

export async function findUniqueExistingProjectForEmailConversion(input: {
  supabase: SupabaseLike;
  companyId: string;
  opportunityId: string;
  clientId: string | null;
  clientRef?: string | null;
  opportunityAddress: string | null;
}): Promise<string | null> {
  const clientId = resolveGuardedOpportunityClientId({
    clientId: input.clientId,
    clientRef: input.clientRef,
  });
  if (!clientId) {
    throw new Error(
      "Existing project client proof is unavailable; automatic project creation is blocked"
    );
  }
  const opportunityAddress = normalizeAddress(input.opportunityAddress);

  const projects = (
    await fetchProjectRowsByClientId(input.supabase, input.companyId, clientId)
  )
    .map(projectRowToRelationshipProject)
    .filter(Boolean) as OpportunityRelationshipProject[];
  const activeSameClient = projects.filter((project) => {
    if (project.deletedAt) return false;
    if (project.clientId !== clientId) return false;
    if (
      !ACTIVE_PROJECT_STATUSES.has(project.status?.trim().toLowerCase() ?? "")
    ) {
      return false;
    }
    return true;
  });
  if (!opportunityAddress) {
    if (activeSameClient.length > 0) {
      throw new Error(
        "Existing project address proof is unavailable; automatic project creation is blocked"
      );
    }
    return null;
  }
  const eligible = activeSameClient.filter(
    (project) => normalizeAddress(project.address) === opportunityAddress
  );
  if (eligible.length > 1) {
    throw new Error(
      "Existing project relationship is ambiguous; automatic project creation is blocked"
    );
  }
  const match = eligible[0];
  if (!match) return null;
  if (
    match.opportunityId != null &&
    match.opportunityId !== input.opportunityId
  ) {
    throw new Error(
      "Existing project is linked to another opportunity; automatic project creation is blocked"
    );
  }
  return match.id;
}

function addRows(
  rows: Record<string, unknown>[],
  byId: Map<string, Record<string, unknown>>
) {
  for (const row of rows) {
    const id = rowString(row, "id");
    if (id && !byId.has(id)) byId.set(id, row);
  }
}

async function addRowsForClientIds(
  supabase: SupabaseLike,
  companyId: string,
  clientIds: string[],
  byId: Map<string, Record<string, unknown>>
) {
  for (const clientId of Array.from(new Set(clientIds.filter(Boolean)))) {
    addRows(
      await fetchOpportunityRowsByClientIdentity(supabase, companyId, clientId),
      byId
    );
  }
}

export async function findOpportunityRelationshipMatch({
  supabase,
  companyId,
  connectionId,
  providerThreadId,
  clientId,
  facts,
}: FindOpportunityRelationshipMatchInput): Promise<OpportunityRelationshipDecision> {
  let providerLinkedOpportunityId: string | null = null;
  if (connectionId && providerThreadId) {
    const existingLinks = await rowsFrom(
      table(supabase, "opportunity_email_threads")
        .select("opportunity_id")
        .eq("thread_id", providerThreadId)
        .eq("connection_id", connectionId)
        .limit(1)
    );
    providerLinkedOpportunityId =
      rowString(existingLinks[0] ?? {}, "opportunity_id") ?? null;
  }

  const byId = new Map<string, Record<string, unknown>>();
  if (providerLinkedOpportunityId) {
    const linkedRows = await fetchOpportunityRowsByColumn(
      supabase,
      companyId,
      "id",
      providerLinkedOpportunityId
    );
    if (linkedRows.length !== 1) {
      throw new Error(
        "Provider-linked opportunity identity was not loaded in the mailbox company"
      );
    }
    addRows(linkedRows, byId);
  }
  if (clientId) {
    addRows(
      await fetchOpportunityRowsByClientIdentity(supabase, companyId, clientId),
      byId
    );
  }

  const contactEmail = normalizeEmail(facts.contactEmail);
  if (contactEmail) {
    addRows(
      await fetchOpportunityRowsByColumn(
        supabase,
        companyId,
        "contact_email",
        contactEmail
      ),
      byId
    );
    const [clients, subClients] = await Promise.all([
      fetchClientRowsByColumn(supabase, companyId, "email", contactEmail),
      fetchSubClientRowsByColumn(supabase, companyId, "email", contactEmail),
    ]);
    await addRowsForClientIds(
      supabase,
      companyId,
      [
        ...clients.map((client) => rowString(client, "id")),
        ...subClients.map((sub) => rowString(sub, "client_id")),
      ].filter(Boolean) as string[],
      byId
    );
  }

  const relationshipParticipantEmails = new Set(
    [
      ...(facts.participantEmails ?? []),
      ...(facts.address ? (facts.forwardedParticipantEmails ?? []) : []),
    ]
      .map(normalizeEmail)
      .filter(Boolean) as string[]
  );
  if (contactEmail) relationshipParticipantEmails.delete(contactEmail);
  for (const participantEmail of relationshipParticipantEmails) {
    addRows(
      await fetchOpportunityRowsByColumn(
        supabase,
        companyId,
        "contact_email",
        participantEmail
      ),
      byId
    );
    const [clients, subClients] = await Promise.all([
      fetchClientRowsByColumn(supabase, companyId, "email", participantEmail),
      fetchSubClientRowsByColumn(
        supabase,
        companyId,
        "email",
        participantEmail
      ),
    ]);
    await addRowsForClientIds(
      supabase,
      companyId,
      [
        ...clients.map((client) => rowString(client, "id")),
        ...subClients.map((sub) => rowString(sub, "client_id")),
      ].filter(Boolean) as string[],
      byId
    );
  }

  const contactPhone = facts.contactPhone?.trim();
  if (contactPhone) {
    addRows(
      await fetchOpportunityRowsByColumn(
        supabase,
        companyId,
        "contact_phone",
        contactPhone
      ),
      byId
    );
    const [clients, subClients] = await Promise.all([
      fetchClientRowsByColumn(
        supabase,
        companyId,
        "phone_number",
        contactPhone
      ),
      fetchSubClientRowsByColumn(
        supabase,
        companyId,
        "phone_number",
        contactPhone
      ),
    ]);
    await addRowsForClientIds(
      supabase,
      companyId,
      [
        ...clients.map((client) => rowString(client, "id")),
        ...subClients.map((sub) => rowString(sub, "client_id")),
      ].filter(Boolean) as string[],
      byId
    );
  }

  const address = facts.address?.trim();
  if (address) {
    const addressLookups = await Promise.all(
      addressDiscoveryPatterns(address).map(async (pattern) => {
        const [opportunities, clients, subClients, projects] =
          await Promise.all([
            fetchOpportunityRowsByAddressPattern(supabase, companyId, pattern),
            fetchClientRowsByAddressPattern(supabase, companyId, pattern),
            fetchSubClientRowsByAddressPattern(supabase, companyId, pattern),
            fetchProjectRowsByAddress(supabase, companyId, pattern),
          ]);
        return { opportunities, clients, subClients, projects };
      })
    );
    const opportunities = uniqueRowsById(
      addressLookups.flatMap((lookup) => lookup.opportunities)
    );
    const clients = uniqueRowsById(
      addressLookups.flatMap((lookup) => lookup.clients)
    );
    const subClients = uniqueRowsById(
      addressLookups.flatMap((lookup) => lookup.subClients)
    );
    const projects = uniqueRowsById(
      addressLookups.flatMap((lookup) => lookup.projects)
    );
    addRows(opportunities, byId);
    await addRowsForClientIds(
      supabase,
      companyId,
      [
        ...clients.map((client) => rowString(client, "id")),
        ...subClients.map((sub) => rowString(sub, "client_id")),
      ].filter(Boolean) as string[],
      byId
    );
    for (const project of projects) {
      const opportunityId =
        rowString(project, "opportunity_ref") ??
        rowString(project, "opportunity_id");
      if (!opportunityId) continue;
      const rows = await rowsFrom(
        table(supabase, "opportunities")
          .select(OPPORTUNITY_SELECT)
          .eq("id", opportunityId)
          .eq("company_id", companyId)
          .limit(1)
      );
      addRows(rows, byId);
    }
  }

  const candidates = (
    await Promise.all(
      Array.from(byId.values()).map((row) =>
        hydrateCandidate(supabase, companyId, row)
      )
    )
  ).filter(Boolean) as OpportunityRelationshipCandidate[];

  await Promise.all(
    candidates.map((candidate) =>
      attachUniqueStandaloneProject(supabase, companyId, candidate, facts)
    )
  );

  return decideOpportunityRelationshipMatch({
    facts,
    candidates,
    providerLinkedOpportunityId,
  });
}
