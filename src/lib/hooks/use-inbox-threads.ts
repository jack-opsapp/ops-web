/**
 * OPS Web - Inbox v2 React Hooks
 *
 * TanStack Query hooks for the rebuilt /inbox page. Wraps the new
 * /api/inbox/threads endpoints with:
 *   - useInboxThreads       : infinite cursor-paginated list
 *   - useInboxThread        : single thread detail + messages
 *   - useThreadActions      : archive/snooze/recategorize/markRead/preference
 *                             mutations with optimistic invalidation
 *
 * Firebase/Supabase auth header is pulled via getIdToken(). All hooks are
 * client-only ("use client" in consumers).
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import type {
  AgentBlockingQuestion,
  ArchiveLeadPreference,
  ArchiveWritebackPreference,
  DraftSource,
  EmailThreadCategory,
  EmailThreadLabel,
  InboxDraftRow,
  InboxScope,
  PhaseC,
  RoutingDecision,
} from "@/lib/types/email-thread";
import { type RailFilter } from "@/lib/inbox/rail-predicates";

// Re-export so consumers can import alongside the other inbox wire types.
export type { PhaseC, AgentBlockingQuestion } from "@/lib/types/email-thread";

/**
 * Wire shape for a sibling thread surfaced in the archive-confirmation modal.
 * Subset of EmailThread carrying only the fields the modal renders, matching
 * what `EmailThreadService.archive` puts on the wire.
 */
export interface ArchiveSiblingThread {
  id: string;
  subject: string;
  lastMessageAt: string;
  latestSenderName: string | null;
  latestSenderEmail: string | null;
  latestSnippet: string | null;
}

/**
 * Wire shape for the linked opportunity in the archive-confirmation modal.
 */
export interface ArchiveLinkedOpportunity {
  id: string;
  title: string;
}

// ─── Wire types (what the API returns) ──────────────────────────────────────

export interface InboxThreadRow {
  id: string;
  connectionId: string;
  providerThreadId: string;
  primaryCategory: EmailThreadCategory;
  categoryConfidence: number;
  categoryManuallySet: boolean;
  labels: EmailThreadLabel[];
  archivedAt: string | null;
  snoozedUntil: string | null;
  priorityScore: number;
  aiSummary: string | null;
  subject: string;
  participants: string[];
  firstMessageAt: string;
  lastMessageAt: string;
  messageCount: number;
  unreadCount: number;
  latestDirection: "inbound" | "outbound" | null;
  latestSenderEmail: string | null;
  latestSenderName: string | null;
  latestSnippet: string | null;
  opportunityId: string | null;
  clientId: string | null;
  /** Canonical client name (resolved server-side via clients.id join).
   *  Null when the thread isn't linked to a client. UI renders this in
   *  preference to latestSenderName so cards show "Acme Roofing" instead
   *  of "Jackson Sweet" on threads where the user is the latest sender. */
  clientName: string | null;
  /**
   * Earliest unresolved commitment due date across the thread's memories.
   * Denormalized from agent_memories via a DB trigger. Null when the
   * thread has no unresolved commitment. ISO-8601.
   */
  nextCommitmentDueAt: string | null;
  /** True when at least one unresolved commitment memory targets this thread. */
  hasUnresolvedCommitments: boolean;
  /**
   * `agent_memories.id` of the earliest-due unresolved commitment for this
   * thread. Drives the today-bar's inline ✓ resolve affordance — the row
   * patches THIS id, not the thread id, when the operator clicks ✓.
   * Null when no commitment, or when the derivation query was unreachable.
   */
  nextCommitmentId: string | null;
  /**
   * Derived from the latest `ai_draft_history` row matching this thread:
   *   - "ai_drafted" when Claude has a pending draft for the user to review
   *   - "auto_sent"  when Claude autonomously sent the most recent reply and
   *                  no inbound has come back yet
   *   - "none"       otherwise (no draft, discarded, or superseded by reply)
   *
   * Drives column grouping via `grouping.ts` and detail-band selection.
   */
  phaseC: PhaseC;
  /**
   * Phase C escalation — populated when Claude is blocked waiting on the
   * operator. Null on the steady state. Drives `agent.needsInput` in the
   * grouping/band layer; cleared via the answer endpoint.
   */
  agentBlockingQuestion: AgentBlockingQuestion | null;
  /**
   * Phase 3 — the persisted deterministic router decision. 'require_human_review'
   * means the inbox holds this thread for review (a HELD marker in the list, a
   * banner in the detail) and autonomy is suppressed. Null until first evaluated.
   */
  routing: RoutingDecision | null;
  /** Why the router held the thread — shown in the held-for-review banner. */
  routingReasons: string[] | null;
  /** 0..1 deterministic confidence; below 0.5 forces the hold. */
  routerConfidence: number | null;
}

