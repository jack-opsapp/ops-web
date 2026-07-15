import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getConnectionMock,
  getProviderMock,
  requireEmailCompanyAccessMock,
  resolveEmailSignatureForMessageMock,
  listActiveMock,
  saveOpsMock,
  refreshProviderMock,
  setSupabaseOverrideMock,
} = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  requireEmailCompanyAccessMock: vi.fn(),
  resolveEmailSignatureForMessageMock: vi.fn(),
  listActiveMock: vi.fn(),
  saveOpsMock: vi.fn(),
  refreshProviderMock: vi.fn(),
  setSupabaseOverrideMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
  },
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
  requireEmailCompanyAccess: requireEmailCompanyAccessMock,
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: resolveEmailSignatureForMessageMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: setSupabaseOverrideMock,
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
  requireEmailCompanyAccessMock.mockResolvedValue(null);
  getConnectionMock.mockResolvedValue(foreignIndividualConnection);
  getProviderMock.mockReturnValue({});
  resolveEmailSignatureForMessageMock.mockResolvedValue(null);
  listActiveMock.mockResolvedValue([]);
  saveOpsMock.mockResolvedValue({});
  refreshProviderMock.mockResolvedValue({ status: "not_configured" });
});

describe("email signature route individual-mailbox ownership", () => {
  it("rejects reading another operator's individual mailbox signature", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(resolveEmailSignatureForMessageMock).not.toHaveBeenCalled();
    expect(listActiveMock).not.toHaveBeenCalled();
  });

  it("rejects writing an OPS signature onto another operator's individual mailbox", async () => {
    const response = await PUT(jsonRequest("PUT", { opsText: "Jackson\nOPS" }));

    expect(response.status).toBe(403);
    expect(saveOpsMock).not.toHaveBeenCalled();
  });

  it("rejects importing another operator's provider signature", async () => {
    const response = await POST(
      jsonRequest("POST", { action: "import_provider" })
    );

    expect(response.status).toBe(403);
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
});
