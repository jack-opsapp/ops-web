/**
 * OPS Web - Email Thread Types (Inbox v2)
 *
 * Thread-level state for the rebuilt inbox. Mirrors the `email_threads` and
 * `email_thread_category_corrections` tables (migration 071). Messages still
 * live on `activities` and are unchanged by the inbox rewrite — this file is
 * strictly for per-thread categorization, triage state, and corrections.
 */

// ─── Enumerations ────────────────────────────────────────────────────────────

/**
 * Primary category — exactly one per thread. Twelve values, matching the
 * DB CHECK constraint on `email_threads.primary_category` post
 * 20260428061836_collapse_lead_client_to_customer. The legacy LEAD/CLIENT
 * values were dropped from this union 2026-05-12 — they had zero rows in
 * production for months and the audit-driven rail collapse cleaned up
 * every downstream consumer.
 */
export type EmailThreadCategory =
  | "CUSTOMER"
  | "VENDOR"
  | "SUBTRADE"
  | "PLATFORM_BID"
  | "LEGAL"
  | "JOB_SEEKER"
  | "COLLECTIONS"
  | "MARKETING"
  | "RECEIPT"
  | "PERSONAL"
  | "INTERNAL"
  | "OTHER";

export const EMAIL_THREAD_CATEGORIES: readonly EmailThreadCategory[] = [
  "CUSTOMER",
  "VENDOR",
  "SUBTRADE",
  "PLATFORM_BID",
  "LEGAL",
  "JOB_SEEKER",
  "COLLECTIONS",
  "MARKETING",
  "RECEIPT",
  "PERSONAL",
  "INTERNAL",
  "OTHER",
] as const;

/** Secondary labels — multi-valued. */
export type EmailThreadLabel =
  | "URGENT"
  | "AWAITING_REPLY"
  | "HAS_ATTACHMENT"
  | "HAS_QUOTE"
  | "HAS_INVOICE"
  | "FROM_NEW_SENDER";

export const EMAIL_THREAD_LABELS: readonly EmailThreadLabel[] = [
  "URGENT",
  "AWAITING_REPLY",
  "HAS_ATTACHMENT",
  "HAS_QUOTE",
  "HAS_INVOICE",
  "FROM_NEW_SENDER",
] as const;

/**
 * Per-category Phase C autonomy level. Stored in
 * `email_connections.auto_send_settings.category_autonomy["primary:<CATEGORY>"]`.
 *
 * `auto_archive` only applies to RECEIPT/MARKETING/NEWSLETTER-style categories.
 * `auto_follow_up` only applies to LEAD (and optionally CLIENT).
 * The UI caps allowed levels per category — see phase-c-category-autonomy-service.
 */
export type EmailThreadAutonomyLevel =
  | "off"
  | "draft_on_request"
  | "auto_draft"
  | "auto_send"
  | "auto_archive"
  | "auto_follow_up";

/** Gmail/M365 write-back preference on archive. */
export type ArchiveWritebackPreference =
  | "ask"
  | "archive_in_gmail"
  | "mark_read_only"
  | "ops_only";

/**
 * Whether archiving an inbox thread should also archive its linked pipeline
 * opportunity (the "lead"). Asked once per connection on the first
 * opp-linked archive that has no sibling threads. When the thread shares an
 * opportunity with siblings, the user is always prompted via the multi-select
 * modal regardless of this preference.
 */
export type ArchiveLeadPreference = "ask" | "archive" | "leave";

// Rail filter type lives in `@/lib/inbox/rail-predicates`. Re-exported here
// so callers can continue to import alongside the other inbox wire types
// without a second module hop. The legacy `InboxRail` alias retains the
// old name in case any external consumer leans on it; the canonical
// identifier is `RailFilter`.
export type { RailFilter, RailFilter as InboxRail } from "@/lib/inbox/rail-predicates";
import type { RailFilter } from "@/lib/inbox/rail-predicates";

// ─── Drafts (shared wire shape) ─────────────────────────────────────────────
// Wire shape used by /api/inbox/drafts and consumed by useInboxDrafts on the
// client. Single declaration so the route and the hook can't drift. `source`
// + `id` are what the DELETE endpoint round-trips to find the underlying
// record (provider API vs. ai_draft_history row).

export type DraftSource = "provider" | "ai" | "lifecycle";

export interface InboxDraftRow {
  source: DraftSource;
  id: string;
  /**
   * Provider thread id when the draft is a reply. Null for standalone
   * compose drafts (new message typed in Gmail/Outlook without picking a
   * thread to reply to).
   */
  threadId: string | null;
  /**
   * Internal `email_threads.id` when OPS can resolve the provider thread id.
   * Lifecycle drafts are local rows, so this is the value the inbox should
   * navigate to while `threadId` remains the provider thread id for matching.
   */
  inboxThreadId?: string | null;
  /** Linked opportunity for local lifecycle drafts. */
  opportunityId?: string | null;
  /**
   * Connection id for provider drafts; AI drafts may also carry one when
   * the AI was scoped to a specific mailbox. Required by the discard path
   * for `source=provider` to pick the right provider client.
   */
  connectionId: string | null;
  /** Sender mailbox address — surfaced in multi-mailbox UIs. */
  fromEmail: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  /** ISO 8601. Provider-reported last-save time (Gmail internalDate /
   *  M365 lastModifiedDateTime); for AI drafts, row updated_at. */
  updatedAt: string;
}

