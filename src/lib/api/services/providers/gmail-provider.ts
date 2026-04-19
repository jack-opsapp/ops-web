/**
 * OPS Web - Gmail Provider
 *
 * Implements EmailProviderInterface for Gmail using the Gmail REST API.
 * Wraps existing Gmail API logic from gmail-service.ts and gmail-token.ts
 * into the normalized provider interface.
 */

import type { EmailConnection } from "@/lib/types/email-connection";
import { requireSupabase } from "@/lib/supabase/helpers";
import { htmlToPlainText } from "@/lib/utils/email-parsing";
import {
  ProviderApiError,
  ProviderAuthError,
  ProviderScopeError,
  SyncTokenExpiredError,
  type EmailProviderInterface,
  type ImageAttachmentMeta,
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
    const res = await this.gmailFetch(`/threads/${threadId}?format=full`);
    const data = await res.json();
    const images: ImageAttachmentMeta[] = [];

    for (const msg of (data.messages || [])) {
      const msgId = msg.id as string;
      // Extract sender email from message headers
      const headers = ((msg.payload?.headers || []) as Array<{ name: string; value: string }>);
      const fromHeader = headers.find((h: { name: string }) => h.name.toLowerCase() === "from")?.value || "";
      const emailMatch = fromHeader.match(/<([^>]+)>/) || [null, fromHeader];
      const fromEmail = (emailMatch[1] || fromHeader).toLowerCase().trim();
      this.collectImageParts(msg.payload, msgId, fromEmail, images);
    }

    return images;
  }

  /** Recursively collect image attachment parts from a Gmail message payload */
  private collectImageParts(
    payload: Record<string, unknown> | undefined,
    messageId: string,
    fromEmail: string,
    out: ImageAttachmentMeta[]
  ): void {
    if (!payload) return;

    const mimeType = (payload.mimeType as string) || "";
    const filename = (payload.filename as string) || "";
    const body = payload.body as { attachmentId?: string; size?: number } | undefined;

    // Check if this part is an image attachment (not inline signature images which are tiny)
    if (
      GmailProvider.IMAGE_MIMES.has(mimeType.toLowerCase()) &&
      body?.attachmentId &&
      filename &&
      (body.size || 0) > 5000 // Skip tiny inline signature images (<5KB)
    ) {
      out.push({
        messageId,
        attachmentId: body.attachmentId,
        filename,
        mimeType: mimeType.toLowerCase(),
        size: body.size || 0,
        fromEmail,
      });
    }

    // Recurse into nested parts
    const parts = payload.parts as Array<Record<string, unknown>> | undefined;
    if (parts) {
      for (const part of parts) {
        this.collectImageParts(part, messageId, fromEmail, out);
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

    return {
      id: msg.id as string,
      threadId: (msg.threadId as string) || "",
      from: getHeader("From"),
      fromName: this.extractName(getHeader("From")),
      to: this.parseAddressList(getHeader("To")),
      cc: this.parseAddressList(getHeader("Cc")),
      subject: getHeader("Subject"),
      snippet: (msg.snippet as string) || "",
      bodyText: this.extractBody(payload),
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

  private extractBody(payload: Record<string, unknown> | undefined): string {
    if (!payload) return "";

    const mimeType = (payload.mimeType as string) || "";
    const parts = payload.parts as Array<Record<string, unknown>> | undefined;

    // Multipart: search parts for text/plain first, then text/html as fallback
    if (parts && parts.length > 0) {
      // Pass 1: look for text/plain at this level
      const textPart = parts.find((p) => p.mimeType === "text/plain");
      const textBody = textPart?.body as { data?: string } | undefined;
      if (textBody?.data) {
        return Buffer.from(textBody.data, "base64").toString("utf-8");
      }

      // Pass 2: recurse into nested multipart parts (e.g. multipart/alternative inside multipart/mixed)
      for (const part of parts) {
        const nested = this.extractBody(part);
        if (nested) return nested;
      }

      // Pass 3: fall back to text/html at this level, stripped to plain text
      const htmlPart = parts.find((p) => p.mimeType === "text/html");
      const htmlBody = htmlPart?.body as { data?: string } | undefined;
      if (htmlBody?.data) {
        const html = Buffer.from(htmlBody.data, "base64").toString("utf-8");
        return htmlToPlainText(html);
      }

      return "";
    }

    // Single-part message: check mimeType before decoding
    const body = payload.body as { data?: string } | undefined;
    if (body?.data) {
      const decoded = Buffer.from(body.data, "base64").toString("utf-8");
      if (mimeType === "text/html" || decoded.trimStart().startsWith("<")) {
        return htmlToPlainText(decoded);
      }
      return decoded;
    }

    return "";
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
