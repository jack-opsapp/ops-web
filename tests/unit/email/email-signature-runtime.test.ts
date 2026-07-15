import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getProviderMock,
  listKnownMock,
  refreshProviderMock,
  resolveEffectiveMock,
} = vi.hoisted(() => ({
  getProviderMock: vi.fn(),
  listKnownMock: vi.fn(),
  refreshProviderMock: vi.fn(),
  resolveEffectiveMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getProvider: getProviderMock },
}));

vi.mock("@/lib/api/services/email-signature-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/services/email-signature-service")
  >("@/lib/api/services/email-signature-service");
  return {
    ...actual,
    EmailSignatureService: {
      listKnown: listKnownMock,
      resolveEffective: resolveEffectiveMock,
      refreshProvider: refreshProviderMock,
    },
  };
});

import {
  loadKnownEmailSignaturesForMessage,
  prepareHistoricalOutboundBodyForLearning,
  resolveEmailSignatureForMessage,
} from "@/lib/email/email-signature-runtime";
import type { EmailConnection } from "@/lib/types/email-connection";

function connection(type: EmailConnection["type"]): EmailConnection {
  return {
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    type,
    userId: type === "company" ? null : "user-1",
    email: "operator@example.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2099-01-01"),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 15,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getProviderMock.mockReturnValue({ providerType: "gmail" });
  resolveEffectiveMock
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ recordId: "signature-1" });
  refreshProviderMock.mockResolvedValue({ status: "refreshed" });
  listKnownMock.mockResolvedValue([]);
});

describe("resolveEmailSignatureForMessage", () => {
  it("imports a company mailbox provider signature at mailbox scope", async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }) };

    await resolveEmailSignatureForMessage({
      supabase: supabase as never,
      connection: connection("company"),
      userId: "user-1",
    });

    expect(refreshProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        connectionId: "connection-1",
        scopeUserId: null,
        mailboxAddress: "operator@example.com",
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      "sync_email_signature_notification",
      {
        p_company_id: "company-1",
        p_connection_id: "connection-1",
        p_scope_user_id: "user-1",
      }
    );
  });

  it("loads every exact revision for a shared mailbox, including another operator's prior signature", async () => {
    listKnownMock.mockResolvedValue([
      {
        contentHtml: "<div>Current</div>",
        contentText: "Current",
        contentHash: "a".repeat(64),
      },
      {
        contentHtml: "<div>Prior operator</div>",
        contentText: "Prior operator",
        contentHash: "b".repeat(64),
      },
    ]);

    await expect(
      loadKnownEmailSignaturesForMessage({
        connection: connection("company"),
      })
    ).resolves.toEqual([
      {
        html: "<div>Current</div>",
        text: "Current",
        hash: "a".repeat(64),
      },
      {
        html: "<div>Prior operator</div>",
        text: "Prior operator",
        hash: "b".repeat(64),
      },
    ]);
  });

  it("removes an exact connection-scoped historical signature before authorizing full-body learning", async () => {
    listKnownMock.mockResolvedValue([
      {
        contentHtml: "<div>Previous signature</div>",
        contentText: "Previous signature",
        contentHash: "b".repeat(64),
      },
    ]);

    await expect(
      prepareHistoricalOutboundBodyForLearning({
        connection: connection("individual"),
        userId: "user-1",
        body: "Authored body\n\nPrevious signature",
        subject: "Project update",
      })
    ).resolves.toEqual({
      authoredBody: "Authored body",
      cleanBody: "Authored body",
      exactSignatureRemoved: true,
    });
    expect(listKnownMock).toHaveBeenCalledWith({
      companyId: "company-1",
      connectionId: "connection-1",
    });
  });

  it("fails closed before loading signatures for a shared mailbox history scan", async () => {
    await expect(
      prepareHistoricalOutboundBodyForLearning({
        connection: connection("company"),
        userId: "user-1",
        body: "Authored body\n\nPrevious signature",
        subject: "Project update",
      })
    ).resolves.toEqual({
      authoredBody: "Authored body\n\nPrevious signature",
      cleanBody: "Authored body\n\nPrevious signature",
      exactSignatureRemoved: false,
    });
    expect(listKnownMock).not.toHaveBeenCalled();
  });

  it("excludes another user's signature revision from personal history learning", async () => {
    listKnownMock.mockResolvedValue([
      {
        contentHtml: "<div>Other operator</div>",
        contentText: "Other operator",
        contentHash: "b".repeat(64),
        scopeUserId: "user-2",
      },
    ]);

    await expect(
      prepareHistoricalOutboundBodyForLearning({
        connection: connection("individual"),
        userId: "user-1",
        body: "Authored body\n\nOther operator",
        subject: "Project update",
      })
    ).resolves.toEqual({
      authoredBody: "Authored body\n\nOther operator",
      cleanBody: "Authored body\n\nOther operator",
      exactSignatureRemoved: false,
    });
  });

  it("fails closed when no exact known historical signature can be removed", async () => {
    listKnownMock.mockResolvedValue([]);

    await expect(
      prepareHistoricalOutboundBodyForLearning({
        connection: connection("individual"),
        userId: "user-1",
        body: "Authored body\n\nUnknown signature",
        subject: "Project update",
      })
    ).resolves.toEqual({
      authoredBody: "Authored body\n\nUnknown signature",
      cleanBody: "Authored body\n\nUnknown signature",
      exactSignatureRemoved: false,
    });
  });

  it("fails closed when historical signature revisions cannot be loaded", async () => {
    listKnownMock.mockRejectedValue(new Error("signature lookup unavailable"));

    await expect(
      prepareHistoricalOutboundBodyForLearning({
        connection: connection("individual"),
        userId: "user-1",
        body: "Authored body\n\nPrevious signature",
        subject: "Project update",
      })
    ).resolves.toEqual({
      authoredBody: "Authored body\n\nPrevious signature",
      cleanBody: "Authored body\n\nPrevious signature",
      exactSignatureRemoved: false,
    });
  });
});
