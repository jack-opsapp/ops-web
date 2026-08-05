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
  updateConnectionMock,
  identityRowsMock,
  hasConfirmedIdentityMock,
  resolveIdentityNotificationMock,
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
  updateConnectionMock: vi.fn(),
  identityRowsMock: vi.fn(),
  hasConfirmedIdentityMock: vi.fn(),
  resolveIdentityNotificationMock: vi.fn(),
}));

vi.mock("@/lib/notifications/email-identity-confirmation", () => ({
  resolveEmailIdentityConfirmationNotification:
    resolveIdentityNotificationMock,
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
    hasConfirmedIdentity: hasConfirmedIdentityMock,
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

vi.mock("@/lib/api/services/email-connection-service", () => ({
  EmailConnectionService: { updateConnection: updateConnectionMock },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: vi.fn(() => ({
    rpc: vi.fn(),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: identityRowsMock(table),
            error: null,
          }),
        }),
      }),
    }),
  })),
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
  hasConfirmedIdentityMock.mockResolvedValue(false);
  resolveIdentityNotificationMock.mockResolvedValue(undefined);
  saveOpsMock.mockResolvedValue({});
  updateConnectionMock.mockResolvedValue({});
  identityRowsMock.mockImplementation((table: string) =>
    table === "companies"
      ? {
          name: "Canpro Deck and Rail",
          phone: "(250) 538-8994",
          website: "canprodeckandrail.com",
          logo_url: "https://cdn.example.com/canpro.png",
        }
      : { first_name: "Jackson", last_name: "Sweet", phone: "(250) 111-2222" }
  );
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
    // The list carries the gate's answer per mailbox so the post-connect step
    // can find the one still holding outreach in a single read.
    hasConfirmedIdentityMock.mockImplementation(
      async ({ connectionId }: { connectionId: string }) =>
        connectionId === "company-connection"
    );

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
          identityConfirmed: true,
        },
        {
          id: "own-connection",
          mailbox: "user-2@example.com",
          provider: "gmail",
          type: "individual",
          identityConfirmed: false,
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

const ownConnection = {
  ...foreignIndividualConnection,
  userId: "user-1",
  email: "user-1@example.com",
  outreachSubject: "Canpro Deck and Rail Estimate",
};

describe("email identity settings", () => {
  beforeEach(() => {
    getConnectionMock.mockResolvedValue(ownConnection);
  });

  it("returns everything the identity card needs in one read", async () => {
    listActiveMock.mockResolvedValue([
      {
        id: "sig-1",
        source: "ops",
        scopeUserId: "user-1",
        contentHtml:
          '<div>Jackson Sweet<a href="https://canprodeckandrail.com">' +
          "canprodeckandrail.com</a></div>",
        contentText: [
          "Jackson Sweet",
          "Owner, Canpro Deck and Rail",
          "(250) 538-8994",
          "canprodeckandrail.com",
        ].join("\n"),
        confirmedAt: "2026-08-03T10:00:00.000Z",
      },
    ]);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      confirmedAt: "2026-08-03T10:00:00.000Z",
      outreachSubject: "Canpro Deck and Rail Estimate",
      companyLogoUrl: "https://cdn.example.com/canpro.png",
      fields: {
        name: "Jackson Sweet",
        title: "Owner",
        companyName: "Canpro Deck and Rail",
        phone: "(250) 538-8994",
        website: "canprodeckandrail.com",
      },
    });
  });

  it("reports the mailbox confirmation that is holding the gate open", async () => {
    // Outreach runs on any confirmed OPS row, so an operator whose own row
    // predates the confirm flow must not be told their identity is unset.
    listActiveMock.mockResolvedValue([
      {
        id: "sig-operator",
        source: "ops",
        scopeUserId: "user-1",
        contentHtml: "<div>Jackson</div>",
        contentText: "Jackson",
        confirmedAt: null,
      },
      {
        id: "sig-mailbox",
        source: "ops",
        scopeUserId: null,
        contentHtml: "<div>Canpro Deck and Rail</div>",
        contentText: "Canpro Deck and Rail",
        confirmedAt: "2026-08-01T09:00:00.000Z",
      },
    ]);

    const body = await (await GET(getRequest())).json();

    expect(body.confirmedAt).toBe("2026-08-01T09:00:00.000Z");
  });

  it("prefills from the operator and company when no signature exists yet", async () => {
    const response = await GET(getRequest());
    const body = await response.json();

    expect(body.confirmedAt).toBeNull();
    expect(body.fields).toMatchObject({
      name: "Jackson Sweet",
      title: "",
      companyName: "Canpro Deck and Rail",
      phone: "(250) 538-8994",
      website: "canprodeckandrail.com",
      includeLogo: false,
      layout: "logo-left",
    });
  });

  it("renders structured fields through the OPS template and confirms them", async () => {
    const response = await PUT(
      jsonRequest("PUT", {
        fields: {
          name: "Jackson Sweet",
          title: "Owner",
          companyName: "Canpro Deck and Rail",
          phone: "(250) 538-8994",
          website: "canprodeckandrail.com",
        },
        includeLogo: true,
      })
    );

    expect(response.status).toBe(200);
    expect(saveOpsMock).toHaveBeenCalledTimes(1);
    const saved = saveOpsMock.mock.calls[0][0];
    expect(saved.scopeUserId).toBe("user-1");
    expect(saved.confirmedAt).toEqual(expect.any(String));
    expect(saved.html).toContain("Jackson Sweet");
    // Logo comes from the company record — never from the request body.
    expect(saved.html).toContain("https://cdn.example.com/canpro.png");
    expect(saved.html).toContain("<table");
    expect(saved.text).toBe(
      "Jackson Sweet\nOwner, Canpro Deck and Rail\n(250) 538-8994\ncanprodeckandrail.com"
    );
  });

  it("honors the stacked arrangement when the operator picks it", async () => {
    await PUT(
      jsonRequest("PUT", {
        fields: { name: "Jackson Sweet", companyName: "Canpro" },
        includeLogo: true,
        layout: "stacked",
      })
    );

    expect(saveOpsMock.mock.calls[0][0].html).not.toContain("<table");
  });

  it("defaults an unrecognized arrangement to the business-card layout", async () => {
    await PUT(
      jsonRequest("PUT", {
        fields: { name: "Jackson Sweet", companyName: "Canpro" },
        includeLogo: true,
        layout: "diagonal",
      })
    );

    expect(saveOpsMock.mock.calls[0][0].html).toContain("<table");
  });

  it("never puts a caller-supplied image into the signature", async () => {
    await PUT(
      jsonRequest("PUT", {
        fields: {
          name: "Jackson Sweet",
          companyName: "Canpro",
          logoUrl: "https://tracker.example.com/beacon.gif",
        },
        includeLogo: true,
      })
    );

    const saved = saveOpsMock.mock.calls[0][0];
    expect(saved.html).not.toContain("tracker.example.com");
    expect(saved.html).toContain("https://cdn.example.com/canpro.png");
  });

  it("leaves the logo out when the operator turns it off", async () => {
    await PUT(
      jsonRequest("PUT", {
        fields: { name: "Jackson Sweet", companyName: "Canpro" },
        includeLogo: false,
      })
    );

    expect(saveOpsMock.mock.calls[0][0].html).not.toContain("<img");
  });

  it("rejects a structured save with no name", async () => {
    const response = await PUT(
      jsonRequest("PUT", { fields: { name: "  ", companyName: "Canpro" } })
    );

    expect(response.status).toBe(400);
    expect(saveOpsMock).not.toHaveBeenCalled();
  });

  it("still accepts the legacy plain-text save and confirms it", async () => {
    const response = await PUT(jsonRequest("PUT", { opsText: "Jackson\nOPS" }));

    expect(response.status).toBe(200);
    expect(saveOpsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Jackson\nOPS",
        confirmedAt: expect.any(String),
      })
    );
  });

  it("stores the outreach subject trimmed, and blanks it to null", async () => {
    await PUT(jsonRequest("PUT", { outreachSubject: "  Canpro Estimate  " }));
    expect(updateConnectionMock).toHaveBeenCalledWith("connection-1", {
      outreachSubject: "Canpro Estimate",
    });

    updateConnectionMock.mockClear();
    await PUT(jsonRequest("PUT", { outreachSubject: "   " }));
    expect(updateConnectionMock).toHaveBeenCalledWith("connection-1", {
      outreachSubject: null,
    });
  });

  it("saves the signature and the subject in one action", async () => {
    const response = await PUT(
      jsonRequest("PUT", {
        fields: { name: "Jackson Sweet", companyName: "Canpro" },
        outreachSubject: "Canpro Estimate",
      })
    );

    expect(response.status).toBe(200);
    expect(saveOpsMock).toHaveBeenCalledTimes(1);
    expect(updateConnectionMock).toHaveBeenCalledTimes(1);
  });

  it("closes the rail's confirmation prompt the moment identity lands", async () => {
    await PUT(
      jsonRequest("PUT", {
        fields: { name: "Jackson Sweet", companyName: "Canpro" },
      })
    );

    expect(resolveIdentityNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        connectionId: "connection-1",
        userId: "user-1",
      })
    );
  });

  it("closes the prompt on a confirmed import too", async () => {
    listActiveMock.mockResolvedValue([
      {
        id: "sig-provider",
        source: "gmail_send_as",
        scopeUserId: null,
        providerIdentity: "user-1@example.com",
        contentHtml: "<div>Jack from Gmail</div>",
        contentText: "Jack from Gmail",
        confirmedAt: null,
      },
    ]);

    await POST(jsonRequest("POST", { action: "confirm_imported" }));

    expect(resolveIdentityNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the prompt open when only the subject was saved", async () => {
    await PUT(jsonRequest("PUT", { outreachSubject: "Canpro Estimate" }));

    expect(resolveIdentityNotificationMock).not.toHaveBeenCalled();
  });

  it("rejects a PUT that asks for nothing at all", async () => {
    const response = await PUT(jsonRequest("PUT", {}));

    expect(response.status).toBe(400);
    expect(saveOpsMock).not.toHaveBeenCalled();
    expect(updateConnectionMock).not.toHaveBeenCalled();
  });

  it("promotes an imported signature into operator scope on confirm", async () => {
    listActiveMock.mockResolvedValue([
      {
        id: "sig-provider",
        source: "gmail_send_as",
        scopeUserId: null,
        providerIdentity: "user-1@example.com",
        contentHtml: "<div>Jack from Gmail</div>",
        contentText: "Jack from Gmail",
        confirmedAt: null,
      },
    ]);

    const response = await POST(
      jsonRequest("POST", { action: "confirm_imported" })
    );

    expect(response.status).toBe(200);
    // The gate only honors operator/mailbox scope, so stamping the provider row
    // would confirm nothing. Promotion is what opens the gate.
    expect(saveOpsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeUserId: "user-1",
        html: "<div>Jack from Gmail</div>",
        text: "Jack from Gmail",
        confirmedAt: expect.any(String),
      })
    );
  });

  it("refuses to confirm an import that is not there", async () => {
    listActiveMock.mockResolvedValue([]);

    const response = await POST(
      jsonRequest("POST", { action: "confirm_imported" })
    );

    expect(response.status).toBe(409);
    expect(saveOpsMock).not.toHaveBeenCalled();
  });

  it("refuses identity writes on a mailbox the actor cannot manage", async () => {
    filterAuthorizedConnectionsMock.mockResolvedValue([]);

    const put = await PUT(
      jsonRequest("PUT", { outreachSubject: "Canpro Estimate" })
    );
    const confirm = await POST(
      jsonRequest("POST", { action: "confirm_imported" })
    );

    expect(put.status).toBe(403);
    expect(confirm.status).toBe(403);
    expect(updateConnectionMock).not.toHaveBeenCalled();
    expect(saveOpsMock).not.toHaveBeenCalled();
  });
});