export interface InboxThreadMessage {
  id: string;
  from: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  /** Full raw body including any quoted reply chain. Used on expand. */
  bodyText: string;
  /**
   * `bodyText` with the quoted reply chain removed — only this message's
   * new content. When equal to `bodyText`, no quotes were found.
   */
  cleanBodyText: string;
  /**
   * Inbound = someone else sent to the connection mailbox.
   * Outbound = the connection mailbox sent.
   * Server-derived by comparing from-address to the connection's email; do
   * not trust stored per-row direction fields for imported data.
   */
  direction: "inbound" | "outbound";
  date: string;
  isRead: boolean;
  hasAttachments: boolean;
}

/**
 * Compact shape for a sibling thread — other threads tied to the same
 * client as the one currently open. Rendered by ThreadSiblingStrip at
 * the top of the detail view. The fields here are the minimum the strip
 * needs for display (subject, category, time, unread) plus enough to
 * construct a placeholder {@link InboxThreadRow} for selection so the
 * detail view can refetch full detail on click without a second network
 * round-trip for the selection-only path.
 */
export interface InboxSiblingThread {
  id: string;
  connectionId: string;
  providerThreadId: string;
  subject: string;
  primaryCategory: EmailThreadCategory;
  lastMessageAt: string;
  messageCount: number;
  unreadCount: number;
  latestSenderName: string | null;
  latestSenderEmail: string | null;
  latestSnippet: string | null;
  archivedAt: string | null;
  snoozedUntil: string | null;
}

/**
 * An unresolved commitment attached to a thread. The detail view renders
 * these as pills at the top of the pane with a Resolve affordance. Order
 * is earliest-due first, matching the COMMITMENTS rail sort.
 */
export interface InboxThreadCommitment {
  /** agent_memories.id — use this to resolve via the PATCH endpoint. */
  id: string;
  /** The fact text extracted by Phase C (e.g. "Owner promised revised quote to John by Friday"). */
  content: string;
  /** ISO-8601. Null when Phase C recorded a commitment without a parseable date. */
  dueDate: string | null;
  /** 0–1 confidence from the extractor. Surfaced as a soft indicator in the UI. */
  confidence: number;
  /** When the commitment fact was created. */
  createdAt: string | null;
}

export interface InboxThreadDetail {
  thread: {
    id: string;
    primaryCategory: EmailThreadCategory;
    categoryConfidence: number;
    categoryManuallySet: boolean;
    labels: EmailThreadLabel[];
    archivedAt: string | null;
    snoozedUntil: string | null;
    aiSummary: string | null;
    subject: string;
    participants: string[];
    messageCount: number;
    unreadCount: number;
    opportunityId: string | null;
    clientId: string | null;
    /** Canonical client name, null when unmatched. Server-resolved via clients.id. */
    clientName: string | null;
    /** Latest message direction — drives the auto_sent freshness check and the
     *  ball-in-court band. Null when the thread has no messages classified yet. */
    latestDirection: "inbound" | "outbound" | null;
    /** Phase C draft state (see InboxThreadRow.phaseC). Drives detail-band selection. */
    phaseC: PhaseC;
    /** Phase C escalation (see InboxThreadRow.agentBlockingQuestion). */
    agentBlockingQuestion: AgentBlockingQuestion | null;
    /** Phase 3 — persisted router decision (see InboxThreadRow.routing). */
    routing: RoutingDecision | null;
    routingReasons: string[] | null;
    routerConfidence: number | null;
  };
  messages: InboxThreadMessage[];
  /**
   * Up to 5 other threads tied to the same client as `thread.clientId`,
   * most recent first. Archived siblings are excluded; snoozed ones are
   * kept because snooze is deferral, not closure. Empty array when
   * clientId is null or no other threads exist.
   */
  siblingThreads: InboxSiblingThread[];
  /**
   * Unresolved commitments Phase C extracted from this thread. Ordered
   * by due_date ASC (earliest first). Empty array when no commitments
   * or all have been resolved.
   */
  commitments: InboxThreadCommitment[];
}

export interface InboxThreadsPage {
  threads: InboxThreadRow[];
  nextCursor: string | null;
}

type InboxThreadsInfiniteCache = {
  pages: Array<{
    threads: InboxThreadRow[];
    nextCursor: string | null;
  }>;
  pageParams?: unknown;
};

function isInboxThreadsInfiniteCache(
  value: unknown,
): value is InboxThreadsInfiniteCache {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { pages?: unknown }).pages)
  );
}

function withoutAwaitingReply(
  labels: EmailThreadLabel[],
): EmailThreadLabel[] {
  return labels.includes("AWAITING_REPLY")
    ? labels.filter((label) => label !== "AWAITING_REPLY")
    : labels;
}

