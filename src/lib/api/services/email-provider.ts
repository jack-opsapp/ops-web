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
 * The provider's incremental sync token is no longer valid. Gmail:
 * startHistoryId is older than ~7 days or never existed. A fresh token is only
 * a future boundary: callers must reconcile the lost interval completely (or
 * fail closed) before persisting it.
 */
export class SyncTokenExpiredError extends Error {
  readonly code = "sync_token_expired" as const;
  constructor(
    message: string,
    public readonly providerStatus?: number
  ) {
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
  constructor(
    message: string,
    public readonly providerStatus?: number
  ) {
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

/**
 * Provider metadata understated or omitted an attachment size and the raw
 * response crossed the caller's hard byte ceiling. Providers must throw this
 * while streaming, before the full object is buffered in worker memory.
 */
export class ProviderAttachmentTooLargeError extends Error {
  readonly code = "provider_attachment_too_large" as const;

  constructor(
    message: string,
    public readonly observedSizeBytes: number | null = null
  ) {
    super(message);
    this.name = "ProviderAttachmentTooLargeError";
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
  /**
   * Provider-verified visible-sender domains. This must come from the provider
   * transport/authentication result, never from message body/header parsing.
   * Body-derived forwarded identities are promoted only when the outer From
   * domain appears here.
   */
  authenticatedFromDomains?: string[];
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

/**
 * Absolute read boundary that a caller may propagate through provider layers.
 * Providers that support bounded reads must treat `deadlineAt` as one shared
 * wall-clock deadline, not as a fresh timeout for each nested request.
 */
export interface ProviderReadPolicy {
  deadlineAt?: number;
  context?: string;
  /**
   * Normal reads refresh an expired OAuth token and persist the replacement.
   * Recovery/audit reads use `current_only_no_persist`: the provider must use
   * the current access token or fail before any OAuth or database write.
   */
  oauthTokenMode?: "refresh_and_persist" | "current_only_no_persist";
}

export interface WebhookSubscription {
  subscriptionId: string;
  expiresAt: Date;
  /** Random M365 clientState returned only when a subscription is created. */
  clientState?: string;
}

export interface SendEmailParams {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  contentType?: "text" | "html"; // Default "text". Set "html" for pre-converted HTML.
  inReplyTo?: string; // Provider message ID to reply to (for threading)
  threadId?: string; // Gmail threadId or M365 conversationId
}

export interface SendEmailResult {
  messageId: string; // Provider message ID of sent email (used for sync dedup)
  threadId: string; // Thread/conversation ID
}

export interface ProviderEmailSignatureResult {
  status: "available" | "not_configured" | "unsupported";
  source: "gmail_send_as" | "microsoft_confirmed";
  providerIdentity: string | null;
  contentHtml: string | null;
}

// ─── Attachment Types ────────────────────────────────────────────────────────

export const DEFAULT_EMAIL_ATTACHMENT_DOWNLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

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
  /** Provider-native attachment class. Reference attachments are links whose
   * raw bytes are not available through Microsoft Graph. */
  providerKind: "file" | "inline" | "item" | "reference";
  /** Immutable MIME part identity when the provider exposes one (Gmail). */
  providerPartId: string | null;
  /** CID without surrounding angle brackets, for inline HTML references. */
  contentId: string | null;
  isInline: boolean;
  /** False only when the provider cannot return raw bytes. */
  downloadSupported: boolean;
  /** Provider-owned external link for reference attachments. Never treated as
   * an OPS storage URL. */
  sourceUrl: string | null;
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

/** Result of placing a fresh-outreach draft that starts a NEW provider thread.
 *  `threadId` is the provider thread the draft message was minted into (Gmail
 *  message.threadId / M365 conversationId). Captured so the learning loop can
 *  track the client's eventual reply (ai_draft_history.thread_id). Null only if
 *  the provider response omitted it. */
export interface CreateNewThreadDraftResult {
  draftId: string;
  threadId: string | null;
}

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface EmailProviderInterface {
  readonly providerType: "gmail" | "microsoft365";

  /**
   * Fetch a fresh sync token for a new connection or as the future boundary of
   * a completeness-preserving expired-token reconciliation. For Gmail this
   * returns the current mailbox historyId from /profile. For M365 this returns
   * a versioned composite cursor whose empty folder/message links make the
   * next fetchNewEmailsSince call inventory the complete mailbox.
   */
  getInitialSyncToken(): Promise<string>;

  // Incremental sync — may throw SyncTokenExpiredError, ProviderAuthError,
  // ProviderScopeError, or ProviderApiError.
  fetchNewEmailsSince(syncToken: string): Promise<SyncResult>;
  fetchSentEmailsSince(syncToken: string): Promise<SyncResult>;

  // Search (for wizard sent mail analysis)
  searchEmails(
    query: string,
    options?: {
      maxResults?: number;
      after?: Date;
      readPolicy?: ProviderReadPolicy;
    }
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
  fetchThread(
    threadId: string,
    readPolicy?: ProviderReadPolicy
  ): Promise<NormalizedEmail[]>;

  // Attachments — scan threads for images and download them
  getImageAttachmentsFromThread(
    threadId: string,
    readPolicy?: ProviderReadPolicy
  ): Promise<ImageAttachmentMeta[]>;
  /**
   * Like `getImageAttachmentsFromThread` but returns every provider attachment
   * on the thread (images + PDFs + every other MIME type). Durable ingestion
   * must not discard small or filename-less inline parts because real customer
   * photos can be represented that way; presentation can classify decoration
   * later without losing the source bytes.
   *
   * Returned items carry the parent message's date so the inbox FILES tab
   * can sort newest-first and render the "MMM DD" stamp without a follow-up
   * thread fetch.
   */
  getAttachmentsFromThread(
    threadId: string,
    readPolicy?: ProviderReadPolicy
  ): Promise<EmailAttachmentMeta[]>;
  /** Enumerate one exact provider message. This is the durable ingestion seam:
   * queue jobs are keyed to a message/activity, never a thread alone. */
  getAttachmentsFromMessage(
    messageId: string,
    context?: { fromEmail?: string; date?: Date }
  ): Promise<EmailAttachmentMeta[]>;
  fetchAttachment(
    messageId: string,
    attachmentId: string,
    maxBytes?: number
  ): Promise<Buffer>;

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
    threadId?: string,
    contentType?: "text" | "html"
  ): Promise<string>;

  /**
   * Place a draft that begins a NEW conversation (no parent thread). Unlike
   * `createDraft`, the caller passes no threadId — the provider assigns a fresh
   * thread and we return its id alongside the draft id. Used for first-contact
   * outreach to a client whose only inbound correspondence is a forwarded
   * contact-form submission (the form lives on the forwarder's thread, not the
   * client's).
   */
  createNewThreadDraft(
    to: string,
    subject: string,
    body: string,
    contentType?: "text" | "html"
  ): Promise<CreateNewThreadDraftResult>;

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
    threadId?: string,
    contentType?: "text" | "html"
  ): Promise<void>;

  /**
   * List a bounded newest-first Drafts-folder snapshot for the inbox UI.
   * Absence from this list is never proof that an older draft was deleted or
   * sent because providers may paginate or clamp the page. State machines must
   * use getDraft() with the immutable provider draft id instead.
   */
  listDrafts(): Promise<NormalizedDraft[]>;

  /**
   * Fetch one provider draft by immutable draft identity. Returns null only
   * when that exact resource no longer exists or is no longer a draft.
   */
  getDraft(
    draftId: string,
    readPolicy?: ProviderReadPolicy
  ): Promise<NormalizedDraft | null>;

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

  /**
   * Read the provider-managed mailbox signature without mutating mailbox
   * settings. Gmail can read send-as signatures when the OAuth grant includes
   * gmail.settings.basic. Microsoft Graph exposes no equivalent signature
   * resource, so that provider reports `unsupported` and OPS falls back to an
   * explicitly confirmed signature stored in OPS.
   */
  getEmailSignature?(): Promise<ProviderEmailSignatureResult>;
}
