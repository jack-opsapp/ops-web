/**
 * OPS Web - Microsoft 365 Provider
 *
 * Implements EmailProviderInterface for Microsoft 365 using the Graph API.
 * Uses OAuth 2.0 with refresh tokens for authentication.
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

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = ["Mail.Read", "Mail.ReadWrite", "Mail.Send"];

/**
 * Inspect a Graph error response and throw a typed error so sync-engine can
 * decide whether to mark the connection needs_reconnect, re-seed the delta
 * link, or surface the error to the caller.
 *
 * Graph errors are shaped as { error: { code, message, innerError? } }. Codes
 * we care about:
 *   - InvalidAuthenticationToken / 401         → auth (token revoked)
 *   - Authorization_RequestDenied / 403        → scope (consent missing)
 *   - syncStateNotFound / syncStateInvalid     → delta link expired (re-seed)
 *   - 410 Gone on /delta                       → also re-seed
 */
function throwForGraphError(
  status: number,
  bodyText: string,
  context: string
): never {
  let parsed: { error?: { code?: string; message?: string } } | null = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // Non-JSON body — fall through with raw text in the message.
  }
  const code = parsed?.error?.code ?? "";
  const message =
    parsed?.error?.message ?? bodyText ?? `M365 ${context} failed (${status})`;

  if (status === 401 || code === "InvalidAuthenticationToken") {
    throw new ProviderAuthError(`M365 ${context}: ${message}`, status);
  }

  if (
    status === 403 &&
    (code === "Authorization_RequestDenied" ||
      code === "ErrorAccessDenied" ||
      /scope|permission|consent/i.test(message))
  ) {
    throw new ProviderScopeError(
      `M365 ${context}: ${message}`,
      status,
      SCOPES.join(" ")
    );
  }

  if (
    (status === 410 ||
      code === "syncStateNotFound" ||
      code === "syncStateInvalid") &&
    context.includes("delta")
  ) {
    throw new SyncTokenExpiredError(`M365 ${context}: ${message}`, status);
  }

  throw new ProviderApiError(`M365 ${context}: ${message}`, status, parsed ?? bodyText);
}

export class Microsoft365Provider implements EmailProviderInterface {
  readonly providerType = "microsoft365" as const;
  private connection: EmailConnection;

  constructor(connection: EmailConnection) {
    this.connection = connection;
  }

  private async getToken(): Promise<string> {
    if (new Date() >= this.connection.expiresAt) {
      return this.refreshAccessToken();
    }
    return this.connection.accessToken;
  }

  private async refreshAccessToken(): Promise<string> {
    const res = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          // Trim — a trailing newline in the Vercel-stored value breaks
          // the OAuth token request with an opaque 400. See
          // GOOGLE_PUBSUB_TOPIC incident 2026-04-18.
          client_id: process.env.MICROSOFT_CLIENT_ID!.trim(),
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!.trim(),
          refresh_token: this.connection.refreshToken,
          grant_type: "refresh_token",
          scope: SCOPES.join(" "),
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // invalid_grant → refresh token revoked or user consent revoked.
      if (res.status === 400 && /invalid_grant|AADSTS70/i.test(body)) {
        throw new ProviderAuthError(
          `M365 refresh token revoked: ${body}`,
          res.status
        );
      }
      if (res.status === 401) {
        throw new ProviderAuthError(
          `M365 token refresh unauthorized: ${body}`,
          res.status
        );
      }
      throw new ProviderApiError(
        `M365 token refresh failed (${res.status}): ${body}`,
        res.status,
        body
      );
    }

    const data = await res.json();
    if (!data.access_token) {
      throw new ProviderAuthError("M365 refresh returned no access_token");
    }

    const newAccessToken = data.access_token as string;
    const newExpiresAt = new Date(Date.now() + (data.expires_in as number) * 1000);

    // Update in-memory
    this.connection.accessToken = newAccessToken;
    this.connection.expiresAt = newExpiresAt;