function updateInboxThreadListCaches(
  qc: QueryClient,
  mapRow: (row: InboxThreadRow) => InboxThreadRow,
) {
  const entries = qc.getQueriesData({
    queryKey: queryKeys.inbox.threadsAll(),
  });
  for (const [queryKey] of entries) {
    qc.setQueryData(queryKey, (old: unknown) => {
      if (!isInboxThreadsInfiniteCache(old)) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          threads: page.threads.map(mapRow),
        })),
      };
    });
  }
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}` };
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

export interface UseInboxThreadsParams {
  scope: InboxScope;
  filter: RailFilter;
  category?: EmailThreadCategory;
  search?: string;
  /**
   * Page size override. Omit for the default. The empty-status-view's
   * reply-debt section passes `limit: 10` so it can client-side sort
   * ASC by lastMessageAt and take the top 3 oldest without paging.
   */
  limit?: number;
}

async function fetchThreadsPage(
  params: UseInboxThreadsParams & { cursor?: string | null }
): Promise<InboxThreadsPage> {
  const qs = new URLSearchParams();
  qs.set("scope", params.scope);
  qs.set("filter", params.filter);
  if (params.category) qs.set("category", params.category);
  if (params.search) qs.set("search", params.search);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));

  const headers = await authHeaders();
  const res = await fetch(`/api/inbox/threads?${qs.toString()}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `threads fetch failed (${res.status})`);
  }
  return res.json();
}

async function fetchThreadDetail(threadId: string): Promise<InboxThreadDetail> {
  const headers = await authHeaders();
  const res = await fetch(`/api/inbox/threads/${threadId}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `thread fetch failed (${res.status})`);
  }
  return res.json();
}

// ─── Unread count (for sidebar badge) ───────────────────────────────────────

async function fetchUnreadCount(): Promise<number> {
  const headers = await authHeaders();
  const res = await fetch(`/api/inbox/threads?scope=own&filter=ALL&limit=50`, {
    headers,
  });
  if (!res.ok) return 0;
  const body = (await res.json()) as InboxThreadsPage;
  let count = 0;
  for (const t of body.threads) count += t.unreadCount;
  return count;
}

/**
 * Badge-ready unread count across the user's own inbox. Summed from the
 * first page of the ALL rail. Unread is visual-only state; reply debt stays
 * with `AWAITING_REPLY` and row-level state, not top-level rail membership.
 * Refreshes every 60s.
 */
export function useInboxUnreadCount() {
  return useQuery({
    queryKey: [...queryKeys.inbox.all, "v2", "unread"],
    queryFn: fetchUnreadCount,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}

// ─── List hook (infinite) ───────────────────────────────────────────────────

export function useInboxThreads(params: UseInboxThreadsParams) {
  return useInfiniteQuery({
    queryKey: queryKeys.inbox.threads({
      scope: params.scope,
      filter: params.filter,
      category: params.category ?? null,
      search: params.search ?? null,
      limit: params.limit ?? null,
    }),
    queryFn: ({ pageParam }) =>
      fetchThreadsPage({
        ...params,
        cursor: pageParam as string | null,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// ─── Detail hook ─────────────────────────────────────────────────────────────

export function useInboxThread(threadId: string | null) {
  return useQuery({
    queryKey: queryKeys.inbox.threadDetail(threadId ?? ""),
    queryFn: () => fetchThreadDetail(threadId!),
    enabled: !!threadId,
    refetchInterval: 20_000,
  });
}

// ─── Action mutations ────────────────────────────────────────────────────────

interface ActionArgs {
  threadId: string;
  action:
    | "archive"
    | "unarchive"
    | "snooze"
    | "unsnooze"
    | "recategorize"
    | "markRead"
    | "dismissAwaitingReply"
    | "restoreAwaitingReply";
  until?: string;
  toCategory?: EmailThreadCategory;
  note?: string;
  isRead?: boolean;
}

export interface ActionResponse {
  ok?: true;
  needsPreference?: true;
  needsConfirmation?: true;
  connectionId?: string;
  correctionId?: string;
  /** archive: linked opportunity id when archive automatically also archived the lead. */
  leadArchivedOpportunityId?: string | null;
  /** archive (needsConfirmation): the lead-archive preference currently saved on the connection. */
  leadPreference?: ArchiveLeadPreference;
  /** archive (needsConfirmation): the linked opportunity for the user to optionally archive. */
  linkedOpportunity?: ArchiveLinkedOpportunity;
  /** archive (needsConfirmation): other open threads on the same opportunity. */
  siblingThreads?: ArchiveSiblingThread[];
  /** dismissAwaitingReply: the thread's new label array after AWAITING_REPLY is cleared. */
  labels?: EmailThreadLabel[];
}

async function runThreadAction(args: ActionArgs): Promise<ActionResponse> {
  const headers = {
    ...(await authHeaders()),
    "Content-Type": "application/json",
  };
  const body: Record<string, unknown> = { action: args.action };
  if (args.until) body.until = args.until;
  if (args.toCategory) body.toCategory = args.toCategory;
  if (args.note) body.note = args.note;
  if (args.isRead !== undefined) body.isRead = args.isRead;

  const res = await fetch(`/api/inbox/threads/${args.threadId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `action failed (${res.status})`);
  }
  return res.json();
}

