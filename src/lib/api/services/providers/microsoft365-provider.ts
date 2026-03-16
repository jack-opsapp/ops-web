/**
 * OPS Web - Microsoft 365 Provider
 *
 * Implements EmailProviderInterface for Microsoft 365 using the Graph API.
 * Uses OAuth 2.0 with refresh tokens for authentication.
 */

import type { EmailConnection } from "@/lib/types/email-connection";
import type {
  EmailProviderInterface,
  NormalizedEmail,
  SyncResult,
  WebhookSubscription,
} from "../email-provider";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = ["Mail.Read", "Mail.ReadWrite"];

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
          client_id: process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          refresh_token: this.connection.refreshToken,
          grant_type: "refresh_token",
          scope: SCOPES.join(" "),
        }),
      }
    );

    if (!res.ok) throw new Error(`M365 token refresh failed: ${res.status}`);
    const data = await res.json();

    // Update in-memory connection (caller must persist if needed)
    this.connection.accessToken = data.access_token;
    this.connection.expiresAt = new Date(Date.now() + data.expires_in * 1000);

    return data.access_token as string;
  }

  private async graphFetch(
    path: string,
    options?: RequestInit
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
      const err = await res.text();
      throw new Error(`Graph API error ${res.status}: ${err}`);
    }
    return res.json();
  }

  async fetchNewEmailsSince(syncToken: string): Promise<SyncResult> {
    // M365 delta query — syncToken is the deltaLink from last sync
    const url = syncToken.startsWith("http")
      ? syncToken // deltaLink is a full URL
      : `/me/mailFolders/inbox/messages/delta`;

    const data = await this.graphFetch(url);
    const emails = ((data.value as Array<Record<string, unknown>>) || []).map(
      (msg) => this.normalizeM365Message(msg)
    );

    return {
      emails,
      nextSyncToken:
        (data["@odata.deltaLink"] as string) || syncToken,
    };
  }

  async fetchSentEmailsSince(syncToken: string): Promise<SyncResult> {
    const url = syncToken.startsWith("http")
      ? syncToken
      : `/me/mailFolders/sentitems/messages/delta`;

    const data = await this.graphFetch(url);
    const emails = ((data.value as Array<Record<string, unknown>>) || []).map(
      (msg) => this.normalizeM365Message(msg)
    );

    return {
      emails,
      nextSyncToken:
        (data["@odata.deltaLink"] as string) || syncToken,
    };
  }

  async searchEmails(
    query: string,
    options?: { maxResults?: number; after?: Date }
  ): Promise<NormalizedEmail[]> {
    let filter = `contains(subject, '${query}')`;
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
      bodyText:
        msgBody?.contentType === "text" ? msgBody.content || "" : "",
      date: new Date(msg.receivedDateTime as string),
      labelIds: (msg.categories as string[]) || [],
      isRead: (msg.isRead as boolean) || false,
      hasAttachments: (msg.hasAttachments as boolean) || false,
      sizeEstimate: 0,
    };
  }
}
