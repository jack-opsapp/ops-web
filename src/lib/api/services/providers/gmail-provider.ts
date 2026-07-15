/**
 * OPS Web - Gmail Provider
 *
 * Implements EmailProviderInterface for Gmail using the Gmail REST API.
 * Wraps existing Gmail API logic from gmail-service.ts and gmail-token.ts
 * into the normalized provider interface.
 */

import type { EmailConnection } from "@/lib/types/email-connection";
import { requireSupabase } from "@/lib/supabase/helpers";
import { htmlToPlainText, stripQuotedHtml } from "@/lib/utils/email-parsing";
import {
  DEFAULT_EMAIL_ATTACHMENT_DOWNLOAD_LIMIT_BYTES,
  ProviderApiError,
  ProviderAttachmentTooLargeError,
  ProviderAuthError,
  ProviderScopeError,
  SyncTokenExpiredError,
  type CreateNewThreadDraftResult,
  type EmailAttachmentMeta,
  type EmailProviderInterface,
  type ImageAttachmentMeta,
  type NormalizedDraft,
  type NormalizedEmail,
  type ProviderEmailSignatureResult,
  type SendEmailParams,
  type SendEmailResult,
  type SyncResult,
  type WebhookSubscription,
} from "../email-provider";
import { readBoundedResponseBytes } from "./bounded-response";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const NON_DELIVERY_MESSAGE_LABELS = new Set(["DRAFT", "SPAM", "TRASH"]);
const MAX_GMAIL_MESSAGE_JSON_BYTES = 80 * 1024 * 1024;
const GMAIL_ATTACHMENT_JSON_OVERHEAD_BYTES = 64 * 1024;
const MAX_GMAIL_ATTACHMENTS_PER_MESSAGE = 500;
const MAX_GMAIL_ATTACHMENT_REQUEST_MS = 30_000;

function attachmentRequestSignal(): AbortSignal {
  return AbortSignal.timeout(MAX_GMAIL_ATTACHMENT_REQUEST_MS);
}

interface GmailAttachmentCollectionBudget {
  truncated: boolean;
}

/**
 * Inspect a Gmail API error response and throw a typed error. Used by sync
 * path methods so sync-engine can decide whether to re-seed, mark needs
 * reconnect, or surface the error.
 *
 * Gmail returns errors as { error: { code, message, errors: [{ reason, ... }] } }.
 * Key reasons we handle:
 *   - "notFound" with message mentioning historyId  → token is too old, re-seed
 *   - "invalid" on /history with empty startHistoryId → same
 *   - status 401 → auth error (token revoked)
 *   - status 403 with reason "insufficientPermissions" → scope error
 */
function throwForGmailError(
  status: number,
  body: unknown,
  context: string,
  requiredScope = "gmail.modify"
): never {
  const err = (
    body as {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
    }
  )?.error;
  const message = err?.message ?? `Gmail ${context} failed (status ${status})`;
  const reason = err?.errors?.[0]?.reason;

  if (status === 401) {
    throw new ProviderAuthError(`Gmail ${context}: ${message}`, status);
  }
  if (status === 403) {
    if (reason === "insufficientPermissions" || /insufficient/i.test(message)) {
      throw new ProviderScopeError(
        `Gmail ${context}: ${message}`,
        status,
        requiredScope
      );
    }
    throw new ProviderApiError(`Gmail ${context}: ${message}`, status, body);
  }
  if (status === 404 || status === 400 || status === 410) {
    // /history with expired or invalid startHistoryId → Gmail returns 404 with
    // reason "notFound" or 400 with reason "invalid". Treat as token-expired.
    if (
      context.includes("history") &&
      (reason === "notFound" ||
        reason === "invalid" ||
        /startHistoryId/i.test(message) ||
        /historyId/i.test(message))
    ) {
      throw new SyncTokenExpiredError(`Gmail ${context}: ${message}`, status);
    }
  }
  throw new ProviderApiError(`Gmail ${context}: ${message}`, status, body);
}

export class GmailProvider implements EmailProviderInterface {
  readonly providerType = "gmail" as const;
  private connection: EmailConnection;
  private readonly inlinePartData = new Map<string, string>();

  constructor(connection: EmailConnection) {
    this.connection = connection;
  }

  private async getToken(): Promise<string> {
    // Check if token is expired (with 60s buffer) and refresh if needed
    if (new Date() >= new Date(this.connection.expiresAt.getTime() - 60_000)) {
      return this.refreshAccessToken();
    }
    return this.connection.accessToken;
  }

