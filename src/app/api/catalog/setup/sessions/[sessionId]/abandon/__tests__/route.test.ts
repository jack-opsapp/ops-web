import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  checkPermissionById: vi.fn(),
  abandonGuidedSetupSession: vi.fn(),
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
  abandonGuidedSetupSession: mocks.abandonGuidedSetupSession,
  GuidedSetupSessionVersionConflictError: class extends Error {},
}));

import { POST } from "../route";

const context = {
  params: Promise.resolve({
    sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
  }),
};

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/catalog/setup/sessions/54ce9e88-5688-4e73-ae4e-a62f85044b77/abandon",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

describe("POST abandon guided catalog session", () => {
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
    mocks.abandonGuidedSetupSession.mockResolvedValue({
      id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      status: "abandoned",
      version: 3,
    });
  });

  it("retires one authorized optimistic session without deleting it", async () => {
    const response = await POST(
      request({ token: "valid-token", expectedVersion: 2 }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      session: {
        id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
        status: "abandoned",
        version: 3,
      },
    });
    expect(mocks.abandonGuidedSetupSession).toHaveBeenCalledWith({
      token: "valid-token",
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      operatorId: "d82114aa-7b98-4439-85f0-978f835e0627",
      sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      expectedVersion: 2,
    });
  });

  it("rejects a malformed version before changing the session", async () => {
    const response = await POST(
      request({ token: "valid-token", expectedVersion: -1 }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.abandonGuidedSetupSession).not.toHaveBeenCalled();
  });
});
