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
  ProviderApiError,
  ProviderAuthError,
  ProviderScopeError,
  SyncTokenExpiredError,
  type EmailAttachmentMeta,
  type EmailProviderInterface,
  type ImageAttachmentMeta,
  type NormalizedDraft,
  type NormalizedEmail,
  type SendEmailParams,
  type SendEmailResult,
  type SyncResult,
  type WebhookSubscription,
} from "../email-provider";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

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
  context: string
): never {
  const err = (body as { error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> } })?.error;
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
        "gmail.modify"
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
    const newExpiresAt = new Date(Date.now() + (json.expires_in as number) * 1000);

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

  private async gmailFetch(path: string, options?: RequestInit): Promise<Response> {
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

    const res = await this.gmailFetch(
      `/history?historyTypes=messageAdded&startHistoryId=${syncToken}&labelId=INBOX`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throwForGmailError(res.status, body, "history.list (inbox)");
    }
    const data = await res.json();

    const messageIds = new Set<string>();
    for (const record of data.history || []) {
      for (const msg of record.messagesAdded || []) {
        if (msg.message?.id) messageIds.add(msg.message.id);
      }
    }

    const emails = await this.fetchMessagesByIds([...messageIds]);

    return {
      emails,
      // If Gmail returned no historyId in the response (possible on a
      // no-op page), fall back to the token we sent. On a real error we'd
      // have thrown above so this is not the error-swallowing path.
      nextSyncToken: (data.historyId as string) || syncToken,
    };
  }

  async fetchSentEmailsSince(syncToken: string): Promise<SyncResult> {
    if (!syncToken) {
      throw new SyncTokenExpiredError(
        "Gmail history fetch called with empty syncToken",
        undefined
      );
    }

    const res = await this.gmailFetch(
      `/history?historyTypes=messageAdded&startHistoryId=${syncToken}&labelId=SENT`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throwForGmailError(res.status, body, "history.list (sent)");
    }
    const data = await res.json();

    const messageIds = new Set<string>();
    for (const record of data.history || []) {
      for (const msg of record.messagesAdded || []) {
        if (msg.message?.id) messageIds.add(msg.message.id);
      }
    }

    const emails = await this.fetchMessagesByIds([...messageIds]);

    return {
      emails,
      nextSyncToken: (data.historyId as string) || syncToken,
    };
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

    const res = await this.gmailFetch(
      `/messages?q=${encodeURIComponent(q)}&maxResults=${options?.maxResults || 100}`
    );
    const data = await res.json();

    const ids = (data.messages || []).map((m: { id: string }) => m.id);
    return this.fetchMessagesByIds(ids);
  }

  async fetchThread(threadId: string): Promise<NormalizedEmail[]> {
    const res = await this.gmailFetch(`/threads/${threadId}?format=full`);
    const data = await res.json();

    return (data.messages || []).map((msg: Record<string, unknown>) =>
      this.normalizeGmailMessage(msg)
    );
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

  async listLabels(): Promise<Array<{ id: string; name: string; type: string }>> {
    const res = await this.gmailFetch("/labels");
    const data = await res.json();
    return (data.labels || []).map((l: { id: string; name: string; type?: string }) => ({
      id: l.id,
      name: l.name,
      type: l.type || "user",
    }));
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
    threadId?: string
  ): Promise<string> {
    const raw = this.buildRawEmail(to, subject, body);
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

  async updateDraft(
    draftId: string,
    to: string,
    subject: string,
    body: string,
    threadId?: string
  ): Promise<void> {
    // Gmail's drafts.update takes the same payload shape as drafts.create and
    // replaces the underlying message wholesale. The HTTP verb is PUT (not
    // PATCH) per the v1 API contract — there is no partial-update path.
    const raw = this.buildRawEmail(to, subject, body);
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
      drafts?: Array<{ id: string; message?: { id: string; threadId?: string } }>;
    };
    const drafts = (listData.drafts ?? []).slice(0, DRAFT_LIMIT);
    if (drafts.length === 0) return [];

    // Single parallel burst — 15 concurrent GETs is well under Gmail's
    // per-user budget and avoids the synthetic 150ms inter-batch pause.
    const results = await Promise.all(
      drafts.map(async (d) => {
        const r = await this.gmailFetch(`/drafts/${d.id}?format=full`);
        return r.json();
      })
    );
    const out: NormalizedDraft[] = [];
    for (const full of results) {
      const normalized = this.normalizeGmailDraft(full);
      if (normalized) out.push(normalized);
    }
    return out;
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
    const headers = ((payload.headers || []) as Array<{ name: string; value: string }>);
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

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
    "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
    "image/gif", "image/bmp", "image/tiff",
  ]);

  /**
   * Scan a thread's messages for image attachments.
   * Returns metadata only — call fetchAttachment() to get the actual bytes.
   */
  async getImageAttachmentsFromThread(threadId: string): Promise<ImageAttachmentMeta[]> {
    const all = await this.getAttachmentsFromThread(threadId);
    return all
      .filter((a) => GmailProvider.IMAGE_MIMES.has(a.mimeType.toLowerCase()))
      .map(({ date: _date, ...rest }) => rest);
  }

  /**
   * Scan a thread's messages for ALL attachments (images + PDFs + everything
   * else). Inline image parts under 5KB are still suppressed — they are
   * almost always signature/decoration artifacts and would clutter the FILES
   * tab the same way they clutter the photo extractor.
   */
  async getAttachmentsFromThread(threadId: string): Promise<EmailAttachmentMeta[]> {
    const res = await this.gmailFetch(`/threads/${threadId}?format=full`);
    const data = await res.json();
    const out: EmailAttachmentMeta[] = [];

    for (const msg of (data.messages || [])) {
      const msgId = msg.id as string;
      const headers = ((msg.payload?.headers || []) as Array<{ name: string; value: string }>);
      const fromHeader = headers.find((h: { name: string }) => h.name.toLowerCase() === "from")?.value || "";
      const emailMatch = fromHeader.match(/<([^>]+)>/) || [null, fromHeader];
      const fromEmail = (emailMatch[1] || fromHeader).toLowerCase().trim();

      // Gmail returns internalDate as a string of ms-since-epoch on each
      // message. Use it directly — the per-message Date header is less
      // reliable (some senders ship it in the future / past).
      const internalDateMs = Number(msg.internalDate);
      const date = Number.isFinite(internalDateMs)
        ? new Date(internalDateMs)
        : new Date();

      this.collectAttachmentParts(msg.payload, msgId, fromEmail, date, out);
    }

    return out;
  }

  /**
   * Recursively walk a Gmail message payload and collect every part that
   * looks like a downloadable attachment. Inline images below 5KB are
   * dropped — see `getAttachmentsFromThread` for rationale.
   */
  private collectAttachmentParts(
    payload: Record<string, unknown> | undefined,
    messageId: string,
    fromEmail: string,
    date: Date,
    out: EmailAttachmentMeta[]
  ): void {
    if (!payload) return;

    const mimeType = ((payload.mimeType as string) || "").toLowerCase();
    const filename = (payload.filename as string) || "";
    const body = payload.body as { attachmentId?: string; size?: number } | undefined;

    if (body?.attachmentId && filename) {
      const size = body.size || 0;
      const isImage = GmailProvider.IMAGE_MIMES.has(mimeType);
      // Drop tiny inline images only — every other attachment (PDFs, CSVs,
      // Word docs, etc.) passes through regardless of size.
      const passesSignatureGuard = !isImage || size > 5000;
      if (passesSignatureGuard) {
        out.push({
          messageId,
          attachmentId: body.attachmentId,
          filename,
          mimeType,
          size,
          fromEmail,
          date,
        });
      }
    }

    const parts = payload.parts as Array<Record<string, unknown>> | undefined;
    if (parts) {
      for (const part of parts) {
        this.collectAttachmentParts(part, messageId, fromEmail, date, out);
      }
    }
  }

  /**
   * Download an attachment's raw bytes from Gmail.
   * Returns a Buffer with the file content.
   */
  async fetchAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const res = await this.gmailFetch(
      `/messages/${messageId}/attachments/${attachmentId}`
    );
    const data = await res.json();
    // Gmail returns base64url-encoded data
    const base64Data = (data.data as string) || "";
    return Buffer.from(base64Data, "base64url");
  }

  async getProfile(): Promise<{ email: string; name: string }> {
    const res = await this.gmailFetch("/profile");
    const data = await res.json();
    return {
      email: data.emailAddress,
      name: data.emailAddress, // Gmail profile doesn't always have display name
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async fetchMessagesByIds(ids: string[]): Promise<NormalizedEmail[]> {
    const emails: NormalizedEmail[] = [];
    // Batch in groups of 50 with 200ms delay between batches
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const results = await Promise.all(
        batch.map(async (id) => {
          const res = await this.gmailFetch(`/messages/${id}?format=full`);
          return res.json();
        })
      );
      emails.push(
        ...results.map((msg) => this.normalizeGmailMessage(msg))
      );
      if (i + 50 < ids.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return emails;
  }

  private normalizeGmailMessage(msg: Record<string, unknown>): NormalizedEmail {
    const payload = msg.payload as Record<string, unknown> | undefined;
    const headers = ((payload?.headers || []) as Array<{ name: string; value: string }>);
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

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
      date: msg.internalDate ? new Date(parseInt(msg.internalDate as string)) : new Date(),
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
  private extractBodies(
    payload: Record<string, unknown> | undefined
  ): { full: string; clean: string } {
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
  private collectBodyParts(
    payload: Record<string, unknown>
  ): { plain: string; html: string } {
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

  private hasAttachments(payload: Record<string, unknown> | undefined): boolean {
    const parts = payload?.parts as Array<{ filename?: string }> | undefined;
    if (!parts) return false;
    return parts.some((p) => p.filename && p.filename.length > 0);
  }

  private buildRawEmail(to: string, subject: string, body: string): string {
    const email = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
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
    const mime =
      params.contentType === "html" ? "text/html" : "text/plain";
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
