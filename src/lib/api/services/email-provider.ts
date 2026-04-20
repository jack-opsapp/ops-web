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
  bodyText: string;
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

  // Thread operations
  fetchThread(threadId: string): Promise<NormalizedEmail[]>;

  // Attachments — scan threads for images and download them
  getImageAttachmentsFromThread(threadId: string): Promise<ImageAttachmentMeta[]>;
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
