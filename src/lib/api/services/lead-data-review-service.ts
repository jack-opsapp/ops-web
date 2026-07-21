/**
 * Actor-scoped lead data review.
 *
 * Provider thread ids are mailbox-scoped, never globally unique. Reads are
 * classified only inside the authenticated actor's company and every item is
 * checked by the canonical opportunity + inbox authorization bridge. Writes
 * are single guarded RPCs so a failed authorization or invariant check leaves
 * every correspondence projection unchanged.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

const TERMINAL_STAGES = new Set(["won", "lost", "discarded"]);
const TEST_SEED_OPP_PREFIX = "d2000000-0000-4000-d200-";
const LEGACY_THREAD_PREFIX = "legacy:%";

export type ReviewItemKind = "split" | "terminal_live";

export interface DataReviewContext {
  actorUserId: string;
  companyId: string;
}

export interface OppMeta {
  id: string;
  companyId: string;
  title: string | null;
  stage: string | null;
  archived: boolean;
  deleted: boolean;
  clientId: string | null;
  clientName: string | null;
}

export interface ReviewOwner {
  opportunityId: string;
  title: string | null;
  stage: string | null;
  archived: boolean;
  deleted: boolean;
  terminal: boolean;
  activityCount: number;
  clientId: string | null;
  clientName: string | null;
}

export interface DataReviewItem {
  id: string;
  kind: ReviewItemKind;
  connectionId: string;
  providerThreadId: string;
  subject: string | null;
  clientId: string | null;
  clientName: string | null;
  lastActivityAt: string | null;
  reason: string;
  oppCount: number;
  terminalCount: number;
  owners: ReviewOwner[];
  linkCandidates: Array<{
    opportunityId: string;
    title: string | null;
    stage: string | null;
    terminal: boolean;
  }>;
}

export interface DataReviewQueue {
  split: DataReviewItem[];
  terminalLive: DataReviewItem[];
  quarantinedCount: number;
}

export interface LinkThreadInput extends DataReviewContext {
  connectionId: string;
  providerThreadId: string;
  targetOpportunityId: string;
  kind?: ReviewItemKind;
}

export interface LinkThreadResult {
  providerThreadId: string;
  targetOpportunityId: string;
  targetTitle: string | null;
  activitiesRepointed: number;
  resolutionVersion: number;
}

export interface QuarantineThreadInput extends DataReviewContext {
  connectionId: string;
  providerThreadId: string;
  kind?: ReviewItemKind;
}

export interface QuarantineThreadResult {
  providerThreadId: string;
  subject: string | null;
  activitiesQuarantined: number;
  resolutionVersion: number;
}

class DataReviewRpcError extends Error {
  readonly code: string | null;

  constructor(message: string, code?: string | null) {
    super(message);
    this.name = "DataReviewRpcError";
    this.code = code ?? null;
  }
}

export function isDataReviewAccessDenied(error: unknown): boolean {
  return (
    error instanceof DataReviewRpcError &&
    (error.code === "42501" || error.message === "data_review_access_denied")
  );
}

function cleanRequired(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required`);
  return cleaned;
}

function readResolutionVersion(result: Record<string, unknown>): number {
  const version = Number(result.resolution_version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(
      "Guarded data-review RPC returned an invalid resolution version"
    );
  }
  return version;
}

function isTerminal(opportunity: OppMeta): boolean {
  return opportunity.stage !== null && TERMINAL_STAGES.has(opportunity.stage);
}

function isHidden(opportunity: OppMeta): boolean {
  return opportunity.archived || opportunity.deleted;
}

function quarantineThreadId(providerThreadId: string): string {
  return `legacy:${providerThreadId}`;
}

function exactThreadKey(
  connectionId: string,
  providerThreadId: string
): string {
  return `${connectionId}\u0000${providerThreadId}`;
}

function ownerFrom(opportunity: OppMeta, activityCount: number): ReviewOwner {
  return {
    opportunityId: opportunity.id,
    title: opportunity.title,
    stage: opportunity.stage,
    archived: opportunity.archived,
    deleted: opportunity.deleted,
    terminal: isTerminal(opportunity),
    activityCount,
    clientId: opportunity.clientId,
    clientName: opportunity.clientName,
  };
}

async function fetchOppMeta(
  companyId: string,
  ids: string[]
): Promise<Map<string, OppMeta>> {
  const sb = requireSupabase();
  const result = new Map<string, OppMeta>();
  const unique = Array.from(new Set(ids.filter(Boolean)));

  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    const { data, error } = await sb
      .from("opportunities")
      .select(
        "id, company_id, title, stage, archived_at, deleted_at, client_id, clients(name)"
      )
      .in("id", chunk)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const client = row.clients as
        | { name?: string }
        | Array<{ name?: string }>
        | null;
      result.set(row.id as string, {
        id: row.id as string,
        companyId: row.company_id as string,
        title: (row.title as string) ?? null,
        stage: (row.stage as string) ?? null,
        archived: row.archived_at !== null,
        deleted: row.deleted_at !== null,
        clientId: (row.client_id as string) ?? null,
        clientName: Array.isArray(client)
          ? (client[0]?.name ?? null)
          : (client?.name ?? null),
      });
    }
  }

  return result;
}

async function canReview(
  context: DataReviewContext,
  connectionId: string,
  providerThreadId: string,
  kind: ReviewItemKind
): Promise<boolean> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc(
    "authorize_email_thread_data_review_as_system",
    {
      p_actor_user_id: context.actorUserId,
      p_company_id: context.companyId,
      p_connection_id: connectionId,
      p_provider_thread_id: providerThreadId,
      p_kind: kind,
      p_action: "view",
    }
  );
  if (error) throw new DataReviewRpcError(error.message, error.code);
  return data === true;
}

async function keepAuthorized(
  context: DataReviewContext,
  items: DataReviewItem[]
): Promise<DataReviewItem[]> {
  const authorized: DataReviewItem[] = [];
  for (const item of items) {
    if (
      await canReview(
        context,
        item.connectionId,
        item.providerThreadId,
        item.kind
      )
    ) {
      authorized.push(item);
    }
  }
  return authorized;
}

interface SplitActivityRow {
  id: string;
  company_id: string;
  email_connection_id: string;
  email_thread_id: string;
  opportunity_id: string;
  created_at: string;
}

async function fetchSplitProjectionOwners(
  companyId: string,
  identities: Array<{ connectionId: string; providerThreadId: string }>
): Promise<Map<string, Set<string>>> {
  const sb = requireSupabase();
  const identityKeys = new Set(
    identities.map(({ connectionId, providerThreadId }) =>
      exactThreadKey(connectionId, providerThreadId)
    )
  );
  const owners = new Map<string, Set<string>>();
  const connectionIds = Array.from(
    new Set(identities.map(({ connectionId }) => connectionId))
  );

  const recordOwner = (
    connectionId: string,
    providerThreadId: string,
    opportunityId: string | null
  ) => {
    if (!opportunityId) return;
    const key = exactThreadKey(connectionId, providerThreadId);
    if (!identityKeys.has(key)) return;
    const ids = owners.get(key) ?? new Set<string>();
    ids.add(opportunityId);
    owners.set(key, ids);
  };

  for (let index = 0; index < connectionIds.length; index += 100) {
    const connectionChunk = connectionIds.slice(index, index + 100);

    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb
        .from("email_threads")
        .select("connection_id, provider_thread_id, opportunity_id")
        .eq("company_id", companyId)
        .in("connection_id", connectionChunk)
        .not("opportunity_id", "is", null)
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as Array<{
        connection_id: string;
        provider_thread_id: string;
        opportunity_id: string | null;
      }>;
      for (const row of batch) {
        recordOwner(
          row.connection_id,
          row.provider_thread_id,
          row.opportunity_id
        );
      }
      if (batch.length < 1000) break;
    }

    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb
        .from("opportunity_email_threads")
        .select("connection_id, thread_id, opportunity_id")
        .in("connection_id", connectionChunk)
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as Array<{
        connection_id: string;
        thread_id: string;
        opportunity_id: string;
      }>;
      for (const row of batch) {
        recordOwner(row.connection_id, row.thread_id, row.opportunity_id);
      }
      if (batch.length < 1000) break;
    }
  }

  return owners;
}

async function fetchSplitItems(
  context: DataReviewContext
): Promise<DataReviewItem[]> {
  const sb = requireSupabase();
  const activities: SplitActivityRow[] = [];

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from("activities")
      .select(
        "id, company_id, email_connection_id, email_thread_id, opportunity_id, created_at"
      )
      .eq("company_id", context.companyId)
      .eq("type", "email")
      .not("email_connection_id", "is", null)
      .not("email_thread_id", "is", null)
      .neq("email_thread_id", "")
      .not("opportunity_id", "is", null)
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as SplitActivityRow[];
    activities.push(...batch);
    if (batch.length < 1000) break;
  }

  const grouped = new Map<
    string,
    {
      connectionId: string;
      providerThreadId: string;
      latest: string;
      owners: Map<string, string[]>;
    }
  >();

  for (const activity of activities) {
    if (activity.email_thread_id.startsWith("legacy:")) continue;
    if (activity.opportunity_id.startsWith(TEST_SEED_OPP_PREFIX)) continue;
    const key = exactThreadKey(
      activity.email_connection_id,
      activity.email_thread_id
    );
    const thread = grouped.get(key) ?? {
      connectionId: activity.email_connection_id,
      providerThreadId: activity.email_thread_id,
      latest: activity.created_at,
      owners: new Map<string, string[]>(),
    };
    const ids = thread.owners.get(activity.opportunity_id) ?? [];
    ids.push(activity.id);
    thread.owners.set(activity.opportunity_id, ids);
    if (activity.created_at > thread.latest)
      thread.latest = activity.created_at;
    grouped.set(key, thread);
  }

  const splitThreads = Array.from(grouped.values()).filter(
    (thread) => thread.owners.size > 1
  );
  const projectionOwners = await fetchSplitProjectionOwners(
    context.companyId,
    splitThreads
  );
  const meta = await fetchOppMeta(
    context.companyId,
    splitThreads.flatMap((thread) => [
      ...Array.from(thread.owners.keys()),
      ...Array.from(
        projectionOwners.get(
          exactThreadKey(thread.connectionId, thread.providerThreadId)
        ) ?? []
      ),
    ])
  );
  const items: DataReviewItem[] = [];

  for (const thread of splitThreads) {
    const owners = Array.from(thread.owners.entries())
      .map(([opportunityId, activityIds]) => {
        const opportunity = meta.get(opportunityId);
        return opportunity
          ? { opportunity, activityCount: activityIds.length }
          : null;
      })
      .filter(
        (owner): owner is { opportunity: OppMeta; activityCount: number } =>
          owner !== null
      )
      .sort((left, right) => right.activityCount - left.activityCount);

    // A missing/cross-company owner makes the whole item ineligible.
    if (owners.length !== thread.owners.size || owners.length < 2) continue;

    const terminalCount = owners.filter(({ opportunity }) =>
      isTerminal(opportunity)
    ).length;
    const liveOwners = owners.filter(
      ({ opportunity }) => !isTerminal(opportunity) && !isHidden(opportunity)
    );
    const eligibilityOwnerIds = new Set([
      ...Array.from(thread.owners.keys()),
      ...Array.from(
        projectionOwners.get(
          exactThreadKey(thread.connectionId, thread.providerThreadId)
        ) ?? []
      ),
    ]);
    const eligibilityOwners = Array.from(eligibilityOwnerIds)
      .map((opportunityId) => meta.get(opportunityId) ?? null)
      .filter((opportunity): opportunity is OppMeta => opportunity !== null);
    const eligibilityIsComplete =
      eligibilityOwners.length === eligibilityOwnerIds.size;
    const eligibilityClientId = eligibilityOwners[0]?.clientId ?? null;
    const hasOneExactClient =
      eligibilityIsComplete &&
      eligibilityOwners.length > 0 &&
      eligibilityOwners.every(
        (opportunity) => opportunity.clientId === eligibilityClientId
      );
    const distinctClients = new Set(
      eligibilityOwners.map((opportunity) => opportunity.clientId)
    ).size;
    const hasNullClient = eligibilityOwners.some(
      (opportunity) => opportunity.clientId === null
    );
    const top = owners[0].opportunity;
    const reason =
      terminalCount > 0
        ? `${terminalCount} owner(s) closed (won/lost/discarded) — re-point crosses a terminal boundary`
        : !hasOneExactClient
          ? `${distinctClients} distinct client(s)${hasNullClient ? " incl. unassigned" : ""} — spans more than one customer`
          : liveOwners.length !== 1
            ? `${liveOwners.length} live owners — no single canonical opportunity`
            : "Multiple owners on one provider thread — confirm the canonical owner";

    items.push({
      id: `${thread.connectionId}:${thread.providerThreadId}`,
      kind: "split",
      connectionId: thread.connectionId,
      providerThreadId: thread.providerThreadId,
      subject: top.title,
      clientId: top.clientId,
      clientName: top.clientName,
      lastActivityAt: thread.latest,
      reason,
      oppCount: owners.length,
      terminalCount,
      owners: owners.map(({ opportunity, activityCount }) =>
        ownerFrom(opportunity, activityCount)
      ),
      linkCandidates: hasOneExactClient
        ? owners
            .filter(({ opportunity }) => !isHidden(opportunity))
            .map(({ opportunity }) => ({
              opportunityId: opportunity.id,
              title: opportunity.title,
              stage: opportunity.stage,
              terminal: isTerminal(opportunity),
            }))
        : [],
    });
  }

  const authorized = await keepAuthorized(context, items);
  return authorized.sort(
    (left, right) =>
      (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? "") ||
      right.oppCount - left.oppCount
  );
}

interface EmailThreadRow {
  id: string;
  provider_thread_id: string;
  connection_id: string;
  opportunity_id: string | null;
  subject: string | null;
  created_at: string | null;
}

async function fetchTerminalLiveItems(
  context: DataReviewContext
): Promise<DataReviewItem[]> {
  const sb = requireSupabase();
  const threads: EmailThreadRow[] = [];

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from("email_threads")
      .select(
        "id, provider_thread_id, connection_id, opportunity_id, subject, created_at"
      )
      .eq("company_id", context.companyId)
      .neq("provider_thread_id", "")
      .is("opportunity_id", null)
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as EmailThreadRow[];
    threads.push(...batch);
    if (batch.length < 1000) break;
  }
  if (threads.length === 0) return [];

  const connectionIds = Array.from(
    new Set(threads.map((thread) => thread.connection_id))
  );
  const links = new Map<string, Set<string>>();
  for (let index = 0; index < connectionIds.length; index += 100) {
    const connectionChunk = connectionIds.slice(index, index + 100);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb
        .from("opportunity_email_threads")
        .select("connection_id, thread_id, opportunity_id")
        .in("connection_id", connectionChunk)
        .neq("thread_id", "")
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as Array<{
        connection_id: string;
        thread_id: string;
        opportunity_id: string;
      }>;
      for (const link of batch) {
        const key = `${link.connection_id}\u0000${link.thread_id}`;
        const owners = links.get(key) ?? new Set<string>();
        owners.add(link.opportunity_id);
        links.set(key, owners);
      }
      if (batch.length < 1000) break;
    }
  }

  const matched = threads
    .map((thread) => ({
      thread,
      ownerIds: Array.from(
        links.get(
          `${thread.connection_id}\u0000${thread.provider_thread_id}`
        ) ?? []
      ),
    }))
    .filter(({ ownerIds }) => ownerIds.length === 1);
  const meta = await fetchOppMeta(
    context.companyId,
    matched.flatMap(({ ownerIds }) => ownerIds)
  );
  const items: DataReviewItem[] = [];

  for (const { thread, ownerIds } of matched) {
    const opportunity = meta.get(ownerIds[0]);
    if (!opportunity || !isTerminal(opportunity) || isHidden(opportunity))
      continue;
    items.push({
      id: thread.id,
      kind: "terminal_live",
      connectionId: thread.connection_id,
      providerThreadId: thread.provider_thread_id,
      subject: thread.subject,
      clientId: opportunity.clientId,
      clientName: opportunity.clientName,
      lastActivityAt: thread.created_at,
      reason: `Cache unset; canonical owner is closed (${opportunity.stage}) but live — confirm it owns this thread`,
      oppCount: 1,
      terminalCount: 1,
      owners: [ownerFrom(opportunity, 0)],
      linkCandidates: [
        {
          opportunityId: opportunity.id,
          title: opportunity.title,
          stage: opportunity.stage,
          terminal: true,
        },
      ],
    });
  }

  const authorized = await keepAuthorized(context, items);
  return authorized.sort((left, right) =>
    (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? "")
  );
}

interface QuarantinedActivityRow {
  email_connection_id: string;
  email_thread_id: string;
}

async function fetchQuarantinedCount(
  context: DataReviewContext
): Promise<number> {
  const sb = requireSupabase();
  const activities: QuarantinedActivityRow[] = [];

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from("activities")
      .select("email_connection_id, email_thread_id")
      .eq("company_id", context.companyId)
      .eq("type", "email")
      .not("email_connection_id", "is", null)
      .not("opportunity_id", "is", null)
      .like("email_thread_id", LEGACY_THREAD_PREFIX)
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as QuarantinedActivityRow[];
    activities.push(...batch);
    if (batch.length < 1000) break;
  }

  const groups = new Map<
    string,
    { connectionId: string; providerThreadId: string; count: number }
  >();
  for (const activity of activities) {
    const providerThreadId = activity.email_thread_id.slice("legacy:".length);
    if (!providerThreadId) continue;
    const key = `${activity.email_connection_id}\u0000${providerThreadId}`;
    const group = groups.get(key) ?? {
      connectionId: activity.email_connection_id,
      providerThreadId,
      count: 0,
    };
    group.count += 1;
    groups.set(key, group);
  }

  let count = 0;
  for (const group of groups.values()) {
    if (
      await canReview(
        context,
        group.connectionId,
        group.providerThreadId,
        "split"
      )
    ) {
      count += group.count;
    }
  }
  return count;
}

async function callGuardedRpc(
  name:
    | "reassign_opportunity_email_thread_guarded"
    | "quarantine_opportunity_email_thread_guarded",
  args: Record<string, string>
): Promise<Record<string, unknown>> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new DataReviewRpcError(error.message, error.code);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${name} returned an invalid result`);
  }
  return data as Record<string, unknown>;
}

export const LeadDataReviewService = {
  async getQueue(context: DataReviewContext): Promise<DataReviewQueue> {
    const actorUserId = cleanRequired(context.actorUserId, "actor user id");
    const companyId = cleanRequired(context.companyId, "company id");
    const scoped = { actorUserId, companyId };
    const [split, terminalLive, quarantinedCount] = await Promise.all([
      fetchSplitItems(scoped),
      fetchTerminalLiveItems(scoped),
      fetchQuarantinedCount(scoped),
    ]);
    return { split, terminalLive, quarantinedCount };
  },

  async linkThread(input: LinkThreadInput): Promise<LinkThreadResult> {
    const providerThreadId = cleanRequired(
      input.providerThreadId,
      "provider thread id"
    );
    if (providerThreadId.startsWith("legacy:")) {
      throw new Error("REFUSED: thread is already quarantined");
    }
    const result = await callGuardedRpc(
      "reassign_opportunity_email_thread_guarded",
      {
        p_actor_user_id: cleanRequired(input.actorUserId, "actor user id"),
        p_company_id: cleanRequired(input.companyId, "company id"),
        p_connection_id: cleanRequired(input.connectionId, "connection id"),
        p_provider_thread_id: providerThreadId,
        p_target_opportunity_id: cleanRequired(
          input.targetOpportunityId,
          "target opportunity id"
        ),
        p_kind: input.kind ?? "split",
      }
    );
    return {
      providerThreadId: String(result.provider_thread_id ?? providerThreadId),
      targetOpportunityId: String(
        result.target_opportunity_id ?? input.targetOpportunityId
      ),
      targetTitle:
        typeof result.target_title === "string" ? result.target_title : null,
      activitiesRepointed: Number(result.activities_repointed ?? 0),
      resolutionVersion: readResolutionVersion(result),
    };
  },

  async quarantineThread(
    input: QuarantineThreadInput
  ): Promise<QuarantineThreadResult> {
    const providerThreadId = cleanRequired(
      input.providerThreadId,
      "provider thread id"
    );
    if (providerThreadId.startsWith("legacy:")) {
      throw new Error("REFUSED: thread is already quarantined");
    }
    const result = await callGuardedRpc(
      "quarantine_opportunity_email_thread_guarded",
      {
        p_actor_user_id: cleanRequired(input.actorUserId, "actor user id"),
        p_company_id: cleanRequired(input.companyId, "company id"),
        p_connection_id: cleanRequired(input.connectionId, "connection id"),
        p_provider_thread_id: providerThreadId,
        p_kind: input.kind ?? "split",
      }
    );
    return {
      providerThreadId: String(result.provider_thread_id ?? providerThreadId),
      subject: typeof result.subject === "string" ? result.subject : null,
      activitiesQuarantined: Number(result.activities_quarantined ?? 0),
      resolutionVersion: readResolutionVersion(result),
    };
  },

  _quarantineThreadId: quarantineThreadId,
};
