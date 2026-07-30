import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  checkPermissionById: vi.fn(),
  runGuidedSetupTurn: vi.fn(),
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
vi.mock("@/lib/catalog-setup/phase-c/turn-service", () => ({
  runGuidedSetupTurn: mocks.runGuidedSetupTurn,
  GuidedSetupVersionConflictError: class extends Error {},
}));

import { POST } from "../route";

const context = {
  params: Promise.resolve({
    sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
  }),
};

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/catalog/setup/sessions/54ce9e88-5688-4e73-ae4e-a62f85044b77/turn",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

describe("POST guided catalog session turn", () => {
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
    mocks.runGuidedSetupTurn.mockResolvedValue({
      session: { version: 3, status: "interviewing" },
      turn: {
        kind: "question",
        facts: [],
        question: {
          id: "tax",
          prompt: "Is tax added on top?",
          answerKind: "boolean",
          factKeys: ["product.tax"],
        },
      },
    });
  });

  it("generates from the already-persisted input revision", async () => {
    const response = await POST(
      request({
        token: "valid-token",
        expectedVersion: 2,
        expectedInputRevision: 3,
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.turn.kind).toBe("question");
    expect(mocks.runGuidedSetupTurn).toHaveBeenCalledWith({
      token: "valid-token",
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      operatorId: "d82114aa-7b98-4439-85f0-978f835e0627",
      sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      expectedVersion: 2,
      expectedInputRevision: 3,
    });
  });

  it("rejects a stale or malformed revision before model generation", async () => {
    const response = await POST(
      request({
        token: "valid-token",
        expectedVersion: 2,
        expectedInputRevision: -1,
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.runGuidedSetupTurn).not.toHaveBeenCalled();
  });

  it("requires both catalog permissions", async () => {
    mocks.checkPermissionById
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const response = await POST(
      request({
        token: "valid-token",
        expectedVersion: 0,
        expectedInputRevision: 0,
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.runGuidedSetupTurn).not.toHaveBeenCalled();
  });

  it("ignores a browser-supplied answer and uses only persisted input", async () => {
    const response = await POST(
      request({
        token: "valid-token",
        answer: "This must not reach the model",
        expectedVersion: 2,
        expectedInputRevision: 3,
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.runGuidedSetupTurn).toHaveBeenCalledWith(
      expect.not.objectContaining({ answer: expect.anything() }),
    );
  });
});
