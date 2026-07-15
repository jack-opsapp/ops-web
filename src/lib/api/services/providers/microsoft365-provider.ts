/**
 * OPS Web - Microsoft 365 Provider
 *
 * Implements EmailProviderInterface for Microsoft 365 using the Graph API.
 * Uses OAuth 2.0 with refresh tokens for authentication.
 */

import type { EmailConnection } from "@/lib/types/email-connection";
import { requireSupabase } from "@/lib/supabase/helpers";
import { htmlToPlainText } from "@/lib/utils/email-parsing";
import { matchesMicrosoft365ClientState } from "@/lib/email/microsoft365-webhook-security";
import {
  ProviderApiError,
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

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = ["User.Read", "Mail.Read", "Mail.ReadWrite", "Mail.Send"];
const MICROSOFT365_CURSOR_V1_PREFIX = "m365:v1:";
const MICROSOFT365_CURSOR_PREFIX = "m365:v2:";

/**
 * Graph message delta is folder-scoped; there is no mailbox-wide message
 * delta endpoint. The lossless mailbox cursor therefore combines:
 *
 * 1. one mailFolder delta link, which discovers archive/custom folders and
 *    their lifecycle; and
 * 2. one message delta/continuation link for every live folder.
 *
 * `pendingFolderIds` is a durable snapshot of the current message-delta round.
 * A returned continuation is persisted only after its returned messages are
 * persisted by SyncEngine, so a timeout retries data rather than skipping it.
 */
interface Microsoft365DeltaCursor {
  folderDeltaLink: string;
  messageDeltaLinks: Record<string, string>;
  pendingFolderIds: string[];
}

function emptyDeltaCursor(): Microsoft365DeltaCursor {
  return {
    folderDeltaLink: "",
    messageDeltaLinks: {},
    pendingFolderIds: [],
  };
}

function encodeDeltaCursor(cursor: Microsoft365DeltaCursor): string {
  return `${MICROSOFT365_CURSOR_PREFIX}${JSON.stringify(cursor)}`;
}

function decodeDeltaCursor(syncToken: string): Microsoft365DeltaCursor {
  if (!syncToken) return emptyDeltaCursor();

  if (syncToken.startsWith(MICROSOFT365_CURSOR_PREFIX)) {
    try {
      const parsed = JSON.parse(
        syncToken.slice(MICROSOFT365_CURSOR_PREFIX.length)
      ) as Partial<Microsoft365DeltaCursor>;
      if (
        typeof parsed.folderDeltaLink !== "string" ||
        !parsed.messageDeltaLinks ||
        typeof parsed.messageDeltaLinks !== "object" ||
        Array.isArray(parsed.messageDeltaLinks) ||
        !Array.isArray(parsed.pendingFolderIds)
      ) {
        throw new Error("missing mailbox cursor fields");
      }

      const messageDeltaLinks = Object.fromEntries(
        Object.entries(parsed.messageDeltaLinks).map(([folderId, link]) => {
          if (!folderId || typeof link !== "string") {
            throw new Error("invalid folder message cursor");
          }
          return [folderId, link];
        })
      );
      const pendingFolderIds = parsed.pendingFolderIds.map((folderId) => {
        if (
          typeof folderId !== "string" ||
          !folderId ||
          !Object.prototype.hasOwnProperty.call(messageDeltaLinks, folderId)
        ) {
          throw new Error("invalid pending folder cursor");
        }
        return folderId;
      });
      if (new Set(pendingFolderIds).size !== pendingFolderIds.length) {
        throw new Error("duplicate pending folder cursor");
      }

      return {
        folderDeltaLink: parsed.folderDeltaLink,
        messageDeltaLinks,
        pendingFolderIds,
      };
    } catch (error) {
      throw new ProviderApiError(
        `M365 sync cursor is malformed: ${error instanceof Error ? error.message : "invalid JSON"}`,
        500,
        syncToken
      );
    }
  }

  if (
    syncToken.startsWith(MICROSOFT365_CURSOR_V1_PREFIX) ||
    syncToken.startsWith("http")
  ) {
    // Inbox/Sent-only cursors cannot prove that archive or custom-folder mail
    // was ever observed. Upgrade by replaying a complete folder inventory.
    // Immutable provider ids + database idempotency make that replay safe.
    return emptyDeltaCursor();
  }

  throw new ProviderApiError(
    "M365 sync cursor has an unsupported format",
    500,
    syncToken
  );
}

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

  throw new ProviderApiError(
    `M365 ${context}: ${message}`,
    status,
    parsed ?? bodyText
  );
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
    const newExpiresAt = new Date(
      Date.now() + (data.expires_in as number) * 1000
    );

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
        // Outlook's default REST ids change when a message moves folders.
        // Immutable ids keep activity/event dedupe stable across Inbox,
        // Archive, Sent, and webhook/delta reads. This must be sent on every
        // message request and subscription creation for a consistent identity.
        Prefer: 'IdType="ImmutableId"',
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
    return encodeDeltaCursor(emptyDeltaCursor());
  }

  /**
   * Microsoft Graph only supports message delta per folder. A fixed
   * Inbox/Sent pair is lossy: a server rule can deliver directly to a custom
   * folder, and a move out of Inbox is represented there only as `@removed`.
   *
   * The smallest lossless Graph strategy is therefore a folder delta followed
   * by one message delta per discovered folder. Both pagination layers share a
   * 50-page invocation budget. Their nextLinks are embedded in the returned
   * v2 cursor, and SyncEngine persists that cursor only after all returned
   * messages are durably projected. Large mailboxes resume exactly where the
   * last successful cycle stopped.
   *
   * Message and folder tombstones advance their owning delta streams but never
   * delete OPS correspondence. A move produces a source-folder tombstone plus
   * a destination-folder addition; immutable ids collapse that addition to the
   * same provider identity. Hard deletion means there is no body left to ingest.
   */
  private async fetchMailboxDeltaPages(
    sourceCursor: Microsoft365DeltaCursor
  ): Promise<{
    emails: NormalizedEmail[];
    cursor: Microsoft365DeltaCursor;
  }> {
    const MAX_PAGES = 50;
    const cursor: Microsoft365DeltaCursor = {
      folderDeltaLink: sourceCursor.folderDeltaLink,
      messageDeltaLinks: { ...sourceCursor.messageDeltaLinks },
      pendingFolderIds: [...sourceCursor.pendingFolderIds],
    };
    const emailsById = new Map<string, NormalizedEmail>();
    let pagesRead = 0;

    // A non-empty pending queue means the preceding folder inventory already
    // completed. Finish that exact message-delta round before asking for newer
    // folder changes, otherwise a busy folder tree could starve continuations.
    if (cursor.pendingFolderIds.length === 0) {
      let folderUrl =
        cursor.folderDeltaLink ||
        "/me/mailFolders/delta?$select=id,parentFolderId";
      let folderInventoryComplete = false;

      while (pagesRead < MAX_PAGES) {
        const requestedUrl = folderUrl;
        pagesRead += 1;
        const data = await this.graphFetch(
          requestedUrl,
          undefined,
          "mailFolders delta"
        );
        for (const folder of (data.value as Array<Record<string, unknown>>) ||
          []) {
          const folderId = folder.id;
          if (typeof folderId !== "string" || !folderId) {
            throw new ProviderApiError(
              "M365 mailFolders delta returned a folder without an id",
              500,
              folder
            );
          }
          if (folder["@removed"]) {
            delete cursor.messageDeltaLinks[folderId];
          } else if (
            !Object.prototype.hasOwnProperty.call(
              cursor.messageDeltaLinks,
              folderId
            )
          ) {
            cursor.messageDeltaLinks[folderId] = "";
          }
        }

        const delta = data["@odata.deltaLink"] as string | undefined;
        const next = data["@odata.nextLink"] as string | undefined;
        if (delta && next) {
          throw new ProviderApiError(
            "M365 mailFolders delta returned both deltaLink and nextLink",
            500,
            data
          );
        }
        if (delta) {
          cursor.folderDeltaLink = delta;
          folderInventoryComplete = true;
          break;
        }
        if (!next) {
          throw new ProviderApiError(
            "M365 mailFolders delta ended without a deltaLink or nextLink",
            500,
            data
          );
        }
        if (next === requestedUrl) {
          throw new ProviderApiError(
            "M365 mailFolders delta returned a non-advancing nextLink",
            500,
            { requestedUrl, next }
          );
        }
        cursor.folderDeltaLink = next;
        folderUrl = next;
      }

      if (!folderInventoryComplete) {
        return { emails: [], cursor };
      }

      cursor.pendingFolderIds = Object.keys(cursor.messageDeltaLinks).sort();
    }

    const messageSelect = [
      "id",
      "conversationId",
      "from",
      "toRecipients",
      "ccRecipients",
      "subject",
      "bodyPreview",
      "body",
      "receivedDateTime",
      "categories",
      "isDraft",
      "isRead",
      "hasAttachments",
    ].join(",");

    while (pagesRead < MAX_PAGES && cursor.pendingFolderIds.length > 0) {
      const folderId = cursor.pendingFolderIds[0];
      const requestedUrl =
        cursor.messageDeltaLinks[folderId] ||
        `/me/mailFolders/${encodeURIComponent(folderId)}/messages/delta?$select=${messageSelect}`;

      let data: Record<string, unknown>;
      pagesRead += 1;
      try {
        data = await this.graphFetch(
          requestedUrl,
          undefined,
          `messages delta (${folderId})`
        );
      } catch (error) {
        if (error instanceof ProviderApiError && error.providerStatus === 404) {
          // A folder can be deleted between inventory and its message walk,
          // but a generic 404 is not sufficient proof to forget its cursor.
          // Skip it for this round so other folders keep advancing, retain it
          // for retry, and let a positive mailFolders @removed tombstone be
          // the only event that permanently removes the stream.
          cursor.pendingFolderIds.shift();
          continue;
        }
        throw error;
      }

      for (const message of (data.value as Array<Record<string, unknown>>) ||
        []) {
        // Folder-wide discovery includes Drafts/Outbox. Unsent drafts are not
        // correspondence and must never create a lead; once sent, Graph emits
        // the resulting non-draft message through the destination folder.
        if (message["@removed"] || message.isDraft === true) continue;
        if (typeof message.id !== "string" || !message.id) {
          throw new ProviderApiError(
            `M365 messages delta (${folderId}) returned a message without an id`,
            500,
            message
          );
        }
        emailsById.set(message.id, this.normalizeM365Message(message));
      }

      const delta = data["@odata.deltaLink"] as string | undefined;
      const next = data["@odata.nextLink"] as string | undefined;
      if (delta && next) {
        throw new ProviderApiError(
          `M365 messages delta (${folderId}) returned both deltaLink and nextLink`,
          500,
          data
        );
      }
      if (delta) {
        cursor.messageDeltaLinks[folderId] = delta;
        cursor.pendingFolderIds.shift();
        continue;
      }
      if (!next) {
        throw new ProviderApiError(
          `M365 messages delta (${folderId}) ended without a deltaLink or nextLink`,
          500,
          data
        );
      }
      if (next === requestedUrl) {
        throw new ProviderApiError(
          `M365 messages delta (${folderId}) returned a non-advancing nextLink`,
          500,
          { requestedUrl, next }
        );
      }
      cursor.messageDeltaLinks[folderId] = next;
    }

    return { emails: [...emailsById.values()], cursor };
  }

  async fetchNewEmailsSince(syncToken: string): Promise<SyncResult> {
    const cursor = decodeDeltaCursor(syncToken);
    const result = await this.fetchMailboxDeltaPages(cursor);

    return {
      emails: result.emails,
      nextSyncToken: encodeDeltaCursor(result.cursor),
    };
  }

  async fetchSentEmailsSince(syncToken: string): Promise<SyncResult> {
    // fetchNewEmailsSince is mailbox-wide and already includes Sent plus any
    // outbound message moved elsewhere. Keep the provider interface's second
    // seam as a cursor-preserving no-op so SyncEngine does not walk or advance
    // the same folder streams twice.
    const cursor = decodeDeltaCursor(syncToken);
    return {
      emails: [],
      nextSyncToken: encodeDeltaCursor(cursor),
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
    // M365 uses conversationId for threading. $select includes uniqueBody,
    // Graph's server-stripped "new content only" variant — used to populate
    // NormalizedEmail.bodyTextClean for the thread-detail display path so we
    // never show quoted reply chains inline. `body` stays required for the
    // full-context fields that feed classification / Phase C memory.
    const selectFields = [
      "id",
      "conversationId",
      "from",
      "toRecipients",
      "ccRecipients",
      "subject",
      "bodyPreview",
      "body",
      "uniqueBody",
      "receivedDateTime",
      "categories",
      "isDraft",
      "isRead",
      "hasAttachments",
    ].join(",");
    const MAX_THREAD_PAGES = 50;
    const messages: NormalizedEmail[] = [];
    let nextUrl: string | null =
      `/me/messages?$filter=conversationId eq '${threadId}'` +
      `&$select=${selectFields}` +
      `&$orderby=receivedDateTime asc&$top=100`;

    for (let page = 0; page < MAX_THREAD_PAGES && nextUrl; page++) {
      const data = await this.graphFetch(nextUrl);
      for (const msg of (data.value as Array<Record<string, unknown>>) || []) {
        if (msg["@removed"] || msg.isDraft === true) continue;
        messages.push(this.normalizeM365Message(msg));
      }
      nextUrl = (data["@odata.nextLink"] as string | undefined) ?? null;
    }

    if (nextUrl) {
      throw new ProviderApiError(
        `M365 thread ${threadId} exceeded ${MAX_THREAD_PAGES * 100} messages; full analysis was not attempted`,
        500,
        { threadId, nextUrl }
      );
    }
    return messages;
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
    if (
      nextPageToken &&
      nextPageToken.startsWith("https://graph.microsoft.com")
    ) {
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
    threadId?: string,
    contentType: "text" | "html" = "text"
  ): Promise<string> {
    const message: Record<string, unknown> = {
      subject,
      body: {
        contentType: contentType === "html" ? "HTML" : "Text",
        content: body,
      },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    if (threadId) message.conversationId = threadId;

    const data = await this.graphFetch("/me/messages", {
      method: "POST",
      body: JSON.stringify(message),
    });
    return data.id as string;
  }

  async createNewThreadDraft(
    to: string,
    subject: string,
    body: string,
    contentType: "text" | "html" = "text"
  ): Promise<CreateNewThreadDraftResult> {
    // No conversationId → Graph mints a fresh conversation for the draft. The
    // created message resource carries that conversation id at conversationId.
    const message: Record<string, unknown> = {
      subject,
      body: {
        contentType: contentType === "html" ? "HTML" : "Text",
        content: body,
      },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    const data = await this.graphFetch("/me/messages", {
      method: "POST",
      body: JSON.stringify(message),
    });
    return {
      draftId: data.id as string,
      threadId: (data.conversationId as string) ?? null,
    };
  }

  async updateDraft(
    draftId: string,
    to: string,
    subject: string,
    body: string,
    _threadId?: string,
    contentType: "text" | "html" = "text"
  ): Promise<void> {
    // Graph drafts live as regular messages in the Drafts folder; PATCH on
    // the message id replaces the writable fields without disturbing
    // conversationId. We deliberately omit `_threadId` from the payload —
    // the conversation linkage was set on create and is read-only on update.
    void _threadId;
    await this.graphFetch(`/me/messages/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify({
        subject,
        body: {
          contentType: contentType === "html" ? "HTML" : "Text",
          content: body,
        },
        toRecipients: [{ emailAddress: { address: to } }],
      }),
    });
  }

  async listDrafts(): Promise<NormalizedDraft[]> {
    // The Drafts well-known folder surfaces exactly what the user sees in
    // Outlook's Drafts view. $select keeps the payload tight; $top=100 caps
    // the list (same as Gmail — we don't paginate drafts).
    const selectFields = [
      "id",
      "conversationId",
      "toRecipients",
      "ccRecipients",
      "subject",
      "body",
      "isDraft",
      "lastModifiedDateTime",
    ].join(",");
    const data = (await this.graphFetch(
      `/me/mailFolders/drafts/messages?$select=${selectFields}` +
        `&$orderby=lastModifiedDateTime desc&$top=100`
    )) as { value?: Array<Record<string, unknown>> };

    return (data.value ?? []).map((msg) => this.normalizeM365Draft(msg));
  }

  async getDraft(draftId: string): Promise<NormalizedDraft | null> {
    const selectFields = [
      "id",
      "conversationId",
      "toRecipients",
      "ccRecipients",
      "subject",
      "body",
      "isDraft",
      "lastModifiedDateTime",
    ].join(",");
    const token = await this.getToken();
    const encodedId = encodeURIComponent(draftId);
    const res = await fetch(
      `${GRAPH_BASE}/me/messages/${encodedId}?$select=${selectFields}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'IdType="ImmutableId"',
        },
      }
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throwForGraphError(res.status, body, "messages/get (draft)");
    }
    const message = (await res.json()) as Record<string, unknown>;
    if (message.isDraft !== true) return null;
    return this.normalizeM365Draft(message);
  }

  async deleteDraft(draftId: string): Promise<void> {
    // Graph returns 204 on success; 404 if the draft is already gone.
    // Both are "draft is no longer there" — move on. Other errors still
    // bubble up through throwForGraphError. We bypass graphFetch here
    // because it calls res.json() on the response, which would throw on
    // the empty 204 body (same pattern as graphSend below).
    const token = await this.getToken();
    const res = await fetch(`${GRAPH_BASE}/me/messages/${draftId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'IdType="ImmutableId"',
      },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      throwForGraphError(res.status, body, "messages/delete (draft)");
    }
  }

  /**
   * Normalize a Graph draft message payload into our wire shape. Drafts on
   * M365 don't distinguish reply-drafts from new-compose drafts at the
   * folder level — the conversationId field is always present. We treat a
   * conversationId with only one message (this draft) as a standalone and
   * set threadId to null so the pill-rendering logic doesn't mis-attach.
   */
  private normalizeM365Draft(msg: Record<string, unknown>): NormalizedDraft {
    const toRecipients = (msg.toRecipients || []) as Array<{
      emailAddress?: { address?: string };
    }>;
    const ccRecipients = (msg.ccRecipients || []) as Array<{
      emailAddress?: { address?: string };
    }>;
    const msgBody = msg.body as
      | { contentType?: string; content?: string }
      | undefined;

    return {
      id: msg.id as string,
      threadId: (msg.conversationId as string) || null,
      to: toRecipients
        .map((r) => r.emailAddress?.address)
        .filter(Boolean) as string[],
      cc: ccRecipients
        .map((r) => r.emailAddress?.address)
        .filter(Boolean) as string[],
      subject: (msg.subject as string) || "",
      bodyText: this.bodyToText(msgBody),
      updatedAt: new Date(
        (msg.lastModifiedDateTime as string) ||
          (msg.createdDateTime as string) ||
          Date.now()
      ),
    };
  }

  async setupWebhook(webhookUrl: string): Promise<WebhookSubscription> {
    const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days max
    const clientState = crypto.randomUUID();
    const data = await this.graphFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "created,updated",
        notificationUrl: webhookUrl,
        resource: "me/messages",
        expirationDateTime: expiry.toISOString(),
        clientState,
      }),
    });

    return {
      subscriptionId: data.id as string,
      expiresAt: new Date(data.expirationDateTime as string),
      clientState,
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
    // Bind both the random clientState secret and Graph subscription id to
    // this connection. The webhook route performs the same check against the
    // database before any service-role dispatch.
    try {
      const payload = JSON.parse(body);
      const notifications = payload.value || [];
      if (!Array.isArray(notifications) || notifications.length === 0) {
        return false;
      }
      for (const n of notifications as Array<{
        clientState?: string;
        subscriptionId?: string;
      }>) {
        if (
          typeof n.clientState !== "string" ||
          n.subscriptionId !== this.connection.webhookSubscriptionId ||
          !(await matchesMicrosoft365ClientState(
            n.clientState,
            this.connection.webhookClientStateHash
          ))
        ) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async getImageAttachmentsFromThread(
    threadId: string
  ): Promise<ImageAttachmentMeta[]> {
    const all = await this.getAttachmentsFromThread(threadId);
    return all
      .filter((a) => a.mimeType.startsWith("image/"))
      .map(({ date: _date, ...rest }) => rest);
  }

  async getAttachmentsFromThread(
    threadId: string
  ): Promise<EmailAttachmentMeta[]> {
    // Fetch the full thread once so we have both the message date and a
    // way to skip messages that the provider already flagged as
    // attachment-free (avoids a per-message attachment fetch on threads
    // dominated by short replies).
    const messages = await this.fetchThread(threadId);
    const out: EmailAttachmentMeta[] = [];

    for (const msg of messages) {
      if (!msg.hasAttachments) continue;

      const data = await this.graphFetch(`/me/messages/${msg.id}/attachments`);
      const attachments = (data.value as Array<Record<string, unknown>>) || [];

      for (const att of attachments) {
        const contentType = ((att.contentType as string) || "").toLowerCase();
        const name = (att.name as string) || "";
        const size = (att.size as number) || 0;
        const attId = att.id as string;

        if (!attId || !name) continue;

        // Mirror the Gmail walker's signature-image guard: drop image parts
        // <= 5KB (these are nearly always inline signature/decorations), let
        // every other MIME type through regardless of size.
        const isImage = contentType.startsWith("image/");
        const passesSignatureGuard = !isImage || size > 5000;
        if (!passesSignatureGuard) continue;

        out.push({
          messageId: msg.id,
          attachmentId: attId,
          filename: name,
          mimeType: contentType,
          size,
          fromEmail: msg.from.toLowerCase(),
          date: msg.date,
        });
      }
    }

    return out;
  }

  async fetchAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<Buffer> {
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
      email: (data.mail as string) || (data.userPrincipalName as string),
      name: (data.displayName as string) || (data.mail as string) || "",
    };
  }

  async getEmailSignature(): Promise<ProviderEmailSignatureResult> {
    // Microsoft Graph does not expose the user's Outlook/Office signature.
    // Keep this deliberately local: no speculative mailbox request and no
    // mutation. The settings flow can store an explicitly confirmed copy.
    return {
      status: "unsupported",
      source: "microsoft_confirmed",
      providerIdentity: this.connection.email.trim() || null,
      contentHtml: null,
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
    const res = await fetch(`${GRAPH_BASE}/me/messages/${messageId}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'IdType="ImmutableId"',
      },
    });
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

  private normalizeM365Message(msg: Record<string, unknown>): NormalizedEmail {
    const from = msg.from as
      | {
          emailAddress?: { address?: string; name?: string };
        }
      | undefined;
    const toRecipients = (msg.toRecipients || []) as Array<{
      emailAddress?: { address?: string };
    }>;
    const ccRecipients = (msg.ccRecipients || []) as Array<{
      emailAddress?: { address?: string };
    }>;
    const msgBody = msg.body as
      | {
          contentType?: string;
          content?: string;
        }
      | undefined;
    // uniqueBody is Graph's server-stripped variant (new content only, no
    // quoted chain). Only present when we $select it on the thread endpoint —
    // delta / list paths still populate `body` alone and this stays undefined.
    const msgUniqueBody = msg.uniqueBody as
      | {
          contentType?: string;
          content?: string;
        }
      | undefined;

    const fullText = this.bodyToText(msgBody);
    const cleanText = msgUniqueBody?.content
      ? this.bodyToText(msgUniqueBody)
      : "";

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
      bodyText: fullText,
      bodyTextClean: cleanText || undefined,
      date: new Date(msg.receivedDateTime as string),
      labelIds: (msg.categories as string[]) || [],
      isRead: (msg.isRead as boolean) || false,
      hasAttachments: (msg.hasAttachments as boolean) || false,
      sizeEstimate: 0,
    };
  }
}