/** Inbox scope — own mailbox vs. all company mailboxes (permission-gated). */
export type InboxScope = "own" | "company";

/**
 * Phase C draft state for a thread, derived from `ai_draft_history`. Drives
 * column grouping (`grouping.ts`) and detail-band selection (`band-selection.ts`).
 *
 *   - `none`       — no AI draft, or the latest one was discarded / superseded
 *                    by a fresh inbound reply
 *   - `ai_drafted` — Claude has a draft pending for the user to review/send
 *   - `auto_sent`  — Claude autonomously sent the latest reply (no user edits)
 *                    AND nothing has come back yet
 */
export type PhaseC = "none" | "ai_drafted" | "auto_sent";

/**
 * Phase C escalation when Claude cannot draft a reply without operator
 * input. Stored on `email_threads.agent_blocking_question` (jsonb). Drives
 * the lavender NEEDS_INPUT band and the column-top NEEDS_INPUT group.
 *
 * `options` is optional — when present, the band renders quick-pick
 * buttons; when absent, it renders a single "Provide answer" free-form
 * CTA that focuses the composer.
 */
export interface AgentBlockingQuestion {
  question: string;
  options?: Array<{ id: string; label: string }>;
  /** ISO 8601. When the question was first recorded by Phase C. */
  askedAt: string;
}

// ─── Core record ─────────────────────────────────────────────────────────────

export interface EmailThread {
  id: string;
  companyId: string;
  connectionId: string;
  providerThreadId: string;

  primaryCategory: EmailThreadCategory;
  categoryConfidence: number;
  categoryClassifiedAt: Date | null;
  categoryClassifierVersion: string;
  categoryManuallySet: boolean;

  labels: EmailThreadLabel[];

  archivedAt: Date | null;
  snoozedUntil: Date | null;
  priorityScore: number;
  aiSummary: string | null;

  // Denormalized summary.
  subject: string;
  participants: string[];
  firstMessageAt: Date;
  lastMessageAt: Date;
  messageCount: number;
  unreadCount: number;
  latestDirection: "inbound" | "outbound" | null;
  latestSenderEmail: string | null;
  latestSenderName: string | null;
  latestSnippet: string | null;

  // Pipeline linkage (nullable).
  opportunityId: string | null;
  clientId: string | null;

  // Phase C commitment denormalization — maintained by the
  // recompute_thread_commitments DB trigger. `nextCommitmentDueAt` is the
  // earliest unresolved commitment due date across the thread's
  // agent_memories rows (null when none). `hasUnresolvedCommitments`
  // mirrors the indexed boolean used by the COMMITMENTS rail filter.
  nextCommitmentDueAt: Date | null;
  hasUnresolvedCommitments: boolean;
  // Earliest-due unresolved commitment's `agent_memories.id` for this
  // thread, derived per-page by `EmailThreadService.list` / `getThread`.
  // The today-bar uses this to wire its inline ✓ resolve affordance to
  // the correct memory row without a second round-trip per click.
  // Null when the thread has no unresolved commitments (or when the
  // derivation query is unreachable — UI degrades to navigate-only).
  nextCommitmentId: string | null;

  // Phase C draft state — derived per-thread by `EmailThreadService.list` /
  // `getThread` from the latest `ai_draft_history` row matching
  // (connection_id, provider_thread_id). `mapEmailThreadFromDb` defaults
  // this to "none"; the service overlays the real value before returning.
  phaseC: PhaseC;

