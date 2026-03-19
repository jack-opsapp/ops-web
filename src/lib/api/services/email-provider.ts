/**
 * OPS Web - Email Provider Interface
 *
 * Provider abstraction layer — Gmail and M365 implement this interface.
 * Normalizes email operations across providers.
 */

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

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface EmailProviderInterface {
  readonly providerType: "gmail" | "microsoft365";

  // Incremental sync
  fetchNewEmailsSince(syncToken: string): Promise<SyncResult>;
  fetchSentEmailsSince(syncToken: string): Promise<SyncResult>;

  // Search (for wizard sent mail analysis)
  searchEmails(
    query: string,
    options?: { maxResults?: number; after?: Date }
  ): Promise<NormalizedEmail[]>;

  // Thread operations
  fetchThread(threadId: string): Promise<NormalizedEmail[]>;

  // Labels/categories
  createLabel(name: string): Promise<string>;
  applyLabel(threadId: string, labelId: string): Promise<void>;
  removeLabel(threadId: string, labelId: string): Promise<void>;
  listLabels(): Promise<Array<{ id: string; name: string; type: string }>>;

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