async function setWritebackPreferenceRequest(args: {
  connectionId: string;
  preference: ArchiveWritebackPreference;
}): Promise<void> {
  const headers = {
    ...(await authHeaders()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`/api/inbox/writeback-preference`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `preference set failed (${res.status})`);
  }
}

async function setLeadArchivePreferenceRequest(args: {
  connectionId: string;
  preference: ArchiveLeadPreference;
}): Promise<void> {
  const headers = {
    ...(await authHeaders()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`/api/inbox/lead-archive-preference`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `lead preference set failed (${res.status})`);
  }
}

export interface BatchArchiveArgs {
  threadIds: string[];
  archiveOpportunityId: string | null;
}

export interface BatchArchiveResponse {
  ok: true;
  archivedThreadIds: string[];
  failedThreadIds: string[];
  leadArchivedOpportunityId: string | null;
}

async function batchArchiveRequest(args: BatchArchiveArgs): Promise<BatchArchiveResponse> {
  const headers = {
    ...(await authHeaders()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`/api/inbox/threads/batch-archive`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `batch archive failed (${res.status})`);
  }
  return res.json();
}

export interface BatchUnarchiveArgs {
  threadIds: string[];
  unarchiveOpportunityId: string | null;
}

export interface BatchUnarchiveResponse {
  ok: true;
  unarchivedThreadIds: string[];
  failedThreadIds: string[];
  unarchivedOpportunityId: string | null;
}

async function batchUnarchiveRequest(
  args: BatchUnarchiveArgs
): Promise<BatchUnarchiveResponse> {
  const headers = {
    ...(await authHeaders()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`/api/inbox/threads/batch-unarchive`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `batch unarchive failed (${res.status})`);
  }
  return res.json();
}

// ─── Drafts ──────────────────────────────────────────────────────────────────
//
// Parallel to the threads list but scoped to drafts (provider + AI). Powered
// by /api/inbox/drafts which merges Gmail/M365 Drafts folder content with
// ai_draft_history rows where status='drafted'. The hook exposes BOTH the
// flat list (for the DRAFTS rail) and a map indexed by providerThreadId (for
// painting [DRAFT] pills on the conversation-list thread cards without a
// second network round-trip).
//
// Wire types live in @/lib/types/email-thread so the route + hook share one
// source of truth — re-exported here for consumer convenience.
export type { InboxDraftRow, DraftSource } from "@/lib/types/email-thread";