  // Phase C escalation — populated when Claude is blocked waiting on the
  // operator. Null on the steady-state (and for legacy rows before the
  // column existed). Cleared when the operator answers.
  agentBlockingQuestion: AgentBlockingQuestion | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryCorrection {
  id: string;
  companyId: string;
  threadId: string;
  userId: string;
  fromCategory: EmailThreadCategory;
  toCategory: EmailThreadCategory;
  senderEmail: string | null;
  senderDomain: string | null;
  participantsHash: string | null;
  subjectKeywords: string[];
  note: string | null;
  appliedToSimilar: boolean;
  similarCount: number;
  createdAt: Date;
}

// ─── DB row → domain mapper ─────────────────────────────────────────────────

/**
 * Map a Supabase row (snake_case) to our camelCase EmailThread.
 * Keeps parsing in one place so callers stay schema-agnostic.
 */
export function mapEmailThreadFromDb(row: Record<string, unknown>): EmailThread {
  const parseDate = (v: unknown): Date =>
    typeof v === "string" ? new Date(v) : (v as Date);
  const parseDateOrNull = (v: unknown): Date | null =>
    v == null ? null : typeof v === "string" ? new Date(v) : (v as Date);

  return {
    id: row.id as string,
    companyId: row.company_id as string,
    connectionId: row.connection_id as string,
    providerThreadId: row.provider_thread_id as string,
    primaryCategory: row.primary_category as EmailThreadCategory,
    categoryConfidence: Number(row.category_confidence ?? 0),
    categoryClassifiedAt: parseDateOrNull(row.category_classified_at),
    categoryClassifierVersion: (row.category_classifier_version as string) ?? "v1",
    categoryManuallySet: Boolean(row.category_manually_set),
    labels: ((row.labels as string[]) ?? []) as EmailThreadLabel[],
    archivedAt: parseDateOrNull(row.archived_at),
    snoozedUntil: parseDateOrNull(row.snoozed_until),
    priorityScore: Number(row.priority_score ?? 0),
    aiSummary: (row.ai_summary as string | null) ?? null,
    subject: (row.subject as string) ?? "",
    participants: ((row.participants as string[]) ?? []),
    firstMessageAt: parseDate(row.first_message_at),
    lastMessageAt: parseDate(row.last_message_at),
    messageCount: Number(row.message_count ?? 0),
    unreadCount: Number(row.unread_count ?? 0),
    latestDirection: (row.latest_direction as EmailThread["latestDirection"]) ?? null,
    latestSenderEmail: (row.latest_sender_email as string | null) ?? null,
    latestSenderName: (row.latest_sender_name as string | null) ?? null,
    latestSnippet: (row.latest_snippet as string | null) ?? null,
    opportunityId: (row.opportunity_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    nextCommitmentDueAt: parseDateOrNull(row.next_commitment_due_at),
    hasUnresolvedCommitments: Boolean(row.has_unresolved_commitments),
    // The service overlays the real id after the agent_memories join.
    // Bare callers (upsertFromEmail and friends) get null safely.
    nextCommitmentId: null,
    // Default to "none" — the service overlays the derived value after the
    // ai_draft_history join. Bare callers (e.g., upsertFromEmail) get a safe
    // default so they never see undefined.
    phaseC: "none",
    agentBlockingQuestion: parseAgentBlockingQuestion(row.agent_blocking_question),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

/**
 * Defensive jsonb parse. Migration 20260507000002 introduced the column;
 * pre-migration rows return undefined here. We also tolerate rows where
 * Phase C wrote something that doesn't quite match the agreed shape — a
 * malformed escalation should silently degrade to "no escalation" rather
 * than throw and break the inbox list.
 */
function parseAgentBlockingQuestion(
  raw: unknown,
): AgentBlockingQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const question = typeof obj.question === "string" ? obj.question.trim() : "";
  const askedAt = typeof obj.asked_at === "string" ? obj.asked_at : "";
  if (!question || !askedAt) return null;

  let options: AgentBlockingQuestion["options"];
  if (Array.isArray(obj.options)) {
    options = obj.options
      .map((o) => {
        if (!o || typeof o !== "object") return null;
        const opt = o as Record<string, unknown>;
        const id = typeof opt.id === "string" ? opt.id : "";
        const label = typeof opt.label === "string" ? opt.label : "";
        if (!id || !label) return null;
        return { id, label };
      })
      .filter((o): o is { id: string; label: string } => o !== null);
    if (options.length === 0) options = undefined;
  }

  return options ? { question, options, askedAt } : { question, askedAt };
}

export function mapCategoryCorrectionFromDb(
  row: Record<string, unknown>
): CategoryCorrection {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    threadId: row.thread_id as string,
    userId: row.user_id as string,
    fromCategory: row.from_category as EmailThreadCategory,
    toCategory: row.to_category as EmailThreadCategory,
    senderEmail: (row.sender_email as string | null) ?? null,
    senderDomain: (row.sender_domain as string | null) ?? null,
    participantsHash: (row.participants_hash as string | null) ?? null,
    subjectKeywords: ((row.subject_keywords as string[]) ?? []),
    note: (row.note as string | null) ?? null,
    appliedToSimilar: Boolean(row.applied_to_similar),
    similarCount: Number(row.similar_count ?? 0),
    createdAt:
      typeof row.created_at === "string"
        ? new Date(row.created_at)
        : (row.created_at as Date),
  };
}

// ─── List query contract (used by route + hook) ─────────────────────────────

export interface ListInboxThreadsParams {
  scope: InboxScope;
  filter: RailFilter;
  category?: EmailThreadCategory;
  search?: string;
  cursor?: string | null;
  limit?: number;
}

export interface ListInboxThreadsResult {
  threads: EmailThread[];
  nextCursor: string | null;
}
