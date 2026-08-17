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
import { gmailAuthenticatedFromDomains } from "@/lib/email/provider-authentication";
import { PROVIDER_DELIVERY_SELECTION_REVISIONS } from "../provider-delivery-source-types";
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
  type ProviderReadPolicy,
  type SendEmailParams,
  type SendEmailResult,
  type SyncResult,
  type ThreadDraftProbe,
  type WebhookSubscription,
} from "../email-provider";
import { readBoundedResponseBytes } from "./bounded-response";
import {
  fetchGmailRead,
  fetchGmailOnceWithinDeadline,
  isGmailReadDeadlineError,
  mapGmailReads,
  type GmailReadPolicy,
} from "./gmail-read";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const NON_DELIVERY_MESSAGE_LABELS = new Set(["DRAFT", "SPAM", "TRASH"]);

function normalizeInlineContentId(value: string): string {
  const trimmed = value.trim().replace(/^<|>$/g, "");
  try {
    return decodeURIComponent(trimmed).toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function contentIdsReferencedByHtml(html: string): Set<string> {
  const references = new Set<string>();
  const decodedAngles = html.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
  const cidPattern = /\bcid\s*:\s*<?([^"'<>\s)]+)>?/gi;

  for (const match of decodedAngles.matchAll(cidPattern)) {
    const contentId = normalizeInlineContentId(match[1] ?? "");
    if (contentId) references.add(contentId);
  }

  return references;
}
/**
 * Page size for the metadata-only drafts index used by `findDraftsOnThread`.
 * `listDrafts()` caps at 15 because it fetches every draft in full; this index
 * reads ids only, so it can afford Gmail's maximum page.
 */
const DRAFT_INDEX_PAGE_SIZE = 500;
const MAX_GMAIL_MESSAGE_JSON_BYTES = 80 * 1024 * 1024;
const GMAIL_ATTACHMENT_JSON_OVERHEAD_BYTES = 64 * 1024;
const MAX_GMAIL_ATTACHMENTS_PER_MESSAGE = 500;
const MAX_GMAIL_ATTACHMENT_REQUEST_MS = 30_000;
const GMAIL_PROVIDER_READ_DEADLINE_MS = 45_000;
const GMAIL_INCREMENTAL_HISTORY_MAX_PAGES = 10;
const GMAIL_INCREMENTAL_HISTORY_MAX_MESSAGES = 25;
const GMAIL_INCREMENTAL_HISTORY_PAGE_SIZE = 100;
const GMAIL_INCREMENTAL_CURSOR_MAX_PENDING_MESSAGES = 2_000;
const GMAIL_INCREMENTAL_CURSOR_MAX_BYTES = 128 * 1024;
const GMAIL_INCREMENTAL_CURSOR_V1_PREFIX = "gmail:v1:";

interface GmailIncrementalCursor {
  startHistoryId: string;
  pageToken: string | null;
  finalHistoryId: string;
  pendingMessageIds: string[];
  historyComplete: boolean;
}

function malformedGmailIncrementalCursor(
  syncToken: string,
  reason: string
): ProviderApiError {
  return new ProviderApiError(
    `Gmail sync cursor is malformed: ${reason}`,
    500,
    syncToken
  );
}

function normalizedCursorString(
  value: unknown,
  field: string,
  syncToken: string
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw malformedGmailIncrementalCursor(syncToken, `${field} is required`);
  }
  if (value !== value.trim()) {
    throw malformedGmailIncrementalCursor(
      syncToken,
      `${field} must not contain surrounding whitespace`
    );
  }
  return value;
}

function decodeGmailIncrementalCursor(
  syncToken: string
): GmailIncrementalCursor {
  if (!syncToken.startsWith(GMAIL_INCREMENTAL_CURSOR_V1_PREFIX)) {
    const historyId = normalizedCursorString(
      syncToken,
      "startHistoryId",
      syncToken
    );
    return {
      startHistoryId: historyId,
      pageToken: null,
      finalHistoryId: historyId,
      pendingMessageIds: [],
      historyComplete: false,
    };
  }

  try {
    const parsed = JSON.parse(
      syncToken.slice(GMAIL_INCREMENTAL_CURSOR_V1_PREFIX.length)
    ) as {
      startHistoryId?: unknown;
      pageToken?: unknown;
      finalHistoryId?: unknown;
      pendingMessageIds?: unknown;
    };
    const startHistoryId = normalizedCursorString(
      parsed.startHistoryId,
      "startHistoryId",
      syncToken
    );
    const finalHistoryId = normalizedCursorString(
      parsed.finalHistoryId,
      "finalHistoryId",
      syncToken
    );
    if (
      parsed.pageToken !== null &&
      (typeof parsed.pageToken !== "string" || !parsed.pageToken.trim())
    ) {
      throw malformedGmailIncrementalCursor(
        syncToken,
        "pageToken must be a non-empty string or null"
      );
    }
    const pageToken =
      parsed.pageToken === null
        ? null
        : normalizedCursorString(parsed.pageToken, "pageToken", syncToken);
    if (!Array.isArray(parsed.pendingMessageIds)) {
      throw malformedGmailIncrementalCursor(
        syncToken,
        "pendingMessageIds must be an array"
      );
    }
    if (
      parsed.pendingMessageIds.length >
      GMAIL_INCREMENTAL_CURSOR_MAX_PENDING_MESSAGES
    ) {
      throw malformedGmailIncrementalCursor(
        syncToken,
        `pendingMessageIds exceeds ${GMAIL_INCREMENTAL_CURSOR_MAX_PENDING_MESSAGES}`
      );
    }
    const pendingMessageIds = parsed.pendingMessageIds.map((value, index) =>
      normalizedCursorString(value, `pendingMessageIds[${index}]`, syncToken)
    );
    if (new Set(pendingMessageIds).size !== pendingMessageIds.length) {
      throw malformedGmailIncrementalCursor(
        syncToken,
        "pendingMessageIds contains duplicates"
      );
    }

    return {
      startHistoryId,
      pageToken,
      finalHistoryId,
      pendingMessageIds,
      // A structured cursor exists only after at least one history page has
      // been read. A null continuation therefore means the terminal page was
      // reached and only its bounded message remainder is pending.
      historyComplete: pageToken === null,
    };
  } catch (error) {
    if (error instanceof ProviderApiError) throw error;
    throw malformedGmailIncrementalCursor(
      syncToken,
      error instanceof Error ? error.message : "invalid JSON"
    );
  }
}

function encodeGmailIncrementalCursor(
  cursor: Omit<GmailIncrementalCursor, "historyComplete">
): string {
  if (cursor.pendingMessageIds.length === 0 && cursor.pageToken === null) {
    return cursor.finalHistoryId;
  }
  if (
    cursor.pendingMessageIds.length >
    GMAIL_INCREMENTAL_CURSOR_MAX_PENDING_MESSAGES
  ) {
    throw new ProviderApiError(
      `Gmail incremental continuation exceeds ${GMAIL_INCREMENTAL_CURSOR_MAX_PENDING_MESSAGES} pending messages`,
      500,
      {
        startHistoryId: cursor.startHistoryId,
        finalHistoryId: cursor.finalHistoryId,
        pendingMessageCount: cursor.pendingMessageIds.length,
      }
    );
  }

  const encoded = `${GMAIL_INCREMENTAL_CURSOR_V1_PREFIX}${JSON.stringify({
    startHistoryId: cursor.startHistoryId,
    pageToken: cursor.pageToken,
    finalHistoryId: cursor.finalHistoryId,
    pendingMessageIds: cursor.pendingMessageIds,
  })}`;
  if (
    new TextEncoder().encode(encoded).byteLength >
    GMAIL_INCREMENTAL_CURSOR_MAX_BYTES
  ) {
    throw new ProviderApiError(
      `Gmail incremental continuation exceeds ${GMAIL_INCREMENTAL_CURSOR_MAX_BYTES} bytes`,
      500,
      {
        startHistoryId: cursor.startHistoryId,
        finalHistoryId: cursor.finalHistoryId,
        pendingMessageCount: cursor.pendingMessageIds.length,
      }
    );
  }
  return encoded;
}

function attachmentRequestSignal(): AbortSignal {
  return AbortSignal.timeout(MAX_GMAIL_ATTACHMENT_REQUEST_MS);
}

interface GmailAttachmentCollectionBudget {
  truncated: boolean;
}

interface GmailTextBodyPart {
  mediaType: "text/plain" | "text/html";
  partId: string | null;
  attachmentId: string | null;
  inlineData: string | null;
  contentCharset: string;
}

function canonicalGmailBodyCharset(
  headers: Array<{ name?: string; value?: string }>
): string {
  const contentType = headers.find(
    (header) => header.name?.toLowerCase() === "content-type"
  )?.value;
  const charsetMatch = contentType?.match(
    /;\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i
  );
  if (!charsetMatch) return "us-ascii";
  const label = (
    charsetMatch?.[1] ??
    charsetMatch?.[2] ??
    charsetMatch?.[3] ??
    ""
  )
    .trim()
    .toLowerCase();
  if (label === "ascii" || label === "us-ascii") return "us-ascii";
  try {
    return new TextDecoder(label, { fatal: true }).encoding;
  } catch (error) {
    throw new ProviderApiError(
      `Gmail text MIME part declared unsupported charset ${label}`,
      502,
      {
        charset: label,
        cause: error instanceof Error ? error.message : String(error),
      }
    );
  }
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

  private effectiveReadPolicy(
    readPolicy: GmailReadPolicy,
    fallbackContext: string
  ): GmailReadPolicy {
    return {
      ...readPolicy,
      deadlineAt:
        readPolicy.deadlineAt ?? Date.now() + GMAIL_PROVIDER_READ_DEADLINE_MS,
      context: readPolicy.context ?? fallbackContext,
    };
  }

  private assertReadDeadline(readPolicy: GmailReadPolicy): void {
    if (
      readPolicy.deadlineAt !== undefined &&
      Date.now() >= readPolicy.deadlineAt
    ) {
      throw new ProviderApiError(
        `Gmail ${readPolicy.context ?? "read"}: read deadline exceeded`,
        504,
        {
          reason: "gmail_read_deadline_exceeded",
          deadlineAt: readPolicy.deadlineAt,
        }
      );
    }
  }

  /**
   * Return a valid access token for a provider read under one absolute
   * deadline. This narrow public seam lets lock-handoff workers rehydrate a
   * connection without trusting the raw access token from an older snapshot.
   */
  async getValidAccessToken(
    readPolicy: ProviderReadPolicy = {}
  ): Promise<string> {
    const effectiveReadPolicy = this.effectiveReadPolicy(
      readPolicy,
      "OAuth token validation"
    );
    this.assertReadDeadline(effectiveReadPolicy);

    const requiresRefresh =
      new Date() >= new Date(this.connection.expiresAt.getTime() - 60_000);
    if (
      requiresRefresh &&
      effectiveReadPolicy.oauthTokenMode === "current_only_no_persist"
    ) {
      throw new ProviderApiError(
        `Gmail ${effectiveReadPolicy.context ?? "read"}: current OAuth token is not valid for a credential-static read`,
        409,
        {
          reason: "gmail_oauth_refresh_forbidden",
          expiresAt: this.connection.expiresAt.toISOString(),
        }
      );
    }

    const token = requiresRefresh
      ? await this.refreshAccessToken(effectiveReadPolicy)
      : this.connection.accessToken;

    this.assertReadDeadline(effectiveReadPolicy);
    return token;
  }

  private async refreshAccessToken(
    readPolicy?: GmailReadPolicy
  ): Promise<string> {
    const tokenRequest: RequestInit = {
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
    };
    const response = readPolicy
      ? await fetchGmailOnceWithinDeadline(
          "https://oauth2.googleapis.com/token",
          tokenRequest,
          {
            ...readPolicy,
            context: `${readPolicy.context ?? "Gmail read"} token refresh`,
          }
        )
      : await fetch("https://oauth2.googleapis.com/token", tokenRequest);

    const responseBody = readPolicy
      ? await response.text()
      : await response.text().catch(() => "");

    if (!response.ok) {
      // invalid_grant → refresh token revoked or expired → user must reconnect.
      if (response.status === 400 && /invalid_grant/i.test(responseBody)) {
        throw new ProviderAuthError(
          `Gmail refresh token revoked: ${responseBody}`,
          response.status
        );
      }
      if (response.status === 401) {
        throw new ProviderAuthError(
          `Gmail token refresh unauthorized: ${responseBody}`,
          response.status
        );
      }
      throw new ProviderApiError(
        `Gmail token refresh failed (${response.status}): ${responseBody}`,
        response.status,
        responseBody
      );
    }

    let json: { access_token?: unknown; expires_in?: unknown };
    try {
      json = JSON.parse(responseBody) as {
        access_token?: unknown;
        expires_in?: unknown;
      };
    } catch {
      throw new ProviderAuthError(
        "Failed to parse Gmail access token response"
      );
    }
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

    if (readPolicy) this.assertReadDeadline(readPolicy);

    return newAccessToken;
  }

  private async gmailFetch(
    path: string,
    options?: RequestInit,
    readPolicy: GmailReadPolicy = {}
  ): Promise<Response> {
    const method = (options?.method ?? "GET").toUpperCase();

    if (method === "GET") {
      const { method: _method, body: _body, ...readOptions } = options ?? {};
      const effectiveReadPolicy = this.effectiveReadPolicy(
        readPolicy,
        `GET ${path}`
      );
      const token = await this.getValidAccessToken(effectiveReadPolicy);
      return fetchGmailRead(
        `${GMAIL_API}${path}`,
        {
          ...readOptions,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(options?.headers || {}),
          },
        },
        effectiveReadPolicy
      );
    }

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
    const data = await this.readGmailJson<{ historyId?: string }>(
      res,
      "profile (bootstrap historyId)"
    );
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
    options?: {
      maxResults?: number;
      after?: Date;
      readPolicy?: ProviderReadPolicy;
    }
  ): Promise<NormalizedEmail[]> {
    const readPolicy = this.effectiveReadPolicy(
      options?.readPolicy ?? {},
      "mailbox search"
    );
    const deadlineAt = readPolicy.deadlineAt!;
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

      const res = await this.gmailFetch(
        `/messages?${params.toString()}`,
        undefined,
        { ...readPolicy, context: "messages.list (search)" }
      );
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

    return this.fetchMessagesByIds([...ids], { deadlineAt });
  }

  async fetchThread(
    threadId: string,
    readPolicy: ProviderReadPolicy = {}
  ): Promise<NormalizedEmail[]> {
    const effectiveReadPolicy = this.effectiveReadPolicy(
      readPolicy,
      `threads.get (${threadId})`
    );
    const res = await this.gmailFetch(
      `/threads/${threadId}?format=full`,
      undefined,
      effectiveReadPolicy
    );
    const data = await this.readGmailJson<{
      messages?: Array<Record<string, unknown>>;
    }>(res, `threads.get (${threadId})`);

    const deliveredMessages = (data.messages || []).filter(
      (msg) =>
        !((msg.labelIds as string[] | undefined) ?? []).some((label) =>
          NON_DELIVERY_MESSAGE_LABELS.has(label.toUpperCase())
        )
    );
    return mapGmailReads(
      deliveredMessages,
      (message, _index, messageReadPolicy) =>
        this.normalizeGmailMessage(message, messageReadPolicy),
      {
        deadlineAt: effectiveReadPolicy.deadlineAt,
        context: effectiveReadPolicy.context,
      }
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
    const data = await this.readGmailJson<{
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
    }>(res, "messages.list (backfill)");

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
    const res = await this.gmailFetch("/labels", undefined, {
      context: "labels.list",
    });
    const data = await this.readGmailJson<{
      labels?: Array<{ id: string; name: string; type?: string }>;
    }>(res, "labels.list");
    if (!Array.isArray(data.labels)) {
      throw new ProviderApiError(
        "Gmail labels.list: response did not contain labels",
        res.status,
        data
      );
    }
    return data.labels.map(
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
      const replyMetadataContext = `messages.get reply metadata (${inReplyTo})`;
      const res = await this.gmailFetch(
        `/messages/${inReplyTo}?format=metadata&metadataHeaders=Message-Id`,
        undefined,
        { context: replyMetadataContext }
      );
      const data = await this.readGmailJson<{
        payload?: {
          headers?: Array<{ name: string; value: string }>;
        };
      }>(res, replyMetadataContext);
      const hdrs = (data.payload?.headers || []) as Array<{
        name: string;
        value: string;
      }>;
      const msgIdHeader = hdrs.find(
        (h) => h.name.toLowerCase() === "message-id"
      )?.value;
      if (!msgIdHeader) {
        throw new ProviderApiError(
          `Gmail ${replyMetadataContext}: response did not contain Message-ID`,
          res.status,
          data
        );
      }
      inReplyToHeader = msgIdHeader;
      referencesHeader = msgIdHeader;
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
    const deadlineAt = Date.now() + GMAIL_PROVIDER_READ_DEADLINE_MS;
    const listRes = await this.gmailFetch(
      `/drafts?maxResults=${DRAFT_LIMIT}`,
      undefined,
      { deadlineAt, context: "drafts.list" }
    );
    const listData = await this.readGmailJson<{
      drafts?: Array<{
        id: string;
        message?: { id: string; threadId?: string };
      }>;
    }>(listRes, "drafts.list");
    const drafts = (listData.drafts ?? []).slice(0, DRAFT_LIMIT);
    if (drafts.length === 0) return [];

    const results = await mapGmailReads(
      drafts,
      (draft, _index, readPolicy) => this.getDraft(draft.id, readPolicy),
      {
        deadlineAt,
        context: "drafts.get batch",
      }
    );
    return results.filter((draft): draft is NormalizedDraft => draft !== null);
  }

  async getDraft(
    draftId: string,
    readPolicy: GmailReadPolicy = {}
  ): Promise<NormalizedDraft | null> {
    const effectiveReadPolicy = this.effectiveReadPolicy(
      readPolicy,
      `drafts.get (${draftId})`
    );
    const res = await this.gmailFetch(
      `/drafts/${encodeURIComponent(draftId)}?format=full`,
      undefined,
      effectiveReadPolicy
    );
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const full = await this.readGmailJson<Record<string, unknown>>(
      res,
      "drafts.get"
    );
    return this.normalizeGmailDraft(full, effectiveReadPolicy);
  }

  async findDraftsOnThread(
    threadId: string,
    readPolicy: GmailReadPolicy = {}
  ): Promise<ThreadDraftProbe> {
    // The thread is the authority, not the Drafts folder. A Gmail reply draft
    // lives inside its conversation as a DRAFT-labelled message, so
    // `threads.get` answers "is there a draft here?" completely — no page cap,
    // nothing to truncate. `fetchThread` cannot be reused: it strips exactly
    // the DRAFT messages this probe is looking for.
    const threadRes = await this.gmailFetch(
      `/threads/${encodeURIComponent(threadId)}?format=minimal`,
      undefined,
      { ...readPolicy, context: `threads.get draft probe (${threadId})` }
    );
    if (threadRes.status === 404) {
      // No such conversation, so no draft is pinned to it. Absence proven.
      await threadRes.body?.cancel().catch(() => undefined);
      return { present: false, draftIds: [] };
    }
    const thread = await this.readGmailJson<{
      messages?: Array<{ id?: string; labelIds?: string[] }>;
    }>(threadRes, `threads.get draft probe (${threadId})`);

    const draftMessageIds = new Set(
      (thread.messages ?? [])
        .filter((message) =>
          (message.labelIds ?? []).some(
            (label) => label.toUpperCase() === "DRAFT"
          )
        )
        .map((message) => (typeof message.id === "string" ? message.id : ""))
        .filter(Boolean)
    );
    if (draftMessageIds.size === 0) return { present: false, draftIds: [] };

    // A draft is definitely there. Name it if the drafts index can — this list
    // carries metadata only (no per-draft body fetch), so it is cheap enough to
    // ask for a full page. If our draft still is not in it, existence stands
    // and identity does not; the caller is told exactly that.
    const listRes = await this.gmailFetch(
      `/drafts?maxResults=${DRAFT_INDEX_PAGE_SIZE}`,
      undefined,
      { ...readPolicy, context: "drafts.list draft probe" }
    );
    const listData = await this.readGmailJson<{
      drafts?: Array<{ id?: string; message?: { id?: string } }>;
    }>(listRes, "drafts.list draft probe");

    const draftIds = (listData.drafts ?? [])
      .filter(
        (draft) =>
          typeof draft.message?.id === "string" &&
          draftMessageIds.has(draft.message.id)
      )
      .map((draft) => (typeof draft.id === "string" ? draft.id : ""))
      .filter(Boolean);

    return { present: true, draftIds };
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
  private async normalizeGmailDraft(
    draft: Record<string, unknown>,
    readPolicy: GmailReadPolicy
  ): Promise<NormalizedDraft | null> {
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
    const { full } = await this.extractBodies(
      msg.id as string,
      payload,
      readPolicy
    );

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
    threadId: string,
    readPolicy: ProviderReadPolicy = {}
  ): Promise<ImageAttachmentMeta[]> {
    const all = await this.getAttachmentsFromThread(threadId, readPolicy);
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
    threadId: string,
    readPolicy: ProviderReadPolicy = {}
  ): Promise<EmailAttachmentMeta[]> {
    const effectiveReadPolicy = this.effectiveReadPolicy(
      readPolicy,
      `threads.get attachments (${threadId})`
    );
    const res = await this.gmailFetch(
      `/threads/${threadId}?format=full`,
      { signal: attachmentRequestSignal() },
      effectiveReadPolicy
    );
    const data = await this.readGmailJson<{
      messages?: Array<Record<string, unknown>>;
    }>(res, `threads.get attachments (${threadId})`);
    this.assertReadDeadline(effectiveReadPolicy);
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
    const quotedOnlyContentIds = this.quotedOnlyInlineContentIds(payload);
    this.collectAttachmentParts(
      payload,
      msgId,
      fromEmail,
      date,
      messageAttachments,
      cacheInlineData,
      budget,
      quotedOnlyContentIds
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

  private quotedOnlyInlineContentIds(
    payload: Record<string, unknown> | undefined
  ): Set<string> {
    if (!payload) return new Set();

    // Only an inline HTML body can be inspected synchronously during
    // attachment enumeration. Attachment-hosted bodies and undecodable
    // charsets yield no quote evidence, so every inline image is kept —
    // dropping a real attachment is worse than keeping a quoted one.
    const { html } = this.collectBodyParts(payload);
    if (!html || html.inlineData === null) return new Set();

    let value: string;
    try {
      const bytes = Buffer.from(html.inlineData, "base64url");
      if (html.contentCharset === "us-ascii") {
        if (bytes.some((byte) => byte > 0x7f)) return new Set();
        value = bytes.toString("ascii");
      } else {
        value = new TextDecoder(html.contentCharset, { fatal: true }).decode(
          bytes
        );
      }
    } catch {
      return new Set();
    }
    if (!value) return new Set();

    const allContentIds = contentIdsReferencedByHtml(value);
    const authoredContentIds = contentIdsReferencedByHtml(
      stripQuotedHtml(value)
    );

    return new Set(
      [...allContentIds].filter(
        (contentId) => !authoredContentIds.has(contentId)
      )
    );
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
    budget: GmailAttachmentCollectionBudget = { truncated: false },
    quotedOnlyContentIds: ReadonlySet<string> = new Set()
  ): void {
    if (!payload || budget.truncated) return;

    const mimeType = ((payload.mimeType as string) || "").toLowerCase();
    const filename = (payload.filename as string) || "";
    const body = payload.body as
      { attachmentId?: string; data?: string; size?: number } | undefined;
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

    const isQuotedOnlyInlinePart = Boolean(
      contentId &&
      !/\battachment\b/.test(disposition) &&
      quotedOnlyContentIds.has(normalizeInlineContentId(contentId))
    );

    if (isAttachmentPart && !isQuotedOnlyInlinePart) {
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
          budget,
          quotedOnlyContentIds
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
      Array<Record<string, unknown>> | undefined) ?? []) {
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
    const res = await this.gmailFetch("/profile", undefined, {
      context: "profile.get",
    });
    const data = await this.readGmailJson<{ emailAddress?: string }>(
      res,
      "profile.get"
    );
    if (!data.emailAddress) {
      throw new ProviderApiError(
        "Gmail profile.get: response did not contain emailAddress",
        res.status,
        data
      );
    }
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
   * Walk a bounded Gmail history slice and return an opaque continuation when
   * more provider pages or materializable messages remain. The continuation
   * retains both Gmail's page token and the latest observed terminal historyId,
   * so a successful cycle resumes beyond old pages without advancing past
   * unpersisted mail.
   *
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
    const deadlineAt = Date.now() + GMAIL_PROVIDER_READ_DEADLINE_MS;
    const cursor = decodeGmailIncrementalCursor(syncToken);
    const pendingMessageIds = [...cursor.pendingMessageIds];
    const pendingMessageIdSet = new Set(pendingMessageIds);
    let pageToken = cursor.pageToken;
    let finalHistoryId = cursor.finalHistoryId;
    let historyComplete = cursor.historyComplete;
    let pagesRead = 0;

    while (
      !historyComplete &&
      pagesRead < GMAIL_INCREMENTAL_HISTORY_MAX_PAGES &&
      pendingMessageIds.length < GMAIL_INCREMENTAL_HISTORY_MAX_MESSAGES
    ) {
      const params = new URLSearchParams({
        historyTypes: "messageAdded",
        maxResults: String(GMAIL_INCREMENTAL_HISTORY_PAGE_SIZE),
        startHistoryId: cursor.startHistoryId,
      });
      if (labelId) params.set("labelId", labelId);
      if (pageToken) params.set("pageToken", pageToken);

      const res = await this.gmailFetch(
        `/history?${params.toString()}`,
        undefined,
        { deadlineAt, context: `history.list (${contextLabel})` }
      );
      const data = await this.readGmailJson<{
        history?: Array<{
          messagesAdded?: Array<{ message?: { id?: string } }>;
        }>;
        historyId?: string;
        nextPageToken?: string;
      }>(res, `history.list (${contextLabel})`);
      pagesRead += 1;

      for (const record of data.history || []) {
        for (const added of record.messagesAdded || []) {
          const messageId = added.message?.id?.trim();
          if (!messageId || pendingMessageIdSet.has(messageId)) continue;
          pendingMessageIdSet.add(messageId);
          pendingMessageIds.push(messageId);
        }
      }

      if (data.historyId?.trim()) finalHistoryId = data.historyId.trim();
      const nextPageToken = data.nextPageToken?.trim() || null;
      if (nextPageToken && nextPageToken === pageToken) {
        throw new ProviderApiError(
          `Gmail history.list (${contextLabel}) returned a non-advancing page token`,
          500,
          { pageToken, nextPageToken }
        );
      }
      pageToken = nextPageToken;
      historyComplete = pageToken === null;
    }

    const messageIdsToMaterialize = pendingMessageIds.slice(
      0,
      GMAIL_INCREMENTAL_HISTORY_MAX_MESSAGES
    );
    const remainingMessageIds = pendingMessageIds.slice(
      GMAIL_INCREMENTAL_HISTORY_MAX_MESSAGES
    );

    const emails = await this.fetchMessagesByIds(messageIdsToMaterialize, {
      // History is a discovery log, not a snapshot. A message can be deleted
      // or permanently expunged after history.list names it but before the
      // follow-up messages.get. That 404/410 is a durable tombstone: there is
      // no correspondence left to materialize, so the history cursor may
      // advance. Every other response still fails the whole page closed.
      ignoreMissingHistoryMessages: true,
      deadlineAt,
    });
    return {
      emails: emails.filter(
        (email) =>
          !email.labelIds.some((label) =>
            NON_DELIVERY_MESSAGE_LABELS.has(label.toUpperCase())
          )
      ),
      nextSyncToken: encodeGmailIncrementalCursor({
        startHistoryId: cursor.startHistoryId,
        pageToken,
        finalHistoryId,
        pendingMessageIds: remainingMessageIds,
      }),
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
      if (isGmailReadDeadlineError(error)) throw error;
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
    options: {
      ignoreMissingHistoryMessages?: boolean;
      deadlineAt?: number;
    } = {}
  ): Promise<NormalizedEmail[]> {
    const results = await mapGmailReads(
      ids,
      async (id, _index, readPolicy) => {
        const messageContext = `messages.get (${id})`;
        const res = await this.gmailFetch(
          `/messages/${id}?format=full`,
          undefined,
          { ...readPolicy, context: messageContext }
        );
        if (
          options.ignoreMissingHistoryMessages &&
          (res.status === 404 || res.status === 410)
        ) {
          // Do not retry a history page forever for an object Gmail has
          // confirmed no longer exists. This is intentionally scoped to
          // the post-history materialization seam; search/backfill/thread
          // reads keep surfacing missing objects as typed provider errors.
          await res.body?.cancel().catch(() => undefined);
          return null;
        }
        const message = await this.readGmailJson<Record<string, unknown>>(
          res,
          messageContext
        );
        if (message.id !== id) {
          throw new ProviderApiError(
            `Gmail messages.get (${id}): response did not contain the requested message`,
            res.status,
            message
          );
        }
        return this.normalizeGmailMessage(message, readPolicy);
      },
      {
        deadlineAt:
          options.deadlineAt ?? Date.now() + GMAIL_PROVIDER_READ_DEADLINE_MS,
        context: "messages.get batch",
      }
    );

    return results.filter(
      (message): message is NormalizedEmail => message !== null
    );
  }

  private async normalizeGmailMessage(
    msg: Record<string, unknown>,
    readPolicy: GmailReadPolicy
  ): Promise<NormalizedEmail> {
    const payload = msg.payload as Record<string, unknown> | undefined;
    const headers = (payload?.headers || []) as Array<{
      name: string;
      value: string;
    }>;
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ||
      "";

    const messageId = msg.id as string;
    const { full, clean, selected } = await this.extractBodies(
      messageId,
      payload,
      readPolicy
    );
    const internalDate = msg.internalDate;
    if (typeof internalDate !== "string" || !/^\d+$/.test(internalDate)) {
      throw new ProviderApiError(
        `Gmail message ${messageId} did not contain an exact internalDate`,
        502,
        internalDate
      );
    }
    const deliveredAt = new Date(Number(internalDate));
    if (!Number.isFinite(deliveredAt.getTime())) {
      throw new ProviderApiError(
        `Gmail message ${messageId} contained an invalid internalDate`,
        502,
        internalDate
      );
    }
    const from = getHeader("From");
    const to = this.parseAddressList(getHeader("To"));
    const cc = this.parseAddressList(getHeader("Cc"));
    const subject = getHeader("Subject");

    return {
      id: messageId,
      threadId: (msg.threadId as string) || "",
      from,
      fromName: this.extractName(from),
      to,
      cc,
      subject,
      snippet: (msg.snippet as string) || "",
      bodyText: full,
      bodyTextClean: clean || undefined,
      providerDeliverySource: {
        mediaType: selected.mediaType,
        value: selected.value,
        sourceKind: "gmail_mime_part",
        selectionRevision: PROVIDER_DELIVERY_SELECTION_REVISIONS.gmail,
        providerPartId: selected.partId,
        providerBodyAttachmentId: selected.attachmentId,
        contentCharset: selected.contentCharset,
        senderIdentity: from,
        recipientIdentities: to,
        ccRecipientIdentities: cc,
        subject,
        deliveredAt,
      },
      authenticatedFromDomains: gmailAuthenticatedFromDomains(headers),
      date: deliveredAt,
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
    const addresses: string[] = [];
    let start = 0;
    let quoted = false;
    let escaped = false;
    let angleDepth = 0;
    let commentDepth = 0;

    for (let index = 0; index < header.length; index += 1) {
      const character = header[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quoted && character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"' && commentDepth === 0) {
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (character === "<") angleDepth += 1;
      else if (character === ">" && angleDepth > 0) angleDepth -= 1;
      else if (character === "(") commentDepth += 1;
      else if (character === ")" && commentDepth > 0) commentDepth -= 1;
      else if (character === "," && angleDepth === 0 && commentDepth === 0) {
        const value = header.slice(start, index).trim();
        if (value) addresses.push(value);
        start = index + 1;
      }
    }
    const finalValue = header.slice(start).trim();
    if (finalValue) addresses.push(finalValue);
    return addresses;
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
  private async extractBodies(
    messageId: string,
    payload: Record<string, unknown> | undefined,
    readPolicy: GmailReadPolicy
  ): Promise<{
    full: string;
    clean: string;
    selected: GmailTextBodyPart & { value: string };
  }> {
    const bodyParts = payload
      ? this.collectBodyParts(payload)
      : { plain: null, html: null };
    const selectedPart = bodyParts.plain ??
      bodyParts.html ?? {
        mediaType: "text/plain" as const,
        partId: null,
        attachmentId: null,
        inlineData: "",
        contentCharset: "us-ascii",
      };
    const selectedValue = await this.materializeBodyPart(
      messageId,
      selectedPart,
      readPolicy
    );
    const htmlValue = bodyParts.html
      ? bodyParts.html === selectedPart
        ? selectedValue
        : await this.materializeBodyPart(messageId, bodyParts.html, readPolicy)
      : "";

    // `full` — widest context. Prefer plain when available.
    const full =
      selectedPart.mediaType === "text/plain"
        ? selectedValue
        : htmlToPlainText(selectedValue);

    // `clean` — strip quote markers in HTML space before text conversion.
    // Only useful when we actually have HTML; for plain-only messages let
    // the regex layer in stripQuotedContent handle it (we leave `clean`
    // equal to `full` to signal "provider had no structural advantage here",
    // and the route still applies stripQuotedContent as layer 2).
    let clean = full;
    if (htmlValue) {
      const stripped = stripQuotedHtml(htmlValue);
      clean = htmlToPlainText(stripped);
    }

    return {
      full,
      clean,
      selected: { ...selectedPart, value: selectedValue },
    };
  }

  private async materializeBodyPart(
    messageId: string,
    part: GmailTextBodyPart,
    readPolicy: GmailReadPolicy
  ): Promise<string> {
    const decode = (bytes: Uint8Array): string => {
      if (part.contentCharset === "us-ascii") {
        if (bytes.some((byte) => byte > 0x7f)) {
          throw new ProviderApiError(
            `Gmail body part (${messageId}:${part.partId ?? "root"}) contained non-ASCII bytes without a declared charset`,
            502,
            { charset: part.contentCharset }
          );
        }
        return Buffer.from(bytes).toString("ascii");
      }
      try {
        return new TextDecoder(part.contentCharset, { fatal: true }).decode(
          bytes
        );
      } catch (error) {
        throw new ProviderApiError(
          `Gmail body part (${messageId}:${part.partId ?? "root"}) was not valid ${part.contentCharset}`,
          502,
          {
            charset: part.contentCharset,
            cause: error instanceof Error ? error.message : String(error),
          }
        );
      }
    };
    if (part.inlineData !== null) {
      return decode(Buffer.from(part.inlineData, "base64url"));
    }
    if (!part.attachmentId) return "";
    const context = `body attachment (${messageId}:${part.attachmentId})`;
    const response = await this.gmailFetch(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.attachmentId)}`,
      undefined,
      { ...readPolicy, context }
    );
    const attachment = await this.readGmailAttachmentJson(
      response,
      context,
      DEFAULT_EMAIL_ATTACHMENT_DOWNLOAD_LIMIT_BYTES
    );
    if (typeof attachment.data !== "string") {
      throw new ProviderApiError(
        `Gmail ${context}: response did not contain body bytes`,
        response.status,
        attachment
      );
    }
    return decode(
      this.decodeAttachmentData(
        attachment.data,
        DEFAULT_EMAIL_ATTACHMENT_DOWNLOAD_LIMIT_BYTES,
        context
      )
    );
  }

  /**
   * Walk a Gmail MIME tree, returning the first text/plain and text/html
   * bodies we find. Gmail nests multipart/alternative inside multipart/mixed
   * for messages with attachments, so a recursive walk is required.
   */
  private collectBodyParts(payload: Record<string, unknown>): {
    plain: GmailTextBodyPart | null;
    html: GmailTextBodyPart | null;
  } {
    const mimeType = ((payload.mimeType as string) || "").toLowerCase();
    const body = payload.body as
      | { data?: string; attachmentId?: string }
      | undefined;
    const parts = payload.parts as Array<Record<string, unknown>> | undefined;
    const filename = ((payload.filename as string) || "").trim();
    const headers = (payload.headers ?? []) as Array<{
      name?: string;
      value?: string;
    }>;
    const isExplicitAttachment =
      Boolean(filename) ||
      headers.some(
        (header) =>
          header.name?.toLowerCase() === "content-disposition" &&
          /\battachment\b/i.test(header.value ?? "")
      );

    let plain: GmailTextBodyPart | null = null;
    let html: GmailTextBodyPart | null = null;
    const hasBodyReference =
      typeof body?.data === "string" ||
      (typeof body?.attachmentId === "string" && body.attachmentId.length > 0);
    if (
      (mimeType === "text/plain" || mimeType === "text/html") &&
      hasBodyReference &&
      !isExplicitAttachment
    ) {
      const value: GmailTextBodyPart = {
        mediaType: mimeType,
        partId:
          typeof payload.partId === "string" && payload.partId
            ? payload.partId
            : null,
        attachmentId: body?.attachmentId || null,
        inlineData: typeof body?.data === "string" ? body.data : null,
        contentCharset: canonicalGmailBodyCharset(headers),
      };
      if (mimeType === "text/plain") plain = value;
      else html = value;
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
      { attachmentId?: string; data?: string } | undefined;
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
