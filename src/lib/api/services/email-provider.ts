/**
 * OPS Web - Email Provider Interface
 *
 * Provider abstraction layer — Gmail and M365 implement this interface.
 * Normalizes email operations across providers.
 */

// ─── Typed errors ────────────────────────────────────────────────────────────
//
// Sync paths throw these so callers (sync-engine.runSync) can recover or
// mark the connection needs_reconnect without sniffing error strings.

/**
 * The provider's incremental sync token is no longer valid and must be
 * re-seeded. Gmail: startHistoryId is older than ~7 days or never existed.
 * Callers should fetch a fresh token via `getInitialSyncToken()` and treat
 * this sync cycle as a no-op.
 */
export class SyncTokenExpiredError extends Error {
  readonly code = "sync_token_expired" as const;
  constructor(message: string, public readonly providerStatus?: number) {
    super(message);
    this.name = "SyncTokenExpiredError";
  }
}

/**
 * Access token is invalid / revoked and refresh failed. Connection must be
 * re-authorized by the user. Callers should mark status='needs_reconnect'.
 */
export class ProviderAuthError extends Error {
  readonly code = "provider_auth_error" as const;
  constructor(message: string, public readonly providerStatus?: number) {
    super(message);
    this.name = "ProviderAuthError";
  }
}

/**
 * The current OAuth grant lacks a scope the operation requires (e.g. the
 * token is gmail.readonly but we tried to apply a label or send). Callers
 * should mark status='needs_reconnect' and prompt the user to re-authorize
 * with the correct scope.
 */
export class ProviderScopeError extends Error {
  readonly code = "provider_scope_error" as const;
  constructor(
    message: string,
    public readonly providerStatus?: number,
    public readonly requiredScope?: string
  ) {
    super(message);
    this.name = "ProviderScopeError";
  }
}

/** Generic provider API error — unexpected non-2xx response. */
export class ProviderApiError extends Error {
  readonly code = "provider_api_error" as const;
  constructor(
    message: string,
    public readonly providerStatus: number,
    public readonly providerBody?: unknown
  ) {
    super(message);
    this.name = "ProviderApiError";
  }
}

// ─── Normalized Types ────────────────────────────────────────────────────────

export interface NormalizedEmail {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  /** Full plain-text body. Used for AI classification, Phase C memory, and
   *  sync persistence — callers relying on complete context read this. */
  bodyText: string;
  /** Optional provider-native "new content only" body. Populated when the
   *  provider can deliver a reliably-stripped version (M365 `uniqueBody`;
   *  Gmail HTML-first structural stripping). When present, the thread-detail
   *  renderer prefers this over running plain-text regex stripping. Omit or
   *  set null/empty when the provider cannot confidently strip. */
  bodyTextClean?: string;
  date: Date;
  labelIds: string[];
  isRead: boolean;
  hasAttachments: boolean;
  sizeEstimate: number;
}

export interface SyncResult {
  emails: NormalizedEmail[];
  nextSyncToken: string;
}

export interface WebhookSubscription {
  subscriptionId: string;
  expiresAt: Date;
}

export interface SendEmailParams {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  contentType?: "text" | "html"; // Default "text". Set "html" for pre-converted HTML.
  inReplyTo?: string;   // Provider message ID to reply to (for threading)
  threadId?: string;     // Gmail threadId or M365 conversationId
}

export interface SendEmailResult {
  messageId: string;     // Provider message ID of sent email (used for sync dedup)
  threadId: string;      // Thread/conversation ID
}

// ─── Attachment Types ────────────────────────────────────────────────────────

export interface ImageAttachmentMeta {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  fromEmail: string;
}

/**
 * Full metadata for any attachment surfaced from a provider thread. Superset
 * of `ImageAttachmentMeta` — adds `date` (the parent message's send/receive
 * time) so the inbox right-rail can sort and format-render without a second
 * thread fetch. Used by `getAttachmentsFromThread`.
 */
export interface EmailAttachmentMeta {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  fromEmail: string;
  /** Send/receive time of the message that owns this attachment. */
  date: Date;
}

// ─── Draft Types ─────────────────────────────────────────────────────────────

/**
 * A normalized representation of a provider-side draft (Gmail `/drafts` or
 * M365 `/me/mailFolders/drafts/messages`). Drafts are unsent emails the user
 * composed in the native client (Gmail web, Apple Mail, Outlook, etc.) — OPS
 * surfaces them alongside its own AI drafts so the user has a single place to
 * find any in-flight reply.
 *
 * `threadId` is the provider's thread/conversation id when the draft is a
 * reply (Gmail fills this in automatically when you hit "Reply"); null for
 * standalone compose drafts. When present, OPS can attach the draft to the
 * corresponding inbox thread and show a [DRAFT] pill on that thread card.
 */
