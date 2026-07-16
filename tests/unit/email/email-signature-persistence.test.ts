import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

import type { EmailProviderInterface } from "@/lib/api/services/email-provider";
import {
  EmailSignatureService,
  type EmailSignatureRecord,
} from "@/lib/api/services/email-signature-service";

const DB_ROW: Record<string, unknown> = {
  id: "signature-1",
  company_id: "company-1",
  connection_id: "connection-1",
  scope_user_id: null,
  source: "gmail_send_as",
  content_html: "<div>Provider</div>",
  content_text: "Provider",
  content_hash: "a".repeat(64),
  provider_identity: "operator@example.com",
  active: true,
  fetched_at: "2026-07-14T18:00:00.000Z",
  confirmed_at: null,
  created_by: null,
  updated_by: null,
  created_at: "2026-07-14T18:00:00.000Z",
  updated_at: "2026-07-14T18:00:00.000Z",
};

function readClient(rows = [DB_ROW]) {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    }),
    order: vi.fn(async () => ({ data: rows, error: null })),
  };
  return {
    filters,
    client: {
      from: vi.fn((table: string) => {
        expect(table).toBe("email_signatures");
        return builder;
      }),
    },
  };
}

function persistClient() {
  let rpcPayload: Record<string, unknown> | null = null;
  let rpcName: string | null = null;
  return {
    get name() {
      return rpcName;
    },
    get payload() {
      return rpcPayload;
    },
    client: {
      rpc: vi.fn(async (name: string, payload: Record<string, unknown>) => {
        rpcName = name;
        rpcPayload = payload;
        return {
          data: {
            ...DB_ROW,
            id: "saved-signature",
            connection_id: payload.p_connection_id,
            scope_user_id:
              payload.p_source === "ops" ? payload.p_actor_user_id : null,
            source: payload.p_source,
            content_html: payload.p_content_html,
            content_text: payload.p_content_text,
            content_hash: payload.p_content_hash,
            provider_identity: payload.p_provider_identity,
            fetched_at: payload.p_fetched_at,
            confirmed_at: payload.p_confirmed_at,
            created_by: payload.p_actor_user_id,
            updated_by: payload.p_actor_user_id,
            created_at: "2026-07-14T19:00:00.000Z",
            updated_at: "2026-07-14T19:00:00.000Z",
          },
          error: null,
        };
      }),
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  requireSupabaseMock.mockReset();
});

describe("EmailSignatureService persistence", () => {
  it("loads only active rows for the requested company and connection", async () => {
    const { client, filters } = readClient();
    requireSupabaseMock.mockReturnValue(client);

    const rows = await EmailSignatureService.listActive({
      companyId: "company-1",
      connectionId: "connection-1",
    });

    expect(filters).toEqual([
      ["company_id", "company-1"],
      ["connection_id", "connection-1"],
      ["active", true],
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "signature-1",
        companyId: "company-1",
        connectionId: "connection-1",
        isActive: true,
        source: "gmail_send_as",
      }),
    ]);
  });

  it("loads inactive revisions for exact provider draft cleanup", async () => {
    const inactive = {
      ...DB_ROW,
      id: "signature-previous",
      active: false,
      content_text: "Previous provider signature",
    };
    const { client, filters } = readClient([DB_ROW, inactive]);
    requireSupabaseMock.mockReturnValue(client);

    const rows = await EmailSignatureService.listKnown({
      companyId: "company-1",
      connectionId: "connection-1",
    });

    expect(filters).toEqual([
      ["company_id", "company-1"],
      ["connection_id", "connection-1"],
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "signature-1",
      "signature-previous",
    ]);
    expect(rows[1].isActive).toBe(false);
  });

  it("resolves precedence after the tenant-scoped load", async () => {
    const operator = {
      ...DB_ROW,
      id: "operator-ops",
      scope_user_id: "user-1",
      source: "ops",
      content_text: "Operator",
      provider_identity: null,
    };
    const { client } = readClient([DB_ROW, operator]);
    requireSupabaseMock.mockReturnValue(client);

    await expect(
      EmailSignatureService.resolveEffective({
        companyId: "company-1",
        connectionId: "connection-1",
        userId: "user-1",
        mailboxAddress: "operator@example.com",
      })
    ).resolves.toMatchObject({
      recordId: "operator-ops",
      scope: "operator",
      source: "ops",
    });
  });

  it("preserves the last-known provider signature when the read fails", async () => {
    const existing: EmailSignatureRecord = {
      id: "signature-1",
      companyId: "company-1",
      connectionId: "connection-1",
      scopeUserId: "user-1",
      source: "gmail_send_as",
      contentHtml: "<div>Last known</div>",
      contentText: "Last known",
      contentHash: "a".repeat(64),
      providerIdentity: "operator@example.com",
      isActive: true,
      fetchedAt: "2026-07-14T18:00:00.000Z",
      confirmedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: "2026-07-14T18:00:00.000Z",
      updatedAt: "2026-07-14T18:00:00.000Z",
    };
    vi.spyOn(EmailSignatureService, "listActive").mockResolvedValue([existing]);
    const provider = {
      providerType: "gmail",
      getEmailSignature: vi.fn(async () => {
        throw new Error("temporary Gmail settings outage");
      }),
    } as unknown as EmailProviderInterface;

    const result = await EmailSignatureService.refreshProvider({
      companyId: "company-1",
      connectionId: "connection-1",
      scopeUserId: "user-1",
      mailboxAddress: "operator@example.com",
      provider,
      actorUserId: "user-1",
    });

    expect(result).toEqual({
      status: "stale",
      signature: existing,
      error: "temporary Gmail settings outage",
    });
    expect(requireSupabaseMock).not.toHaveBeenCalled();
  });

  it("sanitizes and inserts an operator-scoped OPS signature", async () => {
    const db = persistClient();
    requireSupabaseMock.mockReturnValue(db.client);

    const saved = await EmailSignatureService.saveOps({
      companyId: "company-1",
      connectionId: "connection-1",
      scopeUserId: "user-1",
      html: '<div onclick="bad()"><strong>Jackson</strong></div>',
      actorUserId: "user-1",
    });

    expect(db.name).toBe("replace_email_signature_as_system");
    expect(db.payload).toMatchObject({
      p_connection_id: "connection-1",
      p_source: "ops",
      p_content_html: "<div><strong>Jackson</strong></div>",
      p_content_text: "Jackson",
      p_provider_identity: null,
      p_actor_user_id: "user-1",
    });
    expect(db.payload).not.toHaveProperty("p_company_id");
    expect(db.payload).not.toHaveProperty("p_scope_user_id");
    expect(db.payload?.p_content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved).toMatchObject({
      id: "saved-signature",
      source: "ops",
      scopeUserId: "user-1",
    });
  });

  it("stores a confirmed Microsoft signature with confirmation provenance", async () => {
    const db = persistClient();
    requireSupabaseMock.mockReturnValue(db.client);

    await EmailSignatureService.confirmMicrosoft({
      companyId: "company-1",
      connectionId: "connection-1",
      scopeUserId: "user-1",
      mailboxAddress: "Operator@Example.com",
      text: "Jackson\nOPS",
      actorUserId: "user-1",
    });

    expect(db.name).toBe("replace_email_signature_as_system");
    expect(db.payload).toMatchObject({
      p_source: "microsoft_confirmed",
      p_provider_identity: "operator@example.com",
      p_confirmed_at: expect.any(String),
      p_fetched_at: null,
    });
    expect(db.payload).not.toHaveProperty("p_company_id");
    expect(db.payload).not.toHaveProperty("p_scope_user_id");
  });

  it("deactivates through the actor-aware RPC instead of a generic table update", async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));
    const from = vi.fn(() => {
      throw new Error(
        "actor signature mutations must not write the table directly"
      );
    });
    requireSupabaseMock.mockReturnValue({ rpc, from });

    await EmailSignatureService.deactivate({
      companyId: "spoofed-company",
      connectionId: "connection-1",
      source: "ops",
      scopeUserId: "spoofed-user",
      actorUserId: "user-1",
    });

    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("deactivate_email_signature_as_system", {
      p_actor_user_id: "user-1",
      p_connection_id: "connection-1",
      p_signature_id: null,
      p_source: "ops",
    });
  });

  it("persists an available Gmail read and reports it as refreshed", async () => {
    vi.spyOn(EmailSignatureService, "listActive").mockResolvedValue([]);
    const saved = {
      id: "gmail-signature",
      companyId: "company-1",
      connectionId: "connection-1",
      scopeUserId: "user-1",
      source: "gmail_send_as" as const,
      contentHtml: "<div>Gmail</div>",
      contentText: "Gmail",
      contentHash: "a".repeat(64),
      providerIdentity: "operator@example.com",
      isActive: true,
      fetchedAt: "2026-07-14T19:00:00.000Z",
      confirmedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: "2026-07-14T19:00:00.000Z",
      updatedAt: "2026-07-14T19:00:00.000Z",
    };
    vi.spyOn(EmailSignatureService, "saveProvider").mockResolvedValue(saved);
    const provider = {
      providerType: "gmail",
      getEmailSignature: vi.fn(async () => ({
        status: "available" as const,
        source: "gmail_send_as" as const,
        providerIdentity: "operator@example.com",
        contentHtml: "<div>Gmail</div>",
      })),
    } as unknown as EmailProviderInterface;

    await expect(
      EmailSignatureService.refreshProvider({
        companyId: "company-1",
        connectionId: "connection-1",
        scopeUserId: "user-1",
        mailboxAddress: "operator@example.com",
        provider,
        actorUserId: "user-1",
      })
    ).resolves.toEqual({ status: "refreshed", signature: saved });
    expect(EmailSignatureService.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ scopeUserId: null })
    );
  });

  it("deactivates the matching provider row after a successful blank read", async () => {
    const existing: EmailSignatureRecord = {
      id: "signature-1",
      companyId: "company-1",
      connectionId: "connection-1",
      scopeUserId: "user-1",
      source: "gmail_send_as",
      contentHtml: "<div>Old Gmail signature</div>",
      contentText: "Old Gmail signature",
      contentHash: "a".repeat(64),
      providerIdentity: "operator@example.com",
      isActive: true,
      fetchedAt: "2026-07-14T18:00:00.000Z",
      confirmedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: "2026-07-14T18:00:00.000Z",
      updatedAt: "2026-07-14T18:00:00.000Z",
    };
    vi.spyOn(EmailSignatureService, "listActive").mockResolvedValue([existing]);
    const deactivate = vi
      .spyOn(EmailSignatureService, "deactivate")
      .mockResolvedValue();
    const provider = {
      providerType: "gmail",
      getEmailSignature: vi.fn(async () => ({
        status: "not_configured" as const,
        source: "gmail_send_as" as const,
        providerIdentity: "operator@example.com",
        contentHtml: null,
      })),
    } as unknown as EmailProviderInterface;

    await expect(
      EmailSignatureService.refreshProvider({
        companyId: "company-1",
        connectionId: "connection-1",
        scopeUserId: "user-1",
        mailboxAddress: "operator@example.com",
        provider,
        actorUserId: "user-1",
      })
    ).resolves.toEqual({ status: "not_configured", signature: null });
    expect(deactivate).toHaveBeenCalledWith({
      companyId: "company-1",
      connectionId: "connection-1",
      signatureId: "signature-1",
      actorUserId: "user-1",
    });
  });
});
