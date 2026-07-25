import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  checkPermissionById: vi.fn(),
  startOrResumeGuidedSetupSession: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: mocks.verifyAuthToken,
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: mocks.findUserByAuth,
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: mocks.checkPermissionById,
}));
vi.mock("@/lib/catalog-setup/phase-c/session-service", () => ({
  startOrResumeGuidedSetupSession: mocks.startOrResumeGuidedSetupSession,
}));

import { POST } from "../route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/catalog/setup/sessions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/catalog/setup/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAuthToken.mockResolvedValue({
      uid: "firebase-user",
      email: "operator@example.com",
    });
    mocks.findUserByAuth.mockResolvedValue({
      id: "d82114aa-7b98-4439-85f0-978f835e0627",
      company_id: "a612edc0-5c18-4c4d-af97-55b9410dd077",
    });
    mocks.checkPermissionById.mockResolvedValue(true);
    mocks.startOrResumeGuidedSetupSession.mockResolvedValue({
      resumed: false,
      session: {
        id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
        status: "interviewing",
      },
    });
  });

  it("starts a company-scoped session for an authorized catalog operator", async () => {
    const response = await POST(request({ token: "valid-token" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session.status).toBe("interviewing");
    expect(mocks.startOrResumeGuidedSetupSession).toHaveBeenCalledWith({
      token: "valid-token",
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      operatorId: "d82114aa-7b98-4439-85f0-978f835e0627",
    });
  });

  it("requires both catalog.view and catalog.run_setup", async () => {
    mocks.checkPermissionById
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const response = await POST(request({ token: "valid-token" }));

    expect(response.status).toBe(403);
    expect(mocks.startOrResumeGuidedSetupSession).not.toHaveBeenCalled();
  });

  it("rejects a request without an auth token before reading company data", async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(400);
    expect(mocks.verifyAuthToken).not.toHaveBeenCalled();
  });
});