async function fetchDrafts(scope: InboxScope): Promise<InboxDraftRow[]> {
  const headers = await authHeaders();
  const res = await fetch(`/api/inbox/drafts?scope=${scope}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `drafts fetch failed (${res.status})`);
  }
  const payload = (await res.json()) as { drafts: InboxDraftRow[] };
  return payload.drafts;
}

/**
 * Merged drafts list. Polls every 60s — drafts don't move fast and we don't
 * want to hammer provider APIs (Gmail /drafts has a tighter rate budget than
 * /messages). Returns an empty array on error to keep the UI rendering.
 */
export function useInboxDrafts(scope: InboxScope) {
  return useQuery({
    queryKey: queryKeys.inbox.drafts(scope),
    queryFn: () => fetchDrafts(scope),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * Auto-save a provider draft. First call (no `draftId`) hits POST /api/inbox/drafts
 * and provisions a new row in the connection's Drafts folder; subsequent calls
 * pass back the returned id so the same row is updated in-place. The composer
 * debounces calls — see `inbox-route.tsx`.
 *
 * Returns the canonical `draftId` so the caller can stash it for the next tick.
 * Errors are surfaced but do not retry — auto-save is best-effort; if the
 * provider is unreachable the user can still send (which uses a different code
 * path) or copy their text out. The hook intentionally does NOT invalidate the
 * drafts query on every save — that would refetch the entire merged list on
 * every keystroke pause. Invalidation only fires on the FIRST save (when the
 * row is newly created and needs to surface in the switcher).
 */
export interface SaveDraftArgs {
  source?: "provider" | "lifecycle";
  connectionId?: string;
  to?: string;
  subject: string;
  body: string;
  providerThreadId?: string | null;
  /** Existing provider/local draft id; omit on the first provider save. */
  draftId: string | null;
}

export interface SaveDraftResponse {
  ok: true;
  draftId: string;
  source: "provider" | "lifecycle";
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation<SaveDraftResponse, Error, SaveDraftArgs>({
    mutationFn: async (args) => {
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      };
      const res = await fetch(`/api/inbox/drafts`, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `save failed (${res.status})`);
      }
      return (await res.json()) as SaveDraftResponse;
    },
    onSuccess: (_res, args) => {
      // Refresh lifecycle drafts after edits so the local row stays current
      // in the chip and inline draft bubble. Provider in-place autosaves skip
      // this to avoid refetching the provider list on every debounce tick.
      if (args.source === "lifecycle" || !args.draftId) {
        qc.invalidateQueries({ queryKey: queryKeys.inbox.drafts("own") });
        qc.invalidateQueries({ queryKey: queryKeys.inbox.drafts("company") });
      }
    },
  });
}

/**
 * Discard a draft. Source decides routing: provider → provider.deleteDraft;
 * ai → ai_draft_history.status='discarded'. Invalidates the drafts query so
 * the row drops from the UI immediately.
 */
export function useDiscardDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      source: DraftSource;
      id: string;
      connectionId: string | null;
    }) => {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ source: args.source, id: args.id });
      if (args.connectionId) qs.set("connectionId", args.connectionId);
      const res = await fetch(`/api/inbox/drafts?${qs.toString()}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `discard failed (${res.status})`);
      }
    },
    onSuccess: () => {
      // Invalidate the drafts query for BOTH scopes explicitly. A cached
      // "company" view won't refetch if we only invalidate "own", and a
      // prefix-match invalidation ([inbox, v2, drafts]) would silently
      // stop working if anyone adds `exact: true` to the invalidator.
      // Calling the factory makes the coupling load-bearing on the key
      // shape rather than on TanStack Query's matching semantics.
      qc.invalidateQueries({ queryKey: queryKeys.inbox.drafts("own") });
      qc.invalidateQueries({ queryKey: queryKeys.inbox.drafts("company") });
    },
  });
}

// ─── Commitment resolve mutation ────────────────────────────────────────────
//
// Hits PATCH /api/inbox/commitments/:id to toggle resolved state on an
// agent_memories row. The DB trigger (migration 077) picks up the change
// and recomputes email_threads.next_commitment_due_at + has_unresolved_commitments,
// which means the COMMITMENTS rail drops the thread automatically when
// its last commitment is resolved.

export interface ResolveCommitmentArgs {
  id: string;
  /** ISO-8601 for unresolve-back-to-this-due, or null for resolve-now. */
  resolvedAt: string | null;
  /** threadId so we can invalidate the parent thread's detail query. */
  threadId: string;
}