export interface NormalizedDraft {
  /** Provider draft id — used for DELETE and for update-in-place flows. */
  id: string;
  /** Gmail threadId / M365 conversationId when replying; null for new compose. */
  threadId: string | null;
  to: string[];
  cc: string[];
  subject: string;
  /** Draft body as plain text. HTML drafts are converted via htmlToPlainText. */
  bodyText: string;
  /** Last time the draft was saved/updated on the provider. */
  updatedAt: Date;
}

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface EmailProviderInterface {
  readonly providerType: "gmail" | "microsoft365";

  /**
   * Fetch a fresh sync token for a new connection or after a
   * SyncTokenExpiredError. For Gmail this returns the current mailbox
   * historyId from /profile. For M365 the delta query self-seeds, so this
   * returns an empty string and the next fetchNewEmailsSince call will
   * request the initial delta.
   */
  getInitialSyncToken(): Promise<string>;

  // Incremental sync — may throw SyncTokenExpiredError, ProviderAuthError,
  // ProviderScopeError, or ProviderApiError.
  fetchNewEmailsSince(syncToken: string): Promise<SyncResult>;
  fetchSentEmailsSince(syncToken: string): Promise<SyncResult>;

  // Search (for wizard sent mail analysis)
  searchEmails(
    query: string,
    options?: { maxResults?: number; after?: Date }
  ): Promise<NormalizedEmail[]>;

  /**
   * Paginated list of unique thread IDs in the mailbox, used for historical
   * backfill. Returns just the thread IDs — callers pair this with
   * `fetchThread` to pull full content. Order is roughly newest-first; the
   * provider-specific details differ (Gmail uses messages.list which orders
   * by internalDate desc; M365 uses /me/messages ordered by receivedDateTime
   * desc), but within a backfill it doesn't matter — all threads converge.
   *
   * Semantics:
   *   - `pageSize` is a hint; provider may clamp (Gmail max 500, M365 max 999).
   *   - `after` is inclusive. Omit for "everything".
   *   - `pageToken` = the `nextPageToken` returned from a previous call.
   *     Pass null/undefined on first call.
   *   - A null `nextPageToken` in the response means the walk is complete.
   *
   * Implementations must deduplicate thread IDs within a page; callers
   * still dedupe across pages. Implementations must NOT fetch full message
   * content here — that's what makes this cheap enough to paginate through
   * an entire mailbox.
   */
  listThreadIds(options: {
    pageSize?: number;
    after?: Date;
    pageToken?: string | null;
  }): Promise<{
    threadIds: string[];
    nextPageToken: string | null;
  }>;

  // Thread operations
  fetchThread(threadId: string): Promise<NormalizedEmail[]>;

  // Attachments — scan threads for images and download them
  getImageAttachmentsFromThread(threadId: string): Promise<ImageAttachmentMeta[]>;
  /**
   * Like `getImageAttachmentsFromThread` but returns ALL attachments on the
   * thread (images + PDFs + every other MIME type). Inline images below the
   * 5KB heuristic (signature decorations) are still skipped — they are noise
   * regardless of where they're displayed.
   *
   * Returned items carry the parent message's date so the inbox FILES tab
   * can sort newest-first and render the "MMM DD" stamp without a follow-up
   * thread fetch.
   */
  getAttachmentsFromThread(threadId: string): Promise<EmailAttachmentMeta[]>;
  fetchAttachment(messageId: string, attachmentId: string): Promise<Buffer>;

  // Labels/categories
  createLabel(name: string): Promise<string>;
  applyLabel(threadId: string, labelId: string): Promise<void>;
  removeLabel(threadId: string, labelId: string): Promise<void>;
  listLabels(): Promise<Array<{ id: string; name: string; type: string }>>;

  // Triage — archive, unarchive, snooze-equivalent (removes from INBOX), and
  // per-thread read state. All operate on the entire thread (Gmail threadId or
  // M365 conversationId). snoozeThread is identical to archiveThread at the
  // provider level — the snooze cron re-applies INBOX when the thread's OPS
  // snoozed_until expires.
  archiveThread(threadId: string): Promise<void>;
  unarchiveThread(threadId: string): Promise<void>;
  snoozeThread(threadId: string): Promise<void>;
  markThreadRead(threadId: string, isRead: boolean): Promise<void>;

  // Send
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;

  // Drafts
  createDraft(
    to: string,
    subject: string,
    body: string,
    threadId?: string
  ): Promise<string>;

  /**
   * Replace the contents of an existing provider draft. Used by the inbox
   * composer's debounced auto-save once a draft has been created — subsequent
   * keystrokes patch the same draft id rather than churn through delete+create.
   *
   * `threadId` is required on Gmail for reply-drafts (so the draft stays
   * pinned to the conversation); M365 ignores it (the draft already lives in
   * its parent conversation).
   */
  updateDraft(
    draftId: string,
    to: string,
    subject: string,
    body: string,
    threadId?: string
  ): Promise<void>;

  /**
   * List every draft currently sitting in the user's provider Drafts folder.
   * Includes both reply-drafts (with threadId) and new-compose drafts. Used
   * by /api/inbox/drafts to merge provider-side drafts with OPS AI drafts.
   *
   * Implementations fetch content too (not just ids) — cheap enough at the
   * page sizes we care about, and the UI needs subject/body/to for the list.
   */
  listDrafts(): Promise<NormalizedDraft[]>;

  /** Delete a draft from the provider. Idempotent on already-gone drafts. */
  deleteDraft(draftId: string): Promise<void>;

  // Push notifications
  setupWebhook(webhookUrl: string): Promise<WebhookSubscription>;
  renewWebhook(subscriptionId: string): Promise<WebhookSubscription>;
  validateWebhookRequest(
    headers: Record<string, string>,
    body: string
  ): Promise<boolean>;

  // Profile
  getProfile(): Promise<{ email: string; name: string }>;
}
