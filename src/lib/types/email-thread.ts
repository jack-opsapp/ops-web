/**
 * OPS Web - Email Thread Types (Inbox v2)
 *
 * Thread-level state for the rebuilt inbox. Mirrors the `email_threads` and
 * `email_thread_category_corrections` tables (migration 071). Messages still
 * live on `activities` and are unchanged by the inbox rewrite — this file is
 * strictly for per-thread categorization, triage state, and corrections.
 */

// ─── Enumerations ────────────────────────────────────────────────────────────

/** Primary category — exactly one per thread. */
export type EmailThreadCategory =
  | "LEAD"
  | "CLIENT"
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
  "LEAD",
  "CLIENT",
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

/** Split-inbox rail. */
export type InboxRail =
  | "needs_reply"
  | "everything"
  | "scheduled"
  | "done"
  | "drafts"
  | "commitments";

// ─── Drafts (shared wire shape) ─────────────────────────────────────────────
// Wire shape used by /api/inbox/drafts and consumed by useInboxDrafts on the
// client. Single declaration so the route and the hook can't drift. `source`
// + `id` are what the DELETE endpoint round-trips to find the underlying
// record (provider API vs. ai_draft_history row).

export type DraftSource = "provider" | "ai";

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
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
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
  filter: InboxRail;
  category?: EmailThreadCategory;
  search?: string;
  cursor?: string | null;
  limit?: number;
}

export interface ListInboxThreadsResult {
  threads: EmailThread[];
  nextCursor: string | null;
}
