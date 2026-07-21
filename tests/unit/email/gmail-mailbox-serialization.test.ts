import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireLockMock,
  getServiceRoleClientMock,
  releaseLockMock,
  requireEmailCompanyAccessMock,
} = vi.hoisted(() => ({
  acquireLockMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  releaseLockMock: vi.fn(),
  requireEmailCompanyAccessMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: (_client: unknown, callback: () => Promise<unknown>) =>
    callback(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: requireEmailCompanyAccessMock,
}));

vi.mock("@/lib/email/email-connection-operation-access", () => ({
  resolveEmailConnectionOperationAccess: vi.fn(async () => ({
    allowed: true,
    actor: { userId: "user-1", companyId: "company-1" },
    connections: [
      {
        id: "connection-1",
        company_id: "company-1",
        provider: "gmail",
        type: "company",
        user_id: null,
        status: "active",
        sync_enabled: true,
      },
    ],
    connectionIds: ["connection-1"],
  })),
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  acquireEmailConnectionSyncLock: acquireLockMock,
  releaseEmailConnectionSyncLock: releaseLockMock,
}));

vi.mock("@/lib/api/services/email-filter-service", () => ({
  EmailFilterService: {
    buildBlocklist: vi.fn(async () => ({ domains: new Set<string>() })),
  },
}));

vi.mock("@/lib/api/services/email-classifier", () => ({
  classifyEmails: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET as scanPreviewGET } from "@/app/api/integrations/gmail/scan-preview/route";

function makeSupabaseDouble() {
  class Query {
    select() {
      return this;
    }

    eq() {
      return this;
    }

    update() {
      return this;
    }

    async single() {
      return {
        data: {
          id: "connection-1",
          company_id: "company-1",
          provider: "gmail",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: "2999-01-01T00:00:00.000Z",
          sync_filters: {},
        },
        error: null,
      };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return Promise.resolve({ data: null, error: null }).then(
        onfulfilled,
        onrejected
      );
    }
  }

  return {
    from: vi.fn(() => new Query()),
  };
}

describe("Gmail mailbox-wide operation serialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble());
    requireEmailCompanyAccessMock.mockResolvedValue(null);
    releaseLockMock.mockResolvedValue(undefined);
  });

  it("returns a busy response before preview touches Gmail", async () => {
    acquireLockMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await scanPreviewGET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/scan-preview?connectionId=connection-1"
      )
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Mailbox is busy. Try again in a few minutes.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(releaseLockMock).not.toHaveBeenCalled();
  });

  it("releases the preview lease when a Gmail read fails", async () => {
    acquireLockMock.mockResolvedValue("owner-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 401 }))
    );

    const response = await scanPreviewGET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/scan-preview?connectionId=connection-1"
      )
    );

    expect(response.status).toBe(500);
    expect(releaseLockMock).toHaveBeenCalledWith(
      "connection-1",
      "owner-1",
      "gmail-scan-preview",
      expect.anything()
    );
  });

  it.each([
    "src/app/api/integrations/email/analyze/route.ts",
    "src/app/api/integrations/email/analyze-continue/route.ts",
    "src/app/api/integrations/email/analyze-memory/route.ts",
    "src/app/api/inbox/backfill/route.ts",
  ])("serializes the legacy bulk-read path %s", (path) => {
    const route = readFileSync(join(process.cwd(), path), "utf8");

    expect(route).toMatch(/acquire(?:OrAdopt)?EmailConnectionSyncLock/);
    expect(route).toContain("releaseEmailConnectionSyncLock");
    expect(route).toContain("Mailbox is busy. Try again in a few minutes.");
  });

  it.each([
    "src/app/api/inbox/phase-c-backfill/route.ts",
    "src/app/api/inbox/drafts/route.ts",
    "src/app/api/integrations/gmail/labels/route.ts",
    "src/lib/api/services/email-attachments/attachment-runtime.ts",
  ])("uses the shared mailbox lease wrapper for provider path %s", (path) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");

    expect(source).toContain("runWithEmailConnectionSyncLock");
  });
});