    // Persist so the next request doesn't do a wasted refresh.
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
      console.error(
        `[m365-provider] Failed to persist refreshed token for ${this.connection.id}:`,
        err
      );
    }

    return newAccessToken;
  }

  private async graphFetch(
    path: string,
    options?: RequestInit,
    context?: string
  ): Promise<Record<string, unknown>> {
    const token = await this.getToken();
    const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });

    if (!res.ok) {
      // Throw typed errors so sync-engine can mark the connection
      // needs_reconnect on auth/scope failures and re-seed on
      // expired delta links. Defaults to ProviderApiError.
      const body = await res.text().catch(() => "");
      throwForGraphError(res.status, body, context ?? path);
    }
    return res.json();
  }

  async getInitialSyncToken(): Promise<string> {
    // M365's delta query is self-seeding: the first call with no deltaLink
    // fetches an initial page and returns a deltaLink in the response. We
    // return an empty string so fetchNewEmailsSince takes the "no deltaLink"
    // branch on its next call.
    return "";
  }

  /**
   * Walk a Graph delta query's pagination chain from `startUrl` until we
   * hit either a terminal `@odata.deltaLink` (end of the sync window) or
   * our safety cap. Returns all messages collected across pages plus the
   * final deltaLink to persist as the next sync token.
   *
   * Graph delta responses are paginated with `@odata.nextLink` (same-sync
   * continuation) and terminated with `@odata.deltaLink` (next-sync
   * pointer). Mutually exclusive: a given page has exactly one or the
   * other. The original implementation only read the first page and
   * treated the nextLink as "done, no deltaLink" — so:
   *   - initial syncs against a busy mailbox only imported the first ~10
   *     messages and immediately marked the connection as synced with
   *     whatever deltaLink it saw last (sometimes none, masking the loss)
   *   - the nextSyncToken could regress to `syncToken` when deltaLink
   *     wasn't present, getting stuck on that page forever
   *
   * Cap at 50 pages per invocation to avoid unbounded loops on an
   * active mailbox — ~500 messages at Graph's default page size, plenty
   * for a 15-minute cron window.
   */
  private async fetchDeltaPages(
    startUrl: string
  ): Promise<{ emails: NormalizedEmail[]; nextDeltaLink: string | null }> {
    const MAX_PAGES = 50;
    const emails: NormalizedEmail[] = [];
    let currentUrl: string | null = startUrl;
    let nextDeltaLink: string | null = null;

    for (let page = 0; page < MAX_PAGES && currentUrl; page++) {
      // Tag context as "delta" so throwForGraphError can map syncStateNotFound
      // / syncStateInvalid responses to SyncTokenExpiredError for re-seed.
      const data = await this.graphFetch(currentUrl, undefined, "delta");
      const value = (data.value as Array<Record<string, unknown>>) || [];
      for (const msg of value) {
        emails.push(this.normalizeM365Message(msg));
      }

      const delta = data["@odata.deltaLink"] as string | undefined;
      const next = data["@odata.nextLink"] as string | undefined;

      if (delta) {
        nextDeltaLink = delta;
        currentUrl = null;
      } else if (next) {
        currentUrl = next;
      } else {
        // Neither link present — end of page chain without a clear
        // terminator. Keep currentUrl null to break out.
        currentUrl = null;
      }
    }

    return { emails, nextDeltaLink };
  }

  async fetchNewEmailsSince(syncToken: string): Promise<SyncResult> {
    // M365 delta query — syncToken is the deltaLink from last sync. On
    // first sync (empty string) start from the folder's delta endpoint
    // with $select so body.contentType is normalized (see B16 notes).
    const startUrl = syncToken && syncToken.startsWith("http")
      ? syncToken
      : `/me/mailFolders/inbox/messages/delta?$select=id,conversationId,from,toRecipients,ccRecipients,subject,bodyPreview,body,receivedDateTime,categories,isRead,hasAttachments`;

    const { emails, nextDeltaLink } = await this.fetchDeltaPages(startUrl);

    return {
      emails,
      nextSyncToken: nextDeltaLink || syncToken,
    };
  }

  async fetchSentEmailsSince(syncToken: string): Promise<SyncResult> {
    const startUrl = syncToken && syncToken.startsWith("http")
      ? syncToken
      : `/me/mailFolders/sentitems/messages/delta?$select=id,conversationId,from,toRecipients,ccRecipients,subject,bodyPreview,body,receivedDateTime,categories,isRead,hasAttachments`;

    const { emails, nextDeltaLink } = await this.fetchDeltaPages(startUrl);

    return {
      emails,
      nextSyncToken: nextDeltaLink || syncToken,
    };
  }

  async searchEmails(
    query: string,
    options?: { maxResults?: number; after?: Date }
  ): Promise<NormalizedEmail[]> {
    // Escape single quotes for OData string literal safety
    const safeQuery = query.replace(/'/g, "''");
    let filter = `contains(subject, '${safeQuery}')`;
    if (options?.after) {
      filter += ` and receivedDateTime ge ${options.after.toISOString()}`;
    }
    const top = options?.maxResults || 100;

    const data = await this.graphFetch(
      `/me/messages?$filter=${encodeURIComponent(filter)}&$top=${top}&$orderby=receivedDateTime desc`
    );

    return ((data.value as Array<Record<string, unknown>>) || []).map((msg) =>
      this.normalizeM365Message(msg)
    );
  }

  async fetchThread(threadId: string): Promise<NormalizedEmail[]> {
    // M365 uses conversationId for threading
    const data = await this.graphFetch(
      `/me/messages?$filter=conversationId eq '${threadId}'&$orderby=receivedDateTime asc&$top=100`
    );

    return ((data.value as Array<Record<string, unknown>>) || []).map((msg) =>
      this.normalizeM365Message(msg)
    );
  }

  async listThreadIds(options: {
    pageSize?: number;
    after?: Date;
    pageToken?: string | null;
  }): Promise<{ threadIds: string[]; nextPageToken: string | null }> {
    // M365's messages endpoint clamps $top at 999. Select only what we need
    // to keep the page payload light — one hop to the inbox-level list, not
    // per-message bodies.
    const pageSize = Math.min(Math.max(options.pageSize ?? 500, 1), 999);

    // When we have a `pageToken` it's the full @odata.nextLink URL Graph
    // handed back last time. Use it verbatim so $skiptoken / ordering stay
    // intact. Otherwise we build the first page URL from scratch.
    let url: string;
    if (options.pageToken) {
      url = options.pageToken;
    } else {
      const params = new URLSearchParams({
        $select: "conversationId",
        $top: String(pageSize),
        $orderby: "receivedDateTime desc",
      });
      if (options.after) {
        params.set(
          "$filter",
          `receivedDateTime ge ${options.after.toISOString()}`
        );
      }
      url = `/me/messages?${params.toString()}`;
    }

    const data = (await this.graphFetch(url)) as {
      value?: Array<{ conversationId?: string }>;
      "@odata.nextLink"?: string;
    };

    // Dedupe within page — a conversation with N messages returns N entries
    // unless we projected to distinct conversations, which Graph's /messages
    // endpoint does not support natively.
    const seen = new Set<string>();
    const threadIds: string[] = [];
    for (const m of data.value ?? []) {
      if (!m.conversationId || seen.has(m.conversationId)) continue;
      seen.add(m.conversationId);
      threadIds.push(m.conversationId);
    }

    // Convert the full nextLink URL to a path Graph will accept from
    // graphFetch the next time round. graphFetch prepends the base, so strip
    // it here if it's absolute.
    let nextPageToken: string | null = data["@odata.nextLink"] ?? null;
    if (nextPageToken && nextPageToken.startsWith("https://graph.microsoft.com")) {
      nextPageToken = nextPageToken.replace(
        /^https:\/\/graph\.microsoft\.com\/v1\.0/,
        ""
      );
    }

    return { threadIds, nextPageToken };
  }

  async createLabel(name: string): Promise<string> {
    // M365 uses categories, not labels. Create a master category.
    const data = await this.graphFetch("/me/outlook/masterCategories", {
      method: "POST",
      body: JSON.stringify({
        displayName: name,
        color: "preset9", // blue
      }),
    });
    return data.id as string;
  }

  async applyLabel(threadId: string, labelId: string): Promise<void> {
    // Get all messages in thread and apply category to each
    const messages = await this.fetchThread(threadId);
    for (const msg of messages) {
      await this.graphFetch(`/me/messages/${msg.id}`, {
        method: "PATCH",
        body: JSON.stringify({ categories: [labelId] }),
      });
    }
  }

  async removeLabel(threadId: string, _labelId: string): Promise<void> {
    const messages = await this.fetchThread(threadId);
    for (const msg of messages) {
      await this.graphFetch(`/me/messages/${msg.id}`, {
        method: "PATCH",
        body: JSON.stringify({ categories: [] }),
      });
    }
  }

  // ─── Triage write-back ────────────────────────────────────────────────────
  //
  // M365: archive = move every message in the conversation to the wellknown
  // 'archive' folder. Unarchive = move back to 'inbox'. Snooze is identical to
  // archive at the provider level (OPS moves back to inbox when snooze
  // expires). Read state is `isRead` patched per message.

  async archiveThread(threadId: string): Promise<void> {
    const messages = await this.fetchThread(threadId);
    for (const msg of messages) {
      await this.graphFetch(`/me/messages/${msg.id}/move`, {
        method: "POST",
        body: JSON.stringify({ destinationId: "archive" }),
      });
    }
  }

  async unarchiveThread(threadId: string): Promise<void> {
    const messages = await this.fetchThread(threadId);
    for (const msg of messages) {
      await this.graphFetch(`/me/messages/${msg.id}/move`, {
        method: "POST",
        body: JSON.stringify({ destinationId: "inbox" }),
      });
    }
  }

  async snoozeThread(threadId: string): Promise<void> {
    // Same as archive at the provider level.
    await this.archiveThread(threadId);
  }

  async markThreadRead(threadId: string, isRead: boolean): Promise<void> {
    const messages = await this.fetchThread(threadId);
    for (const msg of messages) {
      await this.graphFetch(`/me/messages/${msg.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isRead }),
      });
    }
  }

  async listLabels(): Promise<
    Array<{ id: string; name: string; type: string }>
  > {
    const data = await this.graphFetch("/me/outlook/masterCategories");
    return (
      (data.value as Array<{ id: string; displayName: string }>) || []
    ).map((c) => ({
      id: c.id,
      name: c.displayName,
      type: "user",
    }));
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { to, cc, subject, body, contentType, inReplyTo } = params;

    // Graph API uses capitalized "Text" / "HTML"
    const graphContentType = contentType === "html" ? "HTML" : "Text";

    const toRecipients = to.map((addr) => ({
      emailAddress: { address: addr },
    }));
    const ccRecipients = (cc || []).map((addr) => ({
      emailAddress: { address: addr },
    }));

    if (inReplyTo) {
      // Reply flow: create reply draft (auto-threads) → update body/recipients → send
      const draftData = await this.graphFetch(
        `/me/messages/${inReplyTo}/createReply`,
        { method: "POST", body: JSON.stringify({}) }
      );

      const draftId = draftData.id as string;

      // Update draft with our content and recipients
      const updatePayload: Record<string, unknown> = {
        body: { contentType: graphContentType, content: body },
        toRecipients,
      };
      if (ccRecipients.length > 0) {
        updatePayload.ccRecipients = ccRecipients;
      }

      await this.graphFetch(`/me/messages/${draftId}`, {
        method: "PATCH",
        body: JSON.stringify(updatePayload),
      });

      // Send — returns 202 with no body, so fetch directly to avoid json parse
      await this.graphSend(draftId);

      return {
        messageId: draftId,
        threadId: (draftData.conversationId as string) || "",
      };
    }

    // New email flow: create draft (to capture messageId for sync dedup) → send
    const message: Record<string, unknown> = {
      subject,
      body: { contentType: graphContentType, content: body },
      toRecipients,
    };
    if (ccRecipients.length > 0) {
      message.ccRecipients = ccRecipients;
    }

    const draftData = await this.graphFetch("/me/messages", {
      method: "POST",
      body: JSON.stringify(message),
    });

    const draftId = draftData.id as string;
    await this.graphSend(draftId);

    return {
      messageId: draftId,
      threadId: (draftData.conversationId as string) || "",
    };
  }

  async createDraft(
    to: string,
    subject: string,
    body: string,
    threadId?: string
  ): Promise<string> {
    const message: Record<string, unknown> = {
      subject,
      body: { contentType: "text", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    if (threadId) message.conversationId = threadId;

    const data = await this.graphFetch("/me/messages", {
      method: "POST",
      body: JSON.stringify(message),
    });
    return data.id as string;
  }

  async setupWebhook(webhookUrl: string): Promise<WebhookSubscription> {
    const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days max
    const data = await this.graphFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "created,updated",
        notificationUrl: webhookUrl,
        resource: "me/messages",
        expirationDateTime: expiry.toISOString(),
        clientState: this.connection.id,
      }),
    });

    return {
      subscriptionId: data.id as string,
      expiresAt: new Date(data.expirationDateTime as string),
    };
  }

  async renewWebhook(subscriptionId: string): Promise<WebhookSubscription> {
    const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const data = await this.graphFetch(`/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({ expirationDateTime: expiry.toISOString() }),
    });

    return {
      subscriptionId: data.id as string,
      expiresAt: new Date(data.expirationDateTime as string),
    };
  }

  async validateWebhookRequest(
    _headers: Record<string, string>,
    body: string
  ): Promise<boolean> {
    // M365 sends clientState in the notification — verify it matches our connection ID
    try {
      const payload = JSON.parse(body);
      const notifications = payload.value || [];
      return notifications.every(
        (n: { clientState?: string }) =>
          n.clientState === this.connection.id
      );
    } catch {
      return false;
    }
  }

  async getImageAttachmentsFromThread(threadId: string): Promise<ImageAttachmentMeta[]> {
    // M365: fetch all messages in the conversation, then check each for image attachments
    const messages = await this.fetchThread(threadId);
    const images: ImageAttachmentMeta[] = [];

    for (const msg of messages) {
      if (!msg.hasAttachments) continue;

      // Fetch attachments for this message
      const data = await this.graphFetch(`/me/messages/${msg.id}/attachments`);
      const attachments = (data.value as Array<Record<string, unknown>>) || [];

      for (const att of attachments) {
        const contentType = ((att.contentType as string) || "").toLowerCase();
        const name = (att.name as string) || "";
        const size = (att.size as number) || 0;
        const attId = att.id as string;

        // Only image attachments above 5KB (skip inline signature images)
        if (
          contentType.startsWith("image/") &&
          attId &&
          name &&
          size > 5000
        ) {
          images.push({
            messageId: msg.id,
            attachmentId: attId,
            filename: name,
            mimeType: contentType,
            size,
            fromEmail: msg.from.toLowerCase(),
          });
        }
      }
    }

    return images;
  }

  async fetchAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const data = await this.graphFetch(
      `/me/messages/${messageId}/attachments/${attachmentId}`
    );
    // M365 returns base64-encoded content in contentBytes
    const base64Data = (data.contentBytes as string) || "";
    return Buffer.from(base64Data, "base64");
  }

  async getProfile(): Promise<{ email: string; name: string }> {
    const data = await this.graphFetch("/me");
    return {
      email:
        (data.mail as string) || (data.userPrincipalName as string),
      name:
        (data.displayName as string) ||
        (data.mail as string) ||
        "",
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Send a draft message. Graph API returns 202 with no body,
   * so we bypass graphFetch to avoid json parse errors. Errors are still
   * routed through the typed-error classifier so an auth failure during
   * send marks the connection needs_reconnect.
   */
  private async graphSend(messageId: string): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(
      `${GRAPH_BASE}/me/messages/${messageId}/send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throwForGraphError(res.status, body, "messages/send");
    }
  }

  /**
   * Convert an M365 message body to plain text. Graph returns bodies as
   * either `text` or `html` contentType — the old normalizer dropped the
   * html case to empty string, so every M365 inbox had zero body text
   * reaching Phase C memory extraction, AI classification, or matching.
   */
  private bodyToText(
    msgBody: { contentType?: string; content?: string } | undefined
  ): string {
    if (!msgBody?.content) return "";
    if (msgBody.contentType === "text") return msgBody.content;
    return htmlToPlainText(msgBody.content);
  }

  private normalizeM365Message(
    msg: Record<string, unknown>
  ): NormalizedEmail {
    const from = msg.from as {
      emailAddress?: { address?: string; name?: string };
    } | undefined;
    const toRecipients = (msg.toRecipients || []) as Array<{
      emailAddress?: { address?: string };
    }>;
    const ccRecipients = (msg.ccRecipients || []) as Array<{
      emailAddress?: { address?: string };
    }>;
    const msgBody = msg.body as {
      contentType?: string;
      content?: string;
    } | undefined;

    return {
      id: msg.id as string,
      threadId: msg.conversationId as string,
      from: from?.emailAddress?.address || "",
      fromName: from?.emailAddress?.name || "",
      to: toRecipients
        .map((r) => r.emailAddress?.address)
        .filter(Boolean) as string[],
      cc: ccRecipients
        .map((r) => r.emailAddress?.address)
        .filter(Boolean) as string[],
      subject: (msg.subject as string) || "",
      snippet: ((msg.bodyPreview as string) || "").slice(0, 200),
      bodyText: this.bodyToText(msgBody),
      date: new Date(msg.receivedDateTime as string),
      labelIds: (msg.categories as string[]) || [],
      isRead: (msg.isRead as boolean) || false,
      hasAttachments: (msg.hasAttachments as boolean) || false,
      sizeEstimate: 0,
    };
  }
}
