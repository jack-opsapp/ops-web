import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getConnectionMock,
  getConnectionsMock,
  getProviderMock,
  resolveEmailRouteActorMock,
  filterAuthorizedConnectionsMock,
  resolveEmailSignatureForMessageMock,
  listActiveMock,
  saveOpsMock,
  refreshProviderMock,
  runWithEmailConnectionSyncLockMock,
} = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  getConnectionsMock: vi.fn(),
  getProviderMock: vi.fn(),
  resolveEmailRouteActorMock: vi.fn(),
  filterAuthorizedConnectionsMock: vi.fn(),
  resolveEmailSignatureForMessageMock: vi.fn(),
  listActiveMock: vi.fn(),
  saveOpsMock: vi.fn(),
  refreshProviderMock: vi.fn(),
  runWithEmailConnectionSyncLockMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getConnections: getConnectionsMock,
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/email/email-signature-access", () => ({
  filterAuthorizedEmailSignatureConnections: filterAuthorizedConnectionsMock,
}));

vi.mock("@/lib/api/services/email-signature-service", () => ({
  EmailSignatureService: {
    listActive: listActiveMock,
    saveOps: saveOpsMock,
    deactivate: vi.fn(),
    refreshProvider: refreshProviderMock,
  },
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveEmailRouteActorMock,
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: resolveEmailSignatureForMessageMock,
  isEmailSignatureProviderMailboxBusyError: (error: unknown) =>
    error instanceof Error &&
    error.message === "EMAIL_SIGNATURE_PROVIDER_MAILBOX_BUSY",
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: runWithEmailConnectionSyncLockMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: (_client: unknown, callback: () => Promise<unknown>) =>
    callback(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: vi.fn(() => ({ rpc: vi.fn() })),
}));

import { GET, POST, PUT } from "@/app/api/integrations/email/signature/route";

const foreignIndividualConnection = {
  id: "connection-1",
  companyId: "company-1",
  provider: "gmail",
  type: "individual",
  userId: "user-2",
  email: "user-2@example.com",
};

function getRequest(): NextRequest {
  return new NextRequest(
    "https://ops.test/api/integrations/email/signature" +
      "?companyId=company-1&userId=user-1&connectionId=connection-1"
  );
}

function jsonRequest(method: "PUT" | "POST", body: Record<string, unknown>) {
  return new NextRequest("https://ops.test/api/integrations/email/signature", {
    method,
    body: JSON.stringify({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-1",
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveEmailRouteActorMock.mockResolvedValue({
    ok: true,
    actor: { userId: "user-1", companyId: "company-1" },
  });
  filterAuthorizedConnectionsMock.mockImplementation(
    async ({ connections }: { connections: unknown[] }) => connections
  );
  getConnectionMock.mockResolvedValue(foreignIndividualConnection);
  getConnectionsMock.mockResolvedValue([foreignIndividualConnection]);
  getProviderMock.mockReturnValue({});
  resolveEmailSignatureForMessageMock.mockResolvedValue(null);
  listActiveMock.mockResolvedValue([]);
  saveOpsMock.mockResolvedValue({});
  refreshProviderMock.mockResolvedValue({ status: "not_configured" });
  runWithEmailConnectionSyncLockMock.mockImplementation(
    async ({
      run,
    }: {
      run: (checkpoint: ReturnType<typeof vi.fn>) => unknown;
    }) => {
      const checkpoint = vi.fn(async () => undefined);
      return { acquired: true, value: await run(checkpoint) };
    }
  );
});

describe("email signature route individual-mailbox ownership", () => {
  it("rejects reading another operator's individual mailbox signature", async () => {
    filterAuthorizedConnectionsMock.mockResolvedValue([]);
    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(resolveEmailSignatureForMessageMock).not.toHaveBeenCalled();
    expect(listActiveMock).not.toHaveBeenCalled();
  });

  it("rejects writing an OPS signature onto another operator's individual mailbox", async () => {
    filterAuthorizedConnectionsMock.mockResolvedValue([]);
    const response = await PUT(jsonRequest("PUT", { opsText: "Jackson\nOPS" }));

    expect(response.status).toBe(403);
    expect(saveOpsMock).not.toHaveBeenCalled();
  });

  it("rejects importing another operator's provider signature", async () => {
    filterAuthorizedConnectionsMock.mockResolvedValue([]);
    const response = await POST(
      jsonRequest("POST", { action: "import_provider" })
    );

    expect(response.status).toBe(403);
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(refreshProviderMock).not.toHaveBeenCalled();
  });

  it("reconciles state and the setup prompt when Gmail has no configured signature", async () => {
    getConnectionMock.mockResolvedValue({
      ...foreignIndividualConnection,
      userId: "user-1",
      email: "user-1@example.com",
    });
    refreshProviderMock.mockResolvedValue({
      status: "not_configured",
      signature: null,
    });

    const response = await POST(
      jsonRequest("POST", { action: "import_provider" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connectionId: "connection-1",
      missing: true,
      providerImportStatus: "not_configured",
    });
    expect(resolveEmailSignatureForMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ refreshProviderIfMissing: false })
    );
  });

  it("reports provider read failures instead of claiming a stale import succeeded", async () => {
    getConnectionMock.mockResolvedValue({
      ...foreignIndividualConnection,
      userId: "user-1",
      email: "user-1@example.com",
    });
    refreshProviderMock.mockResolvedValue({
      status: "stale",
      signature: null,
      error: "oauth token expired",
    });

    const response = await POST(
      jsonRequest("POST", { action: "import_provider" })
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Gmail signature could not be read. Try again",
    });
  });

  it("fails busy before constructing or reading the Gmail provider", async () => {
    getConnectionMock.mockResolvedValue({
      ...foreignIndividualConnection,
      userId: "user-1",
      email: "user-1@example.com",
    });
    runWithEmailConnectionSyncLockMock.mockResolvedValue({ acquired: false });

    const response = await POST(
      jsonRequest("POST", { action: "import_provider" })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Mailbox is busy. Try again in a few minutes.",
    });
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(refreshProviderMock).not.toHaveBeenCalled();
  });

  it("allows an operator to read their own individual mailbox signature", async () => {
    getConnectionMock.mockResolvedValue({
      ...foreignIndividualConnection,
      userId: "user-1",
      email: "user-1@example.com",
    });

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(resolveEmailSignatureForMessageMock).toHaveBeenCalledTimes(1);
  });

  it("keeps company mailbox signatures available to authorized company operators", async () => {
    getConnectionMock.mockResolvedValue({
      ...foreignIndividualConnection,
      type: "company",
    });

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(resolveEmailSignatureForMessageMock).toHaveBeenCalledTimes(1);
  });

  it("lists only server-authorized mailbox descriptors without provider credentials", async () => {
    const allowedCompany = {
      ...foreignIndividualConnection,
      id: "company-connection",
      type: "company",
      accessToken: "must-not-leak",
    };
    const ownIndividual = {
      ...foreignIndividualConnection,
      id: "own-connection",
      userId: "user-1",
      accessToken: "must-not-leak",
    };
    getConnectionsMock.mockResolvedValue([
      allowedCompany,
      ownIndividual,
      foreignIndividualConnection,
    ]);
    filterAuthorizedConnectionsMock.mockResolvedValue([
      allowedCompany,
      ownIndividual,
    ]);

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/email/signature" +
          "?companyId=company-1&userId=user-1"
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connections: [
        {
          id: "company-connection",
          mailbox: "user-2@example.com",
          provider: "gmail",
          type: "company",
        },
        {
          id: "own-connection",
          mailbox: "user-2@example.com",
          provider: "gmail",
          type: "individual",
        },
      ],
    });
  });

  it("uses the authenticated OPS actor and treats body identities only as fail-closed claims", async () => {
    resolveEmailRouteActorMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
      }),
    });

    const response = await PUT(
      jsonRequest("PUT", {
        userId: "spoofed-user",
        companyId: "spoofed-company",
        opsText: "Jackson\nOPS",
      })
    );

    expect(response.status).toBe(403);
    expect(resolveEmailRouteActorMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      {
        claimedCompanyId: "spoofed-company",
        claimedUserId: "spoofed-user",
      }
    );
    expect(saveOpsMock).not.toHaveBeenCalled();
  });
});
