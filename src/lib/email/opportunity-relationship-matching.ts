export type OpportunityRelationshipConfidence =
  | "provider_thread"
  | "exact_contact_email"
  | "existing_sub_client"
  | "exact_phone"
  | "shared_active_address"
  | "active_project_address"
  | "quoted_prior_thread";

export interface OpportunityRelationshipProject {
  id: string;
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
  order: (column: string, options?: Record<string, unknown>) => QueryChain;
  limit: (count: number) => QueryChain;
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
  const normalized = value
    ?.toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized && normalized.length >= 8 ? normalized : null;
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
  return {
    action: "link",
    opportunityId: candidate.id,
    clientId: candidate.clientId,
    confidence,
    reason,
    evidence,
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

export function decideOpportunityRelationshipMatch({
  facts,
  candidates,
  providerLinkedOpportunityId,
}: DecideInput): OpportunityRelationshipDecision {
  if (providerLinkedOpportunityId) {
    return {
      action: "link",
      opportunityId: providerLinkedOpportunityId,
      clientId: null,
      confidence: "provider_thread",
      reason: "Existing provider thread link",
      evidence: ["provider_thread_link"],
    };
  }

  const sortedCandidates = [...candidates].sort(byNewest);
  const contactEmail = normalizeEmail(facts.contactEmail);
  const contactPhone = normalizePhone(facts.contactPhone);
  const address = normalizeAddress(facts.address);

  if (contactEmail) {
    for (const candidate of sortedCandidates) {
      const emails = normalizedCandidateEmails(candidate);
      if (!isActiveOpportunity(candidate) && !hasActiveProject(candidate)) {
        continue;
      }
      if (
        emails.contactEmail === contactEmail ||
        emails.clientEmails.has(contactEmail)
      ) {
        return linkDecision(
          candidate,
          "exact_contact_email",
          "Exact customer email matched an active opportunity",
          [`email:${contactEmail}`]
        );
      }
      if (emails.subClientEmails.has(contactEmail)) {
        return linkDecision(
          candidate,
          "existing_sub_client",
          "Existing sub-client email matched the opportunity's customer relationship",
          [`sub_client_email:${contactEmail}`]
        );
      }
    }
  }

  if (contactPhone) {
    for (const candidate of sortedCandidates) {
      if (!isActiveOpportunity(candidate) && !hasActiveProject(candidate)) {
        continue;
      }
      if (candidatePhoneSet(candidate).has(contactPhone)) {
        return linkDecision(
          candidate,
          "exact_phone",
          "Exact phone matched an active opportunity relationship",
          [`phone:${contactPhone}`]
        );
      }
    }
  }

  if (address) {
    for (const candidate of sortedCandidates) {
      if (!candidateAddressSet(candidate).has(address)) continue;
      if (hasActiveProject(candidate)) {
        return linkDecision(
          candidate,
          "active_project_address",
          "Address matched an active linked project",
          [
            `address:${address}`,
            `project_status:${normalizedProjectStatus(candidate)}`,
          ]
        );
      }
      if (isActiveOpportunity(candidate)) {
        return linkDecision(
          candidate,
          "shared_active_address",
          "Address matched an active opportunity",
          [`address:${address}`, `stage:${normalizedStage(candidate)}`]
        );
      }
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

  for (const candidate of sortedCandidates) {
    if (!isActiveOpportunity(candidate) && !hasActiveProject(candidate)) {
      continue;
    }
    if (!hasMeaningfulScopeOverlap(facts, candidate)) continue;
    return linkDecision(
      candidate,
      "quoted_prior_thread",
      "Incoming message overlaps known prior thread scope",
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
    console.warn("[opportunity-relationship-matching] read failed", error);
    return [];
  }
  if (!data) return [];
  return Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : [data as Record<string, unknown>];
}

function table(supabase: SupabaseLike, name: string) {
  return supabase.from(name) as TableBuilder;
}

const OPPORTUNITY_SELECT = [
  "id",
  "client_id",
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

function rowToCandidate(
  row: Record<string, unknown>
): OpportunityRelationshipCandidate {
  return {
    id: rowString(row, "id") ?? "",
    clientId: rowString(row, "client_id"),
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
  column: "client_id" | "contact_email" | "contact_phone" | "address",
  value: string
): Promise<Record<string, unknown>[]> {
  const query = table(supabase, "opportunities")
    .select(OPPORTUNITY_SELECT)
    .eq("company_id", companyId)
    [column === "client_id" ? "eq" : "ilike"](column, value)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(10);
  return rowsFrom(query);
}

async function fetchClientRowsByColumn(
  supabase: SupabaseLike,
  companyId: string,
  column: "email" | "phone_number" | "address",
  value: string
): Promise<Record<string, unknown>[]> {
  const query = table(supabase, "clients")
    .select("id, email, phone_number, address")
    .eq("company_id", companyId)
    .ilike(column, value)
    .is("deleted_at", null)
    .limit(10);
  return rowsFrom(query);
}

async function fetchSubClientRowsByColumn(
  supabase: SupabaseLike,
  companyId: string,
  column: "email" | "phone_number" | "address",
  value: string
): Promise<Record<string, unknown>[]> {
  const query = table(supabase, "sub_clients")
    .select("id, client_id, email, phone_number, address")
    .eq("company_id", companyId)
    .ilike(column, value)
    .is("deleted_at", null)
    .limit(10);
  return rowsFrom(query);
}

async function fetchProjectRowsByAddress(
  supabase: SupabaseLike,
  companyId: string,
  address: string
): Promise<Record<string, unknown>[]> {
  const query = table(supabase, "projects")
    .select(
      "id, opportunity_id, client_id, status, title, description, address, completed_at, deleted_at"
    )
    .eq("company_id", companyId)
    .ilike("address", address)
    .is("deleted_at", null)
    .limit(10);
  return rowsFrom(query);
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
          "id, status, title, description, address, completed_at, deleted_at"
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
        "id, status, title, description, address, completed_at, deleted_at"
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
      rowsFrom(
        table(supabase, "sub_clients")
          .select("email, phone_number, address")
          .eq("company_id", companyId)
          .eq("client_id", candidate.clientId)
          .is("deleted_at", null)
          .limit(25)
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
      await fetchOpportunityRowsByColumn(
        supabase,
        companyId,
        "client_id",
        clientId
      ),
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
  if (clientId) {
    addRows(
      await fetchOpportunityRowsByColumn(
        supabase,
        companyId,
        "client_id",
        clientId
      ),
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
    addRows(
      await fetchOpportunityRowsByColumn(
        supabase,
        companyId,
        "address",
        address
      ),
      byId
    );
    const [clients, subClients, projects] = await Promise.all([
      fetchClientRowsByColumn(supabase, companyId, "address", address),
      fetchSubClientRowsByColumn(supabase, companyId, "address", address),
      fetchProjectRowsByAddress(supabase, companyId, address),
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
    for (const project of projects) {
      const opportunityId = rowString(project, "opportunity_id");
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

  return decideOpportunityRelationshipMatch({
    facts,
    candidates,
    providerLinkedOpportunityId,
  });
}
