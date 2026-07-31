import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  checkPermissionById: vi.fn(),
  createAdapter: vi.fn(),
  executeCommit: vi.fn(),
  getServiceRoleClient: vi.fn(),
  stampCompleted: vi.fn(),
  insertNotification: vi.fn(),
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
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));
vi.mock("@/lib/catalog-setup/phase-c/supabase-commit-adapter", () => ({
  createSupabaseCatalogGuidedCommitAdapter: mocks.createAdapter,
}));
vi.mock("@/lib/catalog-setup/phase-c/commit-service", () => ({
  executeGuidedCatalogCommit: mocks.executeCommit,
}));
vi.mock("@/lib/catalog-setup/commit/completion-notification", () => ({
  stampCatalogSetupCompleted: mocks.stampCompleted,
  insertCatalogReadyNotification: mocks.insertNotification,
}));

import { POST } from "../route";

const context = {
  params: Promise.resolve({
    sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
  }),
};

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/catalog/setup/sessions/54ce9e88-5688-4e73-ae4e-a62f85044b77/commit",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

describe("POST guided catalog commit", () => {
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
    mocks.createAdapter.mockReturnValue({ adapter: true });
    mocks.executeCommit.mockResolvedValue({
      ok: true,
      status: "complete",
      replayed: false,
      operationId: "b16d488a-80bb-4a12-a318-359c46eb7c5c",
      readback: { products: 2, status: "verified" },
      blockers: [],
    });
    mocks.getServiceRoleClient.mockReturnValue({ service: true });
    mocks.stampCompleted.mockResolvedValue({ error: null });
    mocks.insertNotification.mockResolvedValue({ error: null });
  });

  it("accepts only session and reviewed-plan identity from the browser", async () => {
    const response = await POST(
      request({
        token: "valid-token",
        approvalHash: "sha256:reviewed",
        actions: [{ actionType: "delete_everything" }],
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.createAdapter).toHaveBeenCalledWith({
      token: "valid-token",
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      operatorId: "d82114aa-7b98-4439-85f0-978f835e0627",
    });
    expect(mocks.executeCommit).toHaveBeenCalledWith({
      sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      approvalHash: "sha256:reviewed",
      adapter: { adapter: true },
    });
    expect(mocks.executeCommit.mock.calls[0][0]).not.toHaveProperty("actions");
  });

  it("returns exact attention state without claiming success", async () => {
    mocks.executeCommit.mockResolvedValue({
      ok: false,
      status: "attention",
      replayed: false,
      operationId: "b16d488a-80bb-4a12-a318-359c46eb7c5c",
      readback: { products: 2 },
      blockers: [
        {
          code: "variant_has_references",
          references: { catalog_stock_units: 1 },
        },
      ],
    });

    const response = await POST(
      request({
        token: "valid-token",
        approvalHash: "sha256:reviewed",
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.status).toBe("attention");
    expect(body.blockers[0].references).toEqual({
      catalog_stock_units: 1,
    });
    expect(mocks.stampCompleted).not.toHaveBeenCalled();
  });

  it("requires both catalog permissions", async () => {
    mocks.checkPermissionById
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const response = await POST(
      request({
        token: "valid-token",
        approvalHash: "sha256:reviewed",
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.executeCommit).not.toHaveBeenCalled();
  });

  it("does not repeat completion side effects when the commit is replayed", async () => {
    mocks.executeCommit.mockResolvedValue({
      ok: true,
      status: "complete",
      replayed: true,
      operationId: "b16d488a-80bb-4a12-a318-359c46eb7c5c",
      readback: { products: 2, status: "verified" },
      blockers: [],
    });

    const response = await POST(
      request({
        token: "valid-token",
        approvalHash: "sha256:reviewed",
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.stampCompleted).not.toHaveBeenCalled();
    expect(mocks.insertNotification).not.toHaveBeenCalled();
  });
});
