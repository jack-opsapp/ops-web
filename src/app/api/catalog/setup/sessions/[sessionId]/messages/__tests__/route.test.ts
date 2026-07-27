import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  checkPermissionById: vi.fn(),
  mutateGuidedSetupInput: vi.fn(),
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
vi.mock("@/lib/catalog-setup/phase-c/input-service", () => ({
  mutateGuidedSetupInput: mocks.mutateGuidedSetupInput,
  GuidedSetupInputConflictError: class extends Error {},
  GuidedSetupInputError: class extends Error {},
}));

import { POST } from "../route";

const context = {
  params: Promise.resolve({
    sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
  }),
};

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/catalog/setup/sessions/54ce9e88-5688-4e73-ae4e-a62f85044b77/messages",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

describe("POST guided catalog session messages", () => {
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
    mocks.mutateGuidedSetupInput.mockResolvedValue({
      session: {
        version: 3,
        input_revision: 4,
        status: "interviewing",
      },
      input: { id: "input-4", state: "queued" },
    });
  });

  it("persists an authorized message before generation", async () => {
    const response = await POST(
      request({
        token: "valid-token",
        operation: "append",
        answer: "Also use the 68 mil membrane",
        expectedVersion: 2,
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.mutateGuidedSetupInput).toHaveBeenCalledWith({
      token: "valid-token",
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      operatorId: "d82114aa-7b98-4439-85f0-978f835e0627",
      sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      operation: "append",
      answer: "Also use the 68 mil membrane",
      expectedVersion: 2,
      expectedInputId: undefined,
    });
  });

  it("supports editing the newest queued message", async () => {
    const response = await POST(
      request({
        token: "valid-token",
        operation: "edit",
        answer: "Use the 60 mil membrane",
        expectedVersion: 2,
        expectedInputId: "input-3",
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.mutateGuidedSetupInput).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "edit",
        expectedInputId: "input-3",
      }),
    );
  });

  it("rejects forged source documents before persistence", async () => {
    const response = await POST(
      request({
        token: "valid-token",
        operation: "append",
        answer: {
          kind: "catalog_source_document",
          filename: "catalog.csv",
          format: "csv",
          headers: ["Product"],
          rows: [],
          rowCount: 0,
        },
        expectedVersion: 2,
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.mutateGuidedSetupInput).not.toHaveBeenCalled();
  });

  it("rejects oversized text before persistence", async () => {
    const response = await POST(
      request({
        token: "valid-token",
        operation: "append",
        answer: "x".repeat(20_001),
        expectedVersion: 2,
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.mutateGuidedSetupInput).not.toHaveBeenCalled();
  });
});