  private async refreshAccessToken(): Promise<string> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        // Trim env vars — a trailing newline baked into the Vercel value
        // silently breaks string comparisons / OAuth requests with no
        // useful error surface. See GOOGLE_PUBSUB_TOPIC incident 2026-04-18.
        client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!.trim(),
        client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!.trim(),
        refresh_token: this.connection.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // invalid_grant → refresh token revoked or expired → user must reconnect.
      if (response.status === 400 && /invalid_grant/i.test(body)) {
        throw new ProviderAuthError(
          `Gmail refresh token revoked: ${body}`,
          response.status
        );
      }
      if (response.status === 401) {
        throw new ProviderAuthError(
          `Gmail token refresh unauthorized: ${body}`,
          response.status
        );
      }
      throw new ProviderApiError(
        `Gmail token refresh failed (${response.status}): ${body}`,
        response.status,
        body
      );
    }

    const json = await response.json();
    if (!json.access_token) {
      throw new ProviderAuthError("Failed to refresh Gmail access token");
    }

    const newAccessToken = json.access_token as string;
    const newExpiresAt = new Date(
      Date.now() + (json.expires_in as number) * 1000
    );

    // Update in-memory copy so subsequent calls in this cycle use the fresh token.
    this.connection.accessToken = newAccessToken;
    this.connection.expiresAt = newExpiresAt;

    // Persist to the database so the next cold-start invocation doesn't do a
    // wasted refresh, and so a partially-rotated token never gets stuck in
    // memory only. Direct supabase call rather than EmailService to avoid a
    // circular import (email-service → providers/gmail-provider → email-service).
    try {
      const supabase = requireSupabase();
      await supabase
        .from("email_connections")
        .update({
          access_token: newAccessToken,
          expires_at: newExpiresAt.toISOString(),
        })
        .eq("id", this.connection.id);
    } catch (err) {
      // Persistence failure is non-fatal for the current call — the
      // in-memory token is fresh. Log so we notice if it persists.
      console.error(
        `[gmail-provider] Failed to persist refreshed token for ${this.connection.id}:`,
        err
      );
    }

    return newAccessToken;
  }

  private async gmailFetch(
    path: string,
    options?: RequestInit
  ): Promise<Response> {
    const token = await this.getToken();
    return fetch(`${GMAIL_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });
  }

  async getInitialSyncToken(): Promise<string> {
    const res = await this.gmailFetch("/profile");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throwForGmailError(res.status, body, "profile (bootstrap historyId)");
    }
    const data = (await res.json()) as { historyId?: string };
    if (!data.historyId) {
      throw new ProviderApiError(
        "Gmail /profile returned no historyId",
        res.status,
        data
      );
    }
    return data.historyId;
  }

  async fetchNewEmailsSince(syncToken: string): Promise<SyncResult> {
    if (!syncToken) {
      // Empty syncToken would produce an invalid Gmail request. Callers must
      // bootstrap via getInitialSyncToken() first; throw the typed error so
      // sync-engine re-seeds and returns a clean no-op for this cycle.
      throw new SyncTokenExpiredError(
        "Gmail history fetch called with empty syncToken",
        undefined
      );
    }

    // One unfiltered History traversal is the mailbox's canonical incremental
    // snapshot. Running independent INBOX and SENT traversals can race: the
    // later cursor may advance past a message the earlier label snapshot did
    // not include. SyncEngine resolves direction from labels + authorship.
    return this.fetchEmailsAddedSince(syncToken, null, "mailbox");
  }

  async fetchSentEmailsSince(syncToken: string): Promise<SyncResult> {
    if (!syncToken) {
      throw new SyncTokenExpiredError(
        "Gmail history fetch called with empty syncToken",
        undefined
      );
    }

    return this.fetchEmailsAddedSince(syncToken, "SENT", "sent");
  }

  async searchEmails(
    query: string,
    options?: { maxResults?: number; after?: Date }
  ): Promise<NormalizedEmail[]> {
    let q = query;
    if (options?.after) {
      const epoch = Math.floor(options.after.getTime() / 1000);
      q += ` after:${epoch}`;
    }

    const requested = Number.isFinite(options?.maxResults)
      ? Math.max(1, Math.floor(options?.maxResults ?? 100))
      : 100;
    const ids = new Set<string>();
    let pageToken: string | undefined;

    do {
      const remaining = requested - ids.size;
      if (remaining <= 0) break;
      const params = new URLSearchParams({
        q,
        maxResults: String(Math.min(remaining, 500)),
      });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await this.gmailFetch(`/messages?${params.toString()}`);
      const data = await this.readGmailJson<{
        messages?: Array<{ id?: string }>;
        nextPageToken?: string;
      }>(res, "messages.list (search)");
      for (const message of data.messages ?? []) {
        if (message.id) ids.add(message.id);
        if (ids.size >= requested) break;
      }
      pageToken = data.nextPageToken || undefined;
    } while (pageToken && ids.size < requested);

    return this.fetchMessagesByIds([...ids]);
  }

  async fetchThread(threadId: string): Promise<NormalizedEmail[]> {
    const res = await this.gmailFetch(`/threads/${threadId}?format=full`);
    const data = await this.readGmailJson<{
      messages?: Array<Record<string, unknown>>;
    }>(res, `threads.get (${threadId})`);

    return (data.messages || [])
      .filter(
        (msg) =>
          !((msg.labelIds as string[] | undefined) ?? []).some((label) =>
            NON_DELIVERY_MESSAGE_LABELS.has(label.toUpperCase())
          )
      )
      .map((msg) => this.normalizeGmailMessage(msg));
  }

  async listThreadIds(options: {
    pageSize?: number;
    after?: Date;
    pageToken?: string | null;
  }): Promise<{ threadIds: string[]; nextPageToken: string | null }> {
    // Gmail caps /messages at 500; tolerate callers asking for more.
    const pageSize = Math.min(Math.max(options.pageSize ?? 500, 1), 500);

    // "in:anywhere" covers inbox + sent + archive + trash. Users asked for
    // "all my Gmail threads", not "just inbox" — Superhuman et al. pull
    // everything. If we ever want to scope tighter we can expose a flag.
    let q = "in:anywhere";
    if (options.after) {
      q += ` after:${Math.floor(options.after.getTime() / 1000)}`;
    }

    const params = new URLSearchParams({
      q,
      maxResults: String(pageSize),
    });
    if (options.pageToken) params.set("pageToken", options.pageToken);

    const res = await this.gmailFetch(`/messages?${params.toString()}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throwForGmailError(res.status, body, "messages.list (backfill)");
    }
    const data = (await res.json()) as {
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
    };

    // Dedupe within the page — a thread with N messages returns N entries.
    const seen = new Set<string>();
    const threadIds: string[] = [];
    for (const m of data.messages ?? []) {
      if (!m.threadId || seen.has(m.threadId)) continue;
      seen.add(m.threadId);
      threadIds.push(m.threadId);
    }

    return {
      threadIds,
      nextPageToken: data.nextPageToken ?? null,
    };
  }

  async createLabel(name: string): Promise<string> {
    const res = await this.gmailFetch("/labels", {
      method: "POST",
      body: JSON.stringify({
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    });
    const data = await res.json();
    return data.id;
  }

  async applyLabel(threadId: string, labelId: string): Promise<void> {
    await this.gmailFetch(`/threads/${threadId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  }

  async removeLabel(threadId: string, labelId: string): Promise<void> {
    await this.gmailFetch(`/threads/${threadId}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: [labelId] }),
    });
  }

  // ─── Triage write-back ────────────────────────────────────────────────────
  //
  // Gmail: archiving a thread = removing the INBOX system label. snoozing is
  // identical at the provider level; OPS re-applies INBOX via cron when the
  // snooze window expires. Read state is the UNREAD system label.

  async archiveThread(threadId: string): Promise<void> {
    await this.gmailFetch(`/threads/${threadId}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    });
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.gmailFetch(`/threads/${threadId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: ["INBOX"] }),
    });
  }

  async snoozeThread(threadId: string): Promise<void> {
    await this.gmailFetch(`/threads/${threadId}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    });
  }

  async markThreadRead(threadId: string, isRead: boolean): Promise<void> {
    await this.gmailFetch(`/threads/${threadId}/modify`, {
      method: "POST",
      body: JSON.stringify(
        isRead ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] }
      ),
    });
  }

  async listLabels(): Promise<
    Array<{ id: string; name: string; type: string }>
  > {
    const res = await this.gmailFetch("/labels");
    const data = await res.json();
    return (data.labels || []).map(
      (l: { id: string; name: string; type?: string }) => ({
        id: l.id,
        name: l.name,
        type: l.type || "user",
      })
    );
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { to, cc, subject, body, contentType, inReplyTo, threadId } = params;

    // For replies, fetch the original message's Message-ID header
    // so recipient mail clients thread correctly via In-Reply-To/References
    let inReplyToHeader = "";
    let referencesHeader = "";
    if (inReplyTo) {
      const res = await this.gmailFetch(
        `/messages/${inReplyTo}?format=metadata&metadataHeaders=Message-Id`
      );
      const data = await res.json();
      const hdrs = (data.payload?.headers || []) as Array<{
        name: string;
        value: string;
      }>;
      const msgIdHeader = hdrs.find(
        (h) => h.name.toLowerCase() === "message-id"
      )?.value;
      if (msgIdHeader) {
        inReplyToHeader = msgIdHeader;
        referencesHeader = msgIdHeader;
      }
    }

    // Build RFC 2822 message
    const raw = this.buildRawEmailForSend({
      to,
      cc: cc || [],
      subject,
      body,
      contentType: contentType || "text",
      inReplyTo: inReplyToHeader,
      references: referencesHeader,
    });

    const requestBody: Record<string, unknown> = { raw };
    if (threadId) requestBody.threadId = threadId;

    const res = await this.gmailFetch("/messages/send", {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
    const data = await res.json();

    if (!data.id) {
      throw new Error(`Gmail send failed: ${JSON.stringify(data)}`);
    }

    return {
      messageId: data.id as string,
      threadId: (data.threadId as string) || threadId || "",
    };
  }

  async createDraft(
    to: string,
    subject: string,
    body: string,
    threadId?: string,
    contentType: "text" | "html" = "text"
  ): Promise<string> {
    const raw = this.buildRawEmail(to, subject, body, contentType);
    const res = await this.gmailFetch("/drafts", {
      method: "POST",
      body: JSON.stringify({
        message: {
          raw,
          threadId: threadId || undefined,
        },
      }),
    });
    const data = await res.json();
    return data.id;
  }

  async createNewThreadDraft(
    to: string,
    subject: string,
    body: string,
    contentType: "text" | "html" = "text"
  ): Promise<CreateNewThreadDraftResult> {
    const raw = this.buildRawEmail(to, subject, body, contentType);
    // No threadId → Gmail mints a fresh thread for the draft message. The
    // drafts.create response carries that thread id at message.threadId.
    const res = await this.gmailFetch("/drafts", {
      method: "POST",
      body: JSON.stringify({ message: { raw } }),
    });
    const data = await res.json();
    const message = (data.message ?? {}) as { threadId?: string };
    return { draftId: data.id as string, threadId: message.threadId ?? null };
  }

  async updateDraft(
    draftId: string,
    to: string,
    subject: string,
    body: string,
    threadId?: string,
    contentType: "text" | "html" = "text"
  ): Promise<void> {
    // Gmail's drafts.update takes the same payload shape as drafts.create and
    // replaces the underlying message wholesale. The HTTP verb is PUT (not
    // PATCH) per the v1 API contract — there is no partial-update path.
    const raw = this.buildRawEmail(to, subject, body, contentType);
    const res = await this.gmailFetch(`/drafts/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({
        message: {
          raw,
          threadId: threadId || undefined,
        },
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throwForGmailError(res.status, errBody, "drafts.update");
    }
  }

  async listDrafts(): Promise<NormalizedDraft[]> {
    // /drafts returns id + minimal metadata only; the message body/headers
    // require a second fetch per draft. We cap at the 15 most recent to
    // bound wall-clock time — full-format fetches in serial used to push
    // heavy inboxes past the function timeout. Anyone sitting on more than
    // 15 unsent drafts is the degenerate case; the first 15 are what you
    // actually want to see.
    const DRAFT_LIMIT = 15;
    const listRes = await this.gmailFetch(`/drafts?maxResults=${DRAFT_LIMIT}`);
    if (!listRes.ok) {
      const body = await listRes.json().catch(() => ({}));
      throwForGmailError(listRes.status, body, "drafts.list");
    }
    const listData = (await listRes.json()) as {
      drafts?: Array<{
        id: string;
        message?: { id: string; threadId?: string };
      }>;
    };
    const drafts = (listData.drafts ?? []).slice(0, DRAFT_LIMIT);
    if (drafts.length === 0) return [];

    // Single parallel burst — 15 concurrent GETs is well under Gmail's
    // per-user budget and avoids the synthetic 150ms inter-batch pause.
    const results = await Promise.all(
      drafts.map((draft) => this.getDraft(draft.id))
    );
    return results.filter((draft): draft is NormalizedDraft => draft !== null);
  }

  async getDraft(draftId: string): Promise<NormalizedDraft | null> {
    const res = await this.gmailFetch(
      `/drafts/${encodeURIComponent(draftId)}?format=full`
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throwForGmailError(res.status, body, "drafts.get");
    }
    const full = (await res.json()) as Record<string, unknown>;
    return this.normalizeGmailDraft(full);
  }

  async deleteDraft(draftId: string): Promise<void> {
    // Gmail returns 204 on success, 404 if already gone. We treat both as
    // "draft is no longer there" and move on — caller-visible outcome is
    // identical, and other error statuses still throw.
    const res = await this.gmailFetch(`/drafts/${draftId}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      throwForGmailError(res.status, body, "drafts.delete");
    }
  }

  /**
   * Normalize a Gmail `draft.get?format=full` response into our wire shape.
   * Returns null if the payload is missing (Gmail occasionally returns
   * headerless stubs) — safer to drop than to surface an empty row.
   */
  private normalizeGmailDraft(
    draft: Record<string, unknown>
  ): NormalizedDraft | null {
    const id = draft.id as string;
    const msg = (draft.message ?? {}) as Record<string, unknown>;
    if (!msg || !msg.payload) return null;

    const payload = msg.payload as Record<string, unknown>;
    const headers = (payload.headers || []) as Array<{
      name: string;
      value: string;
    }>;
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ||
      "";

    // Drafts use the same body extraction as full messages; the clean
    // version would strip quoted content, but for drafts the user just
    // wrote the content so we keep the full body for editing.
    const { full } = this.extractBodies(payload);

    return {
      id,
      threadId: (msg.threadId as string) || null,
      to: this.parseAddressList(getHeader("To")),
      cc: this.parseAddressList(getHeader("Cc")),
      subject: getHeader("Subject"),
      bodyText: full,
      // Gmail exposes internalDate on the inner message, not the draft wrapper.
      updatedAt: msg.internalDate
        ? new Date(parseInt(msg.internalDate as string))
        : new Date(),
    };
  }

  async setupWebhook(_webhookUrl: string): Promise<WebhookSubscription> {
    // Precondition: Pub/Sub topic must be configured. Without this env
    // var, /watch returns an error body and we used to silently store
    // a fallback expiresAt with no subscription_id — producing rows the
    // renewal cron couldn't recover.
    //
    // Trim defensively: Gmail validates topicName against the regex
    // `projects/<project>/topics/<name>`. A single trailing newline in the
    // env value (easy to paste in via Vercel UI) breaks the regex match
    // with the unhelpful error "Invalid topicName does not match ...".
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC?.trim();
    if (!topicName) {
      throw new ProviderApiError(
        "Gmail webhook setup failed: GOOGLE_PUBSUB_TOPIC env var is not set",
        0
      );
    }

    const res = await this.gmailFetch("/watch", {
      method: "POST",
      body: JSON.stringify({
        topicName,
        labelIds: ["INBOX", "SENT"],
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throwForGmailError(res.status, body, "users.watch (webhook setup)");
    }

    const data = await res.json();
    if (!data.historyId) {
      throw new ProviderApiError(
        "Gmail /watch returned no historyId",
        res.status,
        data
      );
    }

    // Gmail returns expiration as a Unix-ms string. Parse defensively and
    // fall back to 7 days only if parsing actually succeeds AND the server
    // gave us a real response (i.e. this is not a silent-error path).
    const expMs = Number(data.expiration);
    const expiresAt =
      !isNaN(expMs) && expMs > Date.now()
        ? new Date(expMs)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return {
      subscriptionId: data.historyId as string,
      expiresAt,
    };
  }

  async renewWebhook(_subscriptionId: string): Promise<WebhookSubscription> {
    // Gmail watch just needs to be called again — it replaces the existing watch
    return this.setupWebhook("");
  }

  async validateWebhookRequest(
    headers: Record<string, string>,
    _body: string
  ): Promise<boolean> {
    // Gmail Pub/Sub push messages include an Authorization header with a Bearer token
    // In production, verify the token against Google's token info endpoint
    const auth = headers["authorization"] || "";
    return auth.startsWith("Bearer ");
  }

  // ─── Attachment Methods ──────────────────────────────────────────────────────

  /** Image MIME types we extract from email threads */
  private static IMAGE_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/gif",
    "image/bmp",
    "image/tiff",
  ]);

  /**
   * Scan a thread's messages for image attachments.
   * Returns metadata only — call fetchAttachment() to get the actual bytes.
   */
  async getImageAttachmentsFromThread(
    threadId: string
  ): Promise<ImageAttachmentMeta[]> {
    const all = await this.getAttachmentsFromThread(threadId);
    return all
      .filter((a) => GmailProvider.IMAGE_MIMES.has(a.mimeType.toLowerCase()))
      .map(({ date: _date, ...rest }) => rest);
  }

  /**
   * Scan a thread's messages for every attachment (images + PDFs + everything
   * else), including small and filename-less inline parts. The durable path
   * preserves source bytes first; downstream presentation can classify
   * signature decoration without risking loss of a real customer photo.
   */
  async getAttachmentsFromThread(
    threadId: string
  ): Promise<EmailAttachmentMeta[]> {
    const res = await this.gmailFetch(`/threads/${threadId}?format=full`, {
      signal: attachmentRequestSignal(),
    });
    const data = await this.readGmailJson<{
      messages?: Array<Record<string, unknown>>;
    }>(res, `threads.get attachments (${threadId})`);
    const out: EmailAttachmentMeta[] = [];

    for (const msg of data.messages ?? []) {
      const labels = (msg.labelIds as string[] | undefined) ?? [];
      if (
        labels.some((label) =>
          NON_DELIVERY_MESSAGE_LABELS.has(label.toUpperCase())
        )
      ) {
        continue;
      }
      this.collectMessageAttachments(msg, out);
    }

    return out;
  }

  async getAttachmentsFromMessage(
    messageId: string
  ): Promise<EmailAttachmentMeta[]> {
    const res = await this.gmailFetch(
      `/messages/${encodeURIComponent(messageId)}?format=full`,
      { signal: attachmentRequestSignal() }
    );
    const message = await this.readGmailJsonBounded<Record<string, unknown>>(
      res,
      `messages.get attachments (${messageId})`,
      MAX_GMAIL_MESSAGE_JSON_BYTES
    );
    if (message.id !== messageId) {
      throw new ProviderApiError(
        `Gmail messages.get attachments (${messageId}): response did not contain the requested message`,
        res.status,
        message
      );
    }
    const out: EmailAttachmentMeta[] = [];
    this.collectMessageAttachments(message, out, true);
    return out;
  }

  private collectMessageAttachments(
    msg: Record<string, unknown>,
    out: EmailAttachmentMeta[],
    cacheInlineData = false
  ): void {
    const msgId = msg.id as string;
    const payload = msg.payload as Record<string, unknown> | undefined;
    const headers = (payload?.headers || []) as Array<{
      name: string;
      value: string;
    }>;
    const fromHeader =
      headers.find((h: { name: string }) => h.name.toLowerCase() === "from")
        ?.value || "";
    const emailMatch = fromHeader.match(/<([^>]+)>/) || [null, fromHeader];
    const fromEmail = (emailMatch[1] || fromHeader).toLowerCase().trim();

    // Gmail returns internalDate as a string of ms-since-epoch on each
    // message. Use it directly — the per-message Date header is less
    // reliable (some senders ship it in the future / past).
    const internalDateMs = Number(msg.internalDate);
    const date = Number.isFinite(internalDateMs)
      ? new Date(internalDateMs)
      : new Date();

    const messageAttachments: EmailAttachmentMeta[] = [];
    const budget: GmailAttachmentCollectionBudget = { truncated: false };
    this.collectAttachmentParts(
      payload,
      msgId,
      fromEmail,
      date,
      messageAttachments,
      cacheInlineData,
      budget
    );
    out.push(...messageAttachments);
    if (budget.truncated) {
      out.push({
        messageId: msgId,
        attachmentId: "ops-enumeration-budget",
        filename: "Additional email files require review",
        mimeType: "application/octet-stream",
        size: 0,
        fromEmail,
        date,
        providerKind: "reference",
        providerPartId: null,
        contentId: null,
        isInline: false,
        downloadSupported: false,
        sourceUrl: null,
      });
    }
  }

  /**
   * Recursively walk a Gmail message payload and collect every part that
   * is a real downloadable MIME part. Normal text/HTML body parts can also use
   * attachmentId when Gmail stores a large body separately, so they require a
   * filename, content id, or attachment disposition before being classified.
   */
  private collectAttachmentParts(
    payload: Record<string, unknown> | undefined,
    messageId: string,
    fromEmail: string,
    date: Date,
    out: EmailAttachmentMeta[],
    cacheInlineData = false,
    budget: GmailAttachmentCollectionBudget = { truncated: false }
  ): void {
    if (!payload || budget.truncated) return;

    const mimeType = ((payload.mimeType as string) || "").toLowerCase();
    const filename = (payload.filename as string) || "";
    const body = payload.body as
      | { attachmentId?: string; data?: string; size?: number }
      | undefined;
    const partId = (payload.partId as string) || null;
    const headers = (payload.headers ?? []) as Array<{
      name?: string;
      value?: string;
    }>;
    const header = (name: string) =>
      headers.find((item) => item.name?.toLowerCase() === name)?.value ?? "";
    const disposition = header("content-disposition").toLowerCase();
    const contentId = header("content-id").replace(/^<|>$/g, "").trim() || null;
    const isTextBody = mimeType === "text/plain" || mimeType === "text/html";
    const hasPartData = Boolean(body?.data && partId);
    const hasAttachmentEvidence = Boolean(
      filename || contentId || /\b(?:inline|attachment)\b/.test(disposition)
    );
    const isAttachmentPart = Boolean(
      (body?.attachmentId || hasPartData) &&
      (!isTextBody || hasAttachmentEvidence)
    );

    if (isAttachmentPart) {
      if (out.length >= MAX_GMAIL_ATTACHMENTS_PER_MESSAGE) {
        budget.truncated = true;
        return;
      }
      const size = body?.size || 0;
      const isInline =
        /\binline\b/.test(disposition) ||
        Boolean(contentId) ||
        (hasPartData && !/\battachment\b/.test(disposition));
      const fallbackExtension = this.extensionForMime(mimeType);
      const resolvedFilename =
        filename ||
        `${isInline ? "inline-photo" : "attachment"}-${partId || "part"}${fallbackExtension ? `.${fallbackExtension}` : ""}`;
      out.push({
        messageId,
        attachmentId: body?.attachmentId || `inline:${partId}`,
        filename: resolvedFilename,
        mimeType: mimeType || "application/octet-stream",
        size,
        fromEmail,
        date,
        providerKind: isInline ? "inline" : "file",
        providerPartId: partId,
        contentId,
        isInline,
        downloadSupported: true,
        sourceUrl: null,
      });
      if (cacheInlineData && body?.data && partId) {
        this.inlinePartData.set(
          this.inlinePartKey(messageId, partId),
          body.data
        );
      }
    }

    const parts = payload.parts as Array<Record<string, unknown>> | undefined;
    if (parts) {
      for (const part of parts) {
        this.collectAttachmentParts(
          part,
          messageId,
          fromEmail,
          date,
          out,
          cacheInlineData,
          budget
        );
        if (budget.truncated) break;
      }
    }
  }

  /**
   * Download an attachment's raw bytes from Gmail.
   * Returns a Buffer with the file content.
   */
  async fetchAttachment(
    messageId: string,
    attachmentId: string,
    maxBytes = DEFAULT_EMAIL_ATTACHMENT_DOWNLOAD_LIMIT_BYTES
  ): Promise<Buffer> {
    if (attachmentId.startsWith("inline:")) {
      const partId = attachmentId.slice("inline:".length);
      if (!partId) {
        throw new ProviderApiError(
          "Gmail inline attachment is missing partId",
          400
        );
      }
      const cacheKey = this.inlinePartKey(messageId, partId);
      const cached = this.inlinePartData.get(cacheKey);
      if (cached) {
        this.inlinePartData.delete(cacheKey);
        return this.decodeAttachmentData(cached, maxBytes, cacheKey);
      }
      const res = await this.gmailFetch(
        `/messages/${encodeURIComponent(messageId)}?format=full`,
        { signal: attachmentRequestSignal() }
      );
      const message = await this.readGmailJsonBounded<Record<string, unknown>>(
        res,
        `messages.get inline attachment (${messageId}:${partId})`,
        MAX_GMAIL_MESSAGE_JSON_BYTES
      );
      const data = this.findInlinePartData(
        message.payload as Record<string, unknown> | undefined,
        partId
      );
      if (!data) {
        throw new ProviderApiError(
          `Gmail inline attachment part ${partId} was not present on message ${messageId}`,
          404
        );
      }
      return this.decodeAttachmentData(data, maxBytes, cacheKey);
    }

    const res = await this.gmailFetch(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { signal: attachmentRequestSignal() }
    );
    const data = await this.readGmailAttachmentJson(
      res,
      `attachments.get (${messageId}:${attachmentId})`,
      maxBytes
    );
    // Gmail returns base64url-encoded data
    const base64Data = data.data || "";
    if (!base64Data) {
      throw new ProviderApiError(
        `Gmail attachments.get (${messageId}:${attachmentId}) returned no bytes`,
        502,
        data
      );
    }
    return this.decodeAttachmentData(
      base64Data,
      maxBytes,
      `${messageId}:${attachmentId}`
    );
  }

  private inlinePartKey(messageId: string, partId: string): string {
    return `${messageId}\u0000${partId}`;
  }

  private decodeAttachmentData(
    data: string,
    maxBytes: number,
    context: string
  ): Buffer {
    const estimatedSize = Math.floor((data.length * 3) / 4);
    if (estimatedSize > maxBytes + 2) {
      throw new ProviderAttachmentTooLargeError(
        `Gmail attachment ${context} exceeds the ${maxBytes} byte limit`,
        estimatedSize
      );
    }

    const bytes = Buffer.from(data, "base64url");
    if (bytes.byteLength > maxBytes) {
      throw new ProviderAttachmentTooLargeError(
        `Gmail attachment ${context} exceeds the ${maxBytes} byte limit`,
        bytes.byteLength
      );
    }
    return bytes;
  }

  private async readGmailAttachmentJson(
    response: Response,
    context: string,
    maxBytes: number
  ): Promise<{ data?: string }> {
    if (!response.ok) {
      return this.readGmailJson<{ data?: string }>(response, context);
    }
    const encodedLimit =
      Math.ceil((maxBytes * 4) / 3) + GMAIL_ATTACHMENT_JSON_OVERHEAD_BYTES;
    try {
      return await this.readGmailJsonBounded<{ data?: string }>(
        response,
        context,
        encodedLimit
      );
    } catch (error) {
      if (error instanceof ProviderAttachmentTooLargeError) {
        throw new ProviderAttachmentTooLargeError(
          `Gmail attachment response exceeds the ${maxBytes} byte limit`
        );
      }
      throw error;
    }
  }

  private findInlinePartData(
    payload: Record<string, unknown> | undefined,
    partId: string
  ): string | null {
    if (!payload) return null;
    const body = payload.body as { data?: string } | undefined;
    if (payload.partId === partId && body?.data) return body.data;
    for (const part of (payload.parts as
      | Array<Record<string, unknown>>
      | undefined) ?? []) {
      const found = this.findInlinePartData(part, partId);
      if (found) return found;
    }
    return null;
  }

  private extensionForMime(mimeType: string): string {
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/heic": "heic",
      "image/heif": "heif",
      "image/bmp": "bmp",
      "image/tiff": "tiff",
      "application/pdf": "pdf",
    };
    return extensions[mimeType.toLowerCase()] ?? "";
  }

  async getProfile(): Promise<{ email: string; name: string }> {
    const res = await this.gmailFetch("/profile");
    const data = await res.json();
    return {
      email: data.emailAddress,
      name: data.emailAddress, // Gmail profile doesn't always have display name
    };
  }

  async getEmailSignature(): Promise<ProviderEmailSignatureResult> {
    const res = await this.gmailFetch("/settings/sendAs");
    const data = await this.readGmailJson<{
      sendAs?: Array<{
        sendAsEmail?: string;
        signature?: string;
        isDefault?: boolean;
        isPrimary?: boolean;
      }>;
    }>(
      res,
      "settings.sendAs.list",
      "https://www.googleapis.com/auth/gmail.settings.basic"
    );

    const identities = data.sendAs ?? [];
    const connectedAddress = this.connection.email.trim().toLowerCase();
    const selected = identities.find(
      (identity) =>
        identity.sendAsEmail?.trim().toLowerCase() === connectedAddress
    );

    const providerIdentity =
      selected?.sendAsEmail?.trim() || this.connection.email.trim() || null;
    const contentHtml = selected?.signature?.trim() ?? "";
    if (!contentHtml) {
      return {
        status: "not_configured",
        source: "gmail_send_as",
        providerIdentity,
        contentHtml: null,
      };
    }

    return {
      status: "available",
      source: "gmail_send_as",
      providerIdentity,
      contentHtml,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Read every Gmail history page before exposing the new cursor. Gmail can
   * repeat a message across history records/pages, so message ids are collected
   * in insertion order through a Set before the full messages are fetched.
   * Any history-page or materializable-message failure aborts the result.
   * A post-discovery messages.get 404/410 is the one safe exception: Gmail has
   * permanently removed that object, so it is a tombstone rather than retryable
   * correspondence and cannot justify pinning the history cursor forever.
   */
  private async fetchEmailsAddedSince(
    syncToken: string,
    labelId: "INBOX" | "SENT" | null,
    contextLabel: "mailbox" | "inbox" | "sent"
  ): Promise<SyncResult> {
    const messageIds = new Set<string>();
    let pageToken: string | undefined;
    let finalHistoryId = syncToken;

    do {
      const params = new URLSearchParams({
        historyTypes: "messageAdded",
        startHistoryId: syncToken,
      });
      if (labelId) params.set("labelId", labelId);
      if (pageToken) params.set("pageToken", pageToken);

      const res = await this.gmailFetch(`/history?${params.toString()}`);
      const data = await this.readGmailJson<{
        history?: Array<{
          messagesAdded?: Array<{ message?: { id?: string } }>;
        }>;
        historyId?: string;
        nextPageToken?: string;
      }>(res, `history.list (${contextLabel})`);

      for (const record of data.history || []) {
        for (const added of record.messagesAdded || []) {
          if (added.message?.id) messageIds.add(added.message.id);
        }
      }

      if (data.historyId) finalHistoryId = data.historyId;
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);

    const emails = await this.fetchMessagesByIds([...messageIds], {
      // History is a discovery log, not a snapshot. A message can be deleted
      // or permanently expunged after history.list names it but before the
      // follow-up messages.get. That 404/410 is a durable tombstone: there is
      // no correspondence left to materialize, so the history cursor may
      // advance. Every other response still fails the whole page closed.
      ignoreMissingHistoryMessages: true,
    });
    return {
      emails: emails.filter(
        (email) =>
          !email.labelIds.some((label) =>
            NON_DELIVERY_MESSAGE_LABELS.has(label.toUpperCase())
          )
      ),
      nextSyncToken: finalHistoryId,
    };
  }

  private async readGmailJson<T>(
    response: Response,
    context: string,
    requiredScope?: string
  ): Promise<T> {
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new ProviderApiError(
        `Gmail ${context}: response was not valid JSON`,
        response.status,
        { parseError: error instanceof Error ? error.message : String(error) }
      );
    }

    if (!response.ok) {
      throwForGmailError(response.status, body, context, requiredScope);
    }

    return body as T;
  }

  private async readGmailJsonBounded<T>(
    response: Response,
    context: string,
    maxResponseBytes: number,
    requiredScope?: string
  ): Promise<T> {
    if (!response.ok) {
      return this.readGmailJson<T>(response, context, requiredScope);
    }

    const raw = await readBoundedResponseBytes(
      response,
      maxResponseBytes,
      `Gmail ${context} response`
    );
    try {
      return JSON.parse(raw.toString("utf8")) as T;
    } catch (error) {
      throw new ProviderApiError(
        `Gmail ${context}: response was not valid JSON`,
        response.status,
        { parseError: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async fetchMessagesByIds(
    ids: string[],
    options: { ignoreMissingHistoryMessages?: boolean } = {}
  ): Promise<NormalizedEmail[]> {
    const emails: NormalizedEmail[] = [];
    // Batch in groups of 50 with 200ms delay between batches
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const results = await Promise.all(
        batch.map(async (id) => {
          const res = await this.gmailFetch(`/messages/${id}?format=full`);
          if (
            options.ignoreMissingHistoryMessages &&
            (res.status === 404 || res.status === 410)
          ) {
            // Do not retry a history page forever for an object Gmail has
            // confirmed no longer exists. This is intentionally scoped to
            // the post-history materialization seam; search/backfill/thread
            // reads keep surfacing missing objects as typed provider errors.
            return null;
          }
          const message = await this.readGmailJson<Record<string, unknown>>(
            res,
            `messages.get (${id})`
          );
          if (message.id !== id) {
            throw new ProviderApiError(
              `Gmail messages.get (${id}): response did not contain the requested message`,
              res.status,
              message
            );
          }
          return message;
        })
      );
      emails.push(
        ...results
          .filter((msg): msg is Record<string, unknown> => msg !== null)
          .map((msg) => this.normalizeGmailMessage(msg))
      );
      if (i + 50 < ids.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return emails;
  }

  private normalizeGmailMessage(msg: Record<string, unknown>): NormalizedEmail {
    const payload = msg.payload as Record<string, unknown> | undefined;
    const headers = (payload?.headers || []) as Array<{
      name: string;
      value: string;
    }>;
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ||
      "";

    const { full, clean } = this.extractBodies(payload);

    return {
      id: msg.id as string,
      threadId: (msg.threadId as string) || "",
      from: getHeader("From"),
      fromName: this.extractName(getHeader("From")),
      to: this.parseAddressList(getHeader("To")),
      cc: this.parseAddressList(getHeader("Cc")),
      subject: getHeader("Subject"),
      snippet: (msg.snippet as string) || "",
      bodyText: full,
      bodyTextClean: clean || undefined,
      date: msg.internalDate
        ? new Date(parseInt(msg.internalDate as string))
        : new Date(),
      labelIds: (msg.labelIds as string[]) || [],
      isRead: !((msg.labelIds as string[]) || []).includes("UNREAD"),
      hasAttachments: this.hasAttachments(payload),
      sizeEstimate: (msg.sizeEstimate as number) || 0,
    };
  }

  private extractName(from: string): string {
    const match = from.match(/^"?([^"<]+)"?\s*</);
    return match ? match[1].trim() : from.split("@")[0];
  }

  private parseAddressList(header: string): string[] {
    if (!header) return [];
    return header
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
  }

  /**
   * Extract both the full plain-text body and a display-clean variant (with
   * quoted-chain HTML stripped before text conversion). Single walk over the
   * payload — callers get whichever they need.
   *
   * Strategy:
   *   - Decode text/html ONCE; derive `clean` by running stripQuotedHtml()
   *     before htmlToPlainText().
   *   - Decode text/plain; if no HTML variant was present, `clean` falls back
   *     to the plain text unchanged (display path then runs regex stripping).
   *   - If both text/plain AND text/html are present, prefer the plain text
   *     for `full` (Gmail's text/plain alternative is authoritative for AI /
   *     classification) but still derive `clean` from the HTML side because
   *     only the HTML side preserves quote markers.
   */
  private extractBodies(payload: Record<string, unknown> | undefined): {
    full: string;
    clean: string;
  } {
    if (!payload) return { full: "", clean: "" };

    const { plain, html } = this.collectBodyParts(payload);

    // `full` — widest context. Prefer plain when available.
    const full = plain || (html ? htmlToPlainText(html) : "");

    // `clean` — strip quote markers in HTML space before text conversion.
    // Only useful when we actually have HTML; for plain-only messages let
    // the regex layer in stripQuotedContent handle it (we leave `clean`
    // equal to `full` to signal "provider had no structural advantage here",
    // and the route still applies stripQuotedContent as layer 2).
    let clean = full;
    if (html) {
      const stripped = stripQuotedHtml(html);
      clean = htmlToPlainText(stripped);
    }

    return { full, clean };
  }

  /**
   * Walk a Gmail MIME tree, returning the first text/plain and text/html
   * bodies we find. Gmail nests multipart/alternative inside multipart/mixed
   * for messages with attachments, so a recursive walk is required.
   */
  private collectBodyParts(payload: Record<string, unknown>): {
    plain: string;
    html: string;
  } {
    const mimeType = (payload.mimeType as string) || "";
    const body = payload.body as { data?: string } | undefined;
    const parts = payload.parts as Array<Record<string, unknown>> | undefined;

    let plain = "";
    let html = "";

    const decode = (data?: string) =>
      data ? Buffer.from(data, "base64").toString("utf-8") : "";

    if (mimeType === "text/plain" && body?.data) {
      plain = decode(body.data);
    } else if (mimeType === "text/html" && body?.data) {
      html = decode(body.data);
    } else if (!parts && body?.data) {
      // Single-part, unknown mime — heuristically classify.
      const decoded = decode(body.data);
      if (decoded.trimStart().startsWith("<")) html = decoded;
      else plain = decoded;
    }

    if (parts) {
      for (const part of parts) {
        const nested = this.collectBodyParts(part);
        if (!plain && nested.plain) plain = nested.plain;
        if (!html && nested.html) html = nested.html;
        if (plain && html) break;
      }
    }

    return { plain, html };
  }

  private hasAttachments(
    payload: Record<string, unknown> | undefined
  ): boolean {
    if (!payload) return false;
    const mimeType = ((payload.mimeType as string) || "").toLowerCase();
    const filename = ((payload.filename as string) || "").trim();
    const partId = (payload.partId as string) || "";
    const body = payload.body as
      | { attachmentId?: string; data?: string }
      | undefined;
    const headers = (payload.headers ?? []) as Array<{
      name?: string;
      value?: string;
    }>;
    const hasAttachmentEvidence = Boolean(
      filename ||
      headers.some((item) => {
        const name = item.name?.toLowerCase();
        const value = item.value?.toLowerCase() ?? "";
        return (
          (name === "content-disposition" &&
            /\b(?:inline|attachment)\b/.test(value)) ||
          (name === "content-id" && Boolean(value))
        );
      })
    );
    const hasRetrievablePart = Boolean(
      body?.attachmentId || (body?.data && partId)
    );
    const isTextBody = mimeType === "text/plain" || mimeType === "text/html";
    if (hasRetrievablePart && (!isTextBody || hasAttachmentEvidence)) {
      return true;
    }
    return (
      (payload.parts as Array<Record<string, unknown>> | undefined) ?? []
    ).some((part) => this.hasAttachments(part));
  }

  private buildRawEmail(
    to: string,
    subject: string,
    body: string,
    contentType: "text" | "html" = "text"
  ): string {
    const mime = contentType === "html" ? "text/html" : "text/plain";
    const email = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: ${mime}; charset=utf-8`,
      "",
      body,
    ].join("\r\n");
    return Buffer.from(email).toString("base64url");
  }

  private buildRawEmailForSend(params: {
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    contentType: "text" | "html";
    inReplyTo?: string;
    references?: string;
  }): string {
    const mime = params.contentType === "html" ? "text/html" : "text/plain";
    const lines: string[] = [];
    lines.push(`To: ${params.to.join(", ")}`);
    if (params.cc.length > 0) {
      lines.push(`Cc: ${params.cc.join(", ")}`);
    }
    lines.push(`Subject: ${params.subject}`);
    if (params.inReplyTo) {
      lines.push(`In-Reply-To: ${params.inReplyTo}`);
    }
    if (params.references) {
      lines.push(`References: ${params.references}`);
    }
    lines.push("MIME-Version: 1.0");
    lines.push(`Content-Type: ${mime}; charset=utf-8`);
    lines.push("");
    lines.push(params.body);
    return Buffer.from(lines.join("\r\n")).toString("base64url");
  }
}
