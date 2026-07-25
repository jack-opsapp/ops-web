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

  it("persists one authorized optimistic turn", async () => {
    const response = await POST(
      request({
        token: "valid-token",
        answer: "Yes",
        expectedVersion: 2,
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
      answer: "Yes",
      expectedVersion: 2,
    });
  });

  it("rejects a stale or malformed version before model generation", async () => {
    const response = await POST(
      request({ token: "valid-token", answer: "Yes", expectedVersion: -1 }),
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
      request({ token: "valid-token", answer: null, expectedVersion: 0 }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.runGuidedSetupTurn).not.toHaveBeenCalled();
  });

  it("accepts a bounded source document larger than a normal text answer", async () => {
    const answer = {
      kind: "catalog_source_document",
      filename: "catalog.csv",
      format: "csv",
      headers: ["Product", "Description"],
      rows: Array.from({ length: 100 }, (_, index) => ({
        Product: `Catalog item ${index + 1}`,
        Description: "Installed service ".repeat(12),
      })),
      rowCount: 100,
    };
    expect(JSON.stringify(answer).length).toBeGreaterThan(20_000);

    const response = await POST(
      request({
        token: "valid-token",
        answer,
        expectedVersion: 2,
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.runGuidedSetupTurn).toHaveBeenCalledWith(
      expect.objectContaining({ answer }),
    );
  });

  it("rejects a forged or unbounded source document before model generation", async () => {
    const response = await POST(
      request({
        token: "valid-token",
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
    expect(mocks.runGuidedSetupTurn).not.toHaveBeenCalled();
  });
});