export function useResolveCommitment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: ResolveCommitmentArgs): Promise<void> => {
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      };
      const res = await fetch(`/api/inbox/commitments/${args.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ resolvedAt: args.resolvedAt }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `resolve failed (${res.status})`);
      }
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: queryKeys.inbox.threadsAll() });
      await qc.cancelQueries({
        queryKey: queryKeys.inbox.threadDetail(args.threadId),
      });

      const listSnapshot = qc.getQueriesData({
        queryKey: queryKeys.inbox.threadsAll(),
      });
      const detailKey = queryKeys.inbox.threadDetail(args.threadId);
      const detailSnapshot = qc.getQueryData(detailKey);

      if (args.resolvedAt !== null) {
        updateInboxThreadListCaches(qc, (row) => {
          if (row.id !== args.threadId || row.nextCommitmentId !== args.id) {
            return row;
          }
          return {
            ...row,
            hasUnresolvedCommitments: false,
            nextCommitmentDueAt: null,
            nextCommitmentId: null,
          };
        });

        qc.setQueryData(detailKey, (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const detail = old as InboxThreadDetail;
          return {
            ...detail,
            commitments: detail.commitments.filter(
              (commitment) => commitment.id !== args.id,
            ),
          };
        });
      }

      return { listSnapshot, detailKey, detailSnapshot };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.listSnapshot) {
        for (const [key, value] of ctx.listSnapshot) {
          qc.setQueryData(key, value);
        }
      }
      if (ctx?.detailKey) {
        qc.setQueryData(ctx.detailKey, ctx.detailSnapshot);
      }
    },
    onSuccess: (_res, args) => {
      // Invalidate both the thread detail (pill disappears) and the list
      // (rail sort + unread signal may shift).
      qc.invalidateQueries({ queryKey: queryKeys.inbox.threadDetail(args.threadId) });
      qc.invalidateQueries({ queryKey: queryKeys.inbox.threadsAll() });
    },
  });
}

// ─── Actions hook ────────────────────────────────────────────────────────────

export function useThreadActions() {
  const qc = useQueryClient();

  const invalidateLists = () =>
    qc.invalidateQueries({ queryKey: queryKeys.inbox.threadsAll() });
  const invalidateDetail = (threadId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.inbox.threadDetail(threadId) });

  const invalidateOpportunities = () =>
    qc.invalidateQueries({ queryKey: queryKeys.opportunities.all });

  const archive = useMutation({
    mutationFn: (threadId: string) =>
      runThreadAction({ threadId, action: "archive" }),
    onSuccess: (res, threadId) => {
      // The needsConfirmation case still resolves successfully here — the
      // server signals "I need user input" rather than throwing. We
      // invalidate lists either way (a successful archive needs them
      // refreshed; a confirmation request is harmless to refresh).
      invalidateLists();
      invalidateDetail(threadId);
      if (res.leadArchivedOpportunityId) {
        invalidateOpportunities();
      }
    },
  });

  const unarchive = useMutation({
    mutationFn: (threadId: string) =>
      runThreadAction({ threadId, action: "unarchive" }),
    onSuccess: (_res, threadId) => {
      invalidateLists();
      invalidateDetail(threadId);
    },
  });

  const snooze = useMutation({
    mutationFn: (args: { threadId: string; until: Date }) =>
      runThreadAction({
        threadId: args.threadId,
        action: "snooze",
        until: args.until.toISOString(),
      }),
    onSuccess: (_res, args) => {
      invalidateLists();
      invalidateDetail(args.threadId);
    },
  });

  const unsnooze = useMutation({
    mutationFn: (threadId: string) =>
      runThreadAction({ threadId, action: "unsnooze" }),
    onSuccess: (_res, threadId) => {
      invalidateLists();
      invalidateDetail(threadId);
    },
  });

  const recategorize = useMutation({
    mutationFn: (args: {
      threadId: string;
      toCategory: EmailThreadCategory;
      note?: string;
    }) =>
      runThreadAction({
        threadId: args.threadId,
        action: "recategorize",
        toCategory: args.toCategory,
        note: args.note,
      }),
    onSuccess: (_res, args) => {
      invalidateLists();
      invalidateDetail(args.threadId);
    },
  });

  const markRead = useMutation({
    mutationFn: (args: { threadId: string; isRead: boolean }) =>
      runThreadAction({
        threadId: args.threadId,
        action: "markRead",
        isRead: args.isRead,
      }),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: queryKeys.inbox.threadsAll() });
      await qc.cancelQueries({
        queryKey: queryKeys.inbox.threadDetail(args.threadId),
      });

      const listSnapshot = qc.getQueriesData({
        queryKey: queryKeys.inbox.threadsAll(),
      });
      const detailKey = queryKeys.inbox.threadDetail(args.threadId);
      const detailSnapshot = qc.getQueryData(detailKey);
      const nextUnreadCount = args.isRead ? 0 : 1;

      qc.setQueriesData(
        { queryKey: queryKeys.inbox.threadsAll() },
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const data = old as {
            pages?: Array<{
              threads: InboxThreadRow[];
              nextCursor: string | null;
            }>;
            pageParams?: unknown;
          };
          if (!Array.isArray(data.pages)) return old;
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              threads: page.threads.map((t) =>
                t.id === args.threadId
                  ? { ...t, unreadCount: nextUnreadCount }
                  : t,
              ),
            })),
          };
        },
      );

      qc.setQueryData(detailKey, (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const detail = old as InboxThreadDetail;
        return {
          ...detail,
          thread: {
            ...detail.thread,
            unreadCount: nextUnreadCount,
          },
          messages: detail.messages.map((message) => ({
            ...message,
            isRead: args.isRead,
          })),
        };
      });

      return { listSnapshot, detailKey, detailSnapshot };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.listSnapshot) {
        for (const [key, value] of ctx.listSnapshot) {
          qc.setQueryData(key, value);
        }
      }
      if (ctx?.detailKey) {
        qc.setQueryData(ctx.detailKey, ctx.detailSnapshot);
      }
    },
    onSuccess: (_res, args) => {
      invalidateLists();
      invalidateDetail(args.threadId);
    },
  });

  /**
   * Clear the AWAITING_REPLY label on a thread — the hover-X affordance on
   * the YOURS state-tag. Optimistically removes the label from every page
   * in the threads infinite cache so the chip flips from YOURS → FYI without
   * waiting for the refetch. On error, rolls back the optimistic update.
   *
   * onSuccess invalidates the lists for a real refresh; the optimistic
   * update is purely a perceived-latency improvement.
   */
  const dismissAwaitingReply = useMutation({
    mutationFn: (threadId: string) =>
      runThreadAction({ threadId, action: "dismissAwaitingReply" }),
    onMutate: async (threadId) => {
      // Cancel any in-flight refetch so it doesn't clobber the optimistic
      // mutation before the server response lands.
      await qc.cancelQueries({ queryKey: queryKeys.inbox.threadsAll() });
      const snapshot = qc.getQueriesData({
        queryKey: queryKeys.inbox.threadsAll(),
      });

      // Strip AWAITING_REPLY from the matching row across every cached page
      // of every list query (own/company × every filter). We treat the cache
      // as opaque structurally and only touch the labels array on the row.
      qc.setQueriesData(
        { queryKey: queryKeys.inbox.threadsAll() },
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const data = old as {
            pages?: Array<{ threads: InboxThreadRow[]; nextCursor: string | null }>;
            pageParams?: unknown;
          };
          if (!Array.isArray(data.pages)) return old;
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              threads: page.threads.map((t) =>
                t.id === threadId
                  ? { ...t, labels: t.labels.filter((l) => l !== "AWAITING_REPLY") }
                  : t,
              ),
            })),
          };
        },
      );

      return { snapshot };
    },
    onError: (_err, _threadId, ctx) => {
      // Roll back every cache entry we touched.
      if (ctx?.snapshot) {
        for (const [key, value] of ctx.snapshot) {
          qc.setQueryData(key, value);
        }
      }
    },
    onSuccess: (_res, threadId) => {
      invalidateLists();
      invalidateDetail(threadId);
    },
  });

  /**
   * Undo path for `dismissAwaitingReply`. Re-adds AWAITING_REPLY to the
   * thread's labels. Optimistically writes the cache so the YOURS chip
   * reappears immediately; rolls back on error.
   */
  const restoreAwaitingReply = useMutation({
    mutationFn: (threadId: string) =>
      runThreadAction({ threadId, action: "restoreAwaitingReply" }),
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: queryKeys.inbox.threadsAll() });
      const snapshot = qc.getQueriesData({
        queryKey: queryKeys.inbox.threadsAll(),
      });

      qc.setQueriesData(
        { queryKey: queryKeys.inbox.threadsAll() },
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const data = old as {
            pages?: Array<{ threads: InboxThreadRow[]; nextCursor: string | null }>;
            pageParams?: unknown;
          };
          if (!Array.isArray(data.pages)) return old;
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              threads: page.threads.map((t) =>
                t.id === threadId && !t.labels.includes("AWAITING_REPLY")
                  ? { ...t, labels: [...t.labels, "AWAITING_REPLY" as EmailThreadLabel] }
                  : t,
              ),
            })),
          };
        },
      );

      return { snapshot };
    },
    onError: (_err, _threadId, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, value] of ctx.snapshot) {
          qc.setQueryData(key, value);
        }
      }
    },
    onSuccess: (_res, threadId) => {
      invalidateLists();
      invalidateDetail(threadId);
    },
  });

  const setWritebackPreference = useMutation({
    mutationFn: setWritebackPreferenceRequest,
    onSuccess: () => {
      invalidateLists();
    },
  });

  const setLeadArchivePreference = useMutation({
    mutationFn: setLeadArchivePreferenceRequest,
  });

  const archiveBatch = useMutation({
    mutationFn: batchArchiveRequest,
    onSuccess: (res) => {
      invalidateLists();
      // Detail invalidation per archived thread — covers the case where the
      // user is currently viewing one of the siblings we just archived.
      for (const id of res.archivedThreadIds) {
        invalidateDetail(id);
      }
      if (res.leadArchivedOpportunityId) {
        invalidateOpportunities();
      }
    },
  });

  const unarchiveBatch = useMutation({
    mutationFn: batchUnarchiveRequest,
    onSuccess: (res) => {
      invalidateLists();
      for (const id of res.unarchivedThreadIds) {
        invalidateDetail(id);
      }
      if (res.unarchivedOpportunityId) {
        invalidateOpportunities();
      }
    },
  });

  return {
    archive,
    unarchive,
    snooze,
    unsnooze,
    recategorize,
    markRead,
    dismissAwaitingReply,
    restoreAwaitingReply,
    setWritebackPreference,
    setLeadArchivePreference,
    archiveBatch,
    unarchiveBatch,
  };
}

// ─── Agent blocking-question answer mutation ───────────────────────────────
//
// Hits POST /api/inbox/threads/:id/agent-question/answer. Clears the
// `email_threads.agent_blocking_question` column and records the answer
// to `agent_memories` so Phase C can pick it up on the next draft pass.
//
// `optionId` is set when the user picked a quick-pick chip; `answer` is
// the full text (the chip's label, or whatever the user typed). Sending
// both keeps the audit trail unambiguous.

export interface AnswerAgentQuestionArgs {
  threadId: string;
  /** Free-form text answer. For chip picks, pass the chip's label. */
  answer: string;
  /** Set when the user clicked a pre-canned option. */
  optionId?: string;
}

export function useAnswerAgentQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: AnswerAgentQuestionArgs): Promise<void> => {
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      };
      const res = await fetch(
        `/api/inbox/threads/${args.threadId}/agent-question/answer`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            answer: args.answer,
            optionId: args.optionId ?? null,
          }),
        },
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `answer failed (${res.status})`);
      }
    },
    onSuccess: (_res, args) => {
      qc.invalidateQueries({
        queryKey: queryKeys.inbox.threadDetail(args.threadId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.inbox.threadsAll() });
    },
  });
}

// ─── Send reply mutation ────────────────────────────────────────────────────
//
// Posts to /api/integrations/email/send. The route resolves the user's
// active email connection server-side, sends via Gmail/M365 provider, writes
// the outbound activity, updates correspondence counts, and stamps the OPS
// label. Caller passes the originating thread id so we can invalidate both
// the thread detail and the list on success — the sync engine will reconcile
// the actual message back into Supabase on the next cycle, but the optimistic
// invalidation keeps the UI responsive.

export interface SendReplyArgs {
  threadId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** Provider message-id of the message being replied to (RFC 2822 In-Reply-To). */
  inReplyTo?: string | null;
  /** Provider thread-id (Gmail thread, M365 conversation). */
  providerThreadId?: string | null;
  /** Linked opportunity for correspondence-count bump. */
  opportunityId?: string | null;
  /** Format hint for the route — markdown bodies get HTML-converted server-side. */
  format?: "markdown" | "text";
}

export interface SendReplyResponse {
  ok?: true;
  messageId: string;
  threadId: string;
  from?: string;
  sentAt?: string;
  labels?: EmailThreadLabel[];
  latestDirection?: "inbound" | "outbound" | null;
}

export function useSendReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      userId: string;
      companyId: string;
      payload: SendReplyArgs;
    }): Promise<SendReplyResponse> => {
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      };
      const res = await fetch(`/api/integrations/email/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          userId: args.userId,
          companyId: args.companyId,
          to: args.payload.to,
          cc: args.payload.cc ?? [],
          subject: args.payload.subject,
          body: args.payload.body,
          format: args.payload.format ?? "markdown",
          opportunityId: args.payload.opportunityId ?? null,
          inReplyTo: args.payload.inReplyTo ?? null,
          threadId: args.payload.providerThreadId ?? null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `send failed (${res.status})`);
      }
      return res.json() as Promise<SendReplyResponse>;
    },
    onSuccess: (res, args) => {
      if ((res.latestDirection ?? "outbound") !== "outbound") {
        qc.invalidateQueries({
          queryKey: queryKeys.inbox.threadDetail(args.payload.threadId),
        });
        qc.invalidateQueries({ queryKey: queryKeys.inbox.threadsAll() });
        qc.invalidateQueries({ queryKey: queryKeys.inbox.drafts("own") });
        return;
      }
      const sentAt = res.sentAt ?? new Date().toISOString();
      const latestSnippet = args.payload.body.trim().slice(0, 400);
      const applyOutboundState = (row: InboxThreadRow): InboxThreadRow => {
        if (row.id !== args.payload.threadId) return row;
        return {
          ...row,
          labels: withoutAwaitingReply(res.labels ?? row.labels),
          lastMessageAt: sentAt,
          messageCount: row.messageCount + 1,
          latestDirection: "outbound",
          latestSnippet: latestSnippet || row.latestSnippet,
          latestSenderEmail: res.from ?? row.latestSenderEmail,
        };
      };

      updateInboxThreadListCaches(qc, applyOutboundState);
      qc.setQueryData(
        queryKeys.inbox.threadDetail(args.payload.threadId),
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const detail = old as InboxThreadDetail;
          return {
            ...detail,
            thread: {
              ...detail.thread,
              labels: withoutAwaitingReply(res.labels ?? detail.thread.labels),
              latestDirection: "outbound",
              messageCount: detail.thread.messageCount + 1,
            },
          };
        },
      );
      qc.invalidateQueries({ queryKey: queryKeys.inbox.threadDetail(args.payload.threadId) });
      qc.invalidateQueries({ queryKey: queryKeys.inbox.threadsAll() });
      qc.invalidateQueries({ queryKey: queryKeys.inbox.drafts("own") });
    },
  });
}
