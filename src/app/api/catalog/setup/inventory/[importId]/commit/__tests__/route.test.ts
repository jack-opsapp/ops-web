import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  checkPermissionById: vi.fn(),
  rpc: vi.fn(),
  getAccessTokenClient: vi.fn(),
  insert: vi.fn(),
  getServiceRoleClient: vi.fn(),
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
vi.mock("@/lib/supabase/accessToken-client", () => ({
  getAccessTokenClient: mocks.getAccessTokenClient,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

import { POST } from "../route";

const context = {
  params: Promise.resolve({
    importId: "80820545-0d15-459c-a3ca-3bc0fe6f6c27",
  }),
};

function request() {
  return new NextRequest(
    "http://localhost/api/catalog/setup/inventory/80820545-0d15-459c-a3ca-3bc0fe6f6c27/commit",
    {
      method: "POST",
      body: JSON.stringify({ token: "valid-token" }),
      headers: { "content-type": "application/json" },
    },
  );
}

describe("POST inventory import commit", () => {
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
    mocks.rpc.mockResolvedValue({
      data: { ok: true, status: "complete", committed: 3 },
      error: null,
    });
    mocks.getAccessTokenClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.getServiceRoleClient.mockReturnValue({
      from: () => ({ insert: mocks.insert }),
    });
  });

  it("commits only the server-staged import id", async () => {
    const response = await POST(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.committed).toBe(3);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "catalog_inventory_import_commit",
      { p_import_id: "80820545-0d15-459c-a3ca-3bc0fe6f6c27" },
    );
  });

  it("returns review blockers without claiming stock was added", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ok: false,
        status: "review",
        blockers: [{ code: "inventory_rows_need_input" }],
      },
      error: null,
    });

    const response = await POST(request(), context);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.blockers[0].code).toBe("inventory_rows_need_input");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("returns the original count without sending another notification on replay", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ok: true,
        status: "complete",
        committed: 7,
        replayed: true,
      },
      error: null,
    });

    const response = await POST(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.committed).toBe(7);
    expect(body.replayed).toBe(true);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
