/**
 * OPS Web - Gmail Provider
 *
 * Implements EmailProviderInterface for Gmail using the Gmail REST API.
 * Wraps existing Gmail API logic from gmail-service.ts and gmail-token.ts
 * into the normalized provider interface.
 */

import type { EmailConnection } from "@/lib/types/email-connection";
import type {
  EmailProviderInterface,
  NormalizedEmail,
  SyncResult,
  WebhookSubscription,
} from "../email-provider";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

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
        client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
        client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
        refresh_token: this.connection.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const json = await response.json();
    if (!json.access_token) throw new Error("Failed to refresh Gmail access token");

    // Update in-memory connection (caller must persist if needed)
    this.connection.accessToken = json.access_token as string;
    this.connection.expiresAt = new Date(Date.now() + json.expires_in * 1000);

    return json.access_token as string;
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

  async fetchNewEmailsSince(syncToken: string): Promise<SyncResult> {
    const res = await this.gmailFetch(
      `/history?historyTypes=messageAdded&startHistoryId=${syncToken}&labelId=INBOX`
    );
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
      nextSyncToken: data.historyId || syncToken,
    };
  }

  async fetchSentEmailsSince(syncToken: string): Promise<SyncResult> {
    const res = await this.gmailFetch(
      `/history?historyTypes=messageAdded&startHistoryId=${syncToken}&labelId=SENT`
    );
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
      nextSyncToken: data.historyId || syncToken,
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
    // Gmail uses Pub/Sub — the topicName should be configured in env
    const res = await this.gmailFetch("/watch", {
      method: "POST",
      body: JSON.stringify({
        topicName: process.env.GOOGLE_PUBSUB_TOPIC!,
        labelIds: ["INBOX", "SENT"],
      }),
    });
    const data = await res.json();

    return {
      subscriptionId: data.historyId,
      expiresAt: new Date(Number(data.expiration)),
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
    const body = payload.body as { data?: string } | undefined;
    if (body?.data) {
      return Buffer.from(body.data, "base64").toString("utf-8");
    }
    const parts = payload.parts as Array<Record<string, unknown>> | undefined;
    if (parts) {
      const textPart = parts.find((p) => p.mimeType === "text/plain");
      const textBody = textPart?.body as { data?: string } | undefined;
      if (textBody?.data) {
        return Buffer.from(textBody.data, "base64").toString("utf-8");
      }
      // Recurse for nested parts
      for (const part of parts) {
        const text = this.extractBody(part);
        if (text) return text;
      }
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
}
