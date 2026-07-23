/**
 * Browser client for mailbox connection descriptors.
 *
 * All reads and mutations cross an authenticated server route. This module
 * deliberately has no Supabase table access and its public type has no
 * provider credential fields.
 */

import type {
  BrowserUpdateEmailConnection,
  EmailConnectionDescriptor,
} from "@/lib/types/email-connection";
import { authedFetch } from "@/lib/utils/authed-fetch";

type SerializedDescriptor = Omit<
  EmailConnectionDescriptor,
  "lastSyncedAt" | "createdAt" | "updatedAt"
> & {
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseDescriptor(
  descriptor: SerializedDescriptor
): EmailConnectionDescriptor {
  return {
    id: descriptor.id,
    companyId: descriptor.companyId,
    provider: descriptor.provider,
    type: descriptor.type,
    userId: descriptor.userId,
    defaultIntakeOwnerId: descriptor.defaultIntakeOwnerId,
    email: descriptor.email,
    syncEnabled: descriptor.syncEnabled,
    lastSyncedAt: descriptor.lastSyncedAt
      ? new Date(descriptor.lastSyncedAt)
      : null,
    syncIntervalMinutes: descriptor.syncIntervalMinutes,
    syncFilters: descriptor.syncFilters,
    opsLabelId: descriptor.opsLabelId,
    aiReviewEnabled: descriptor.aiReviewEnabled,
    aiMemoryEnabled: descriptor.aiMemoryEnabled,
    status: descriptor.status,
    createdAt: new Date(descriptor.createdAt),
    updatedAt: new Date(descriptor.updatedAt),
  };
}

async function parseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export const EmailConnectionBrowserService = {
  async getConnections(): Promise<EmailConnectionDescriptor[]> {
    const response = await authedFetch("/api/integrations/email/connection");
    if (!response.ok) {
      throw new Error(await parseError(response, "Failed to load connections"));
    }
    const body = (await response.json()) as {
      connections?: SerializedDescriptor[];
    };
    return (body.connections ?? []).map(parseDescriptor);
  },

  async updateConnection(
    connectionId: string,
    data: BrowserUpdateEmailConnection
  ): Promise<EmailConnectionDescriptor> {
    const response = await authedFetch("/api/integrations/email/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, data }),
    });
    if (!response.ok) {
      throw new Error(
        await parseError(response, "Failed to update connection")
      );
    }
    const body = (await response.json()) as {
      connection: SerializedDescriptor;
    };
    return parseDescriptor(body.connection);
  },

  async configureCompanyMailboxIntakeOwner(
    connectionId: string,
    expectedDefaultIntakeOwnerId: string | null,
    defaultIntakeOwnerId: string | null
  ): Promise<EmailConnectionDescriptor> {
    const response = await authedFetch("/api/integrations/email/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId,
        expectedDefaultIntakeOwnerId,
        data: { defaultIntakeOwnerId },
      }),
    });
    if (!response.ok) {
      throw new Error(
        await parseError(response, "Failed to configure intake owner")
      );
    }
    const body = (await response.json()) as {
      connection: SerializedDescriptor;
    };
    return parseDescriptor(body.connection);
  },

  async deleteConnection(connectionId: string): Promise<void> {
    const response = await authedFetch(
      `/api/integrations/email/connection?id=${encodeURIComponent(connectionId)}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      throw new Error(
        await parseError(response, "Failed to disconnect connection")
      );
    }
  },
};
