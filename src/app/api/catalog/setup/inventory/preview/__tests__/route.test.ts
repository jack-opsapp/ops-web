import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  checkPermissionById: vi.fn(),
  stageInventoryImport: vi.fn(),
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
vi.mock("@/lib/catalog-setup/inventory/inventory-import-service", () => ({
  stageInventoryImport: mocks.stageInventoryImport,
}));

import { POST } from "../route";

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/catalog/setup/inventory/preview",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST inventory import preview", () => {
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
    mocks.stageInventoryImport.mockResolvedValue({
      importId: "80820545-0d15-459c-a3ca-3bc0fe6f6c27",
      status: "review",
      summary: { rows: 1, matched: 1, needsInput: 0 },
      rows: [],
    });
  });

  it("stages a validated company-scoped spreadsheet", async () => {
    const sheet = {
      headers: ["Item", "Quantity"],
      rows: [{ Item: "DekSmart 2510 Contact", Quantity: "0.5" }],
      lineNumbers: [2],
    };
    const response = await POST(
      request({
        token: "valid-token",
        setupSessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
        sourceName: "inventory.csv",
        sourceMimeType: "text/csv",
        defaultLocation: "Canpro Shop",
        sheet,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.stageInventoryImport).toHaveBeenCalledWith({
      token: "valid-token",
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      operatorId: "d82114aa-7b98-4439-85f0-978f835e0627",
      setupSessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      sourceName: "inventory.csv",
      sourceMimeType: "text/csv",
      sheet,
      defaultLocation: "Canpro Shop",
    });
  });

  it("requires both catalog setup and inventory permissions", async () => {
    mocks.checkPermissionById
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const response = await POST(
      request({
        token: "valid-token",
        sourceName: "inventory.csv",
        sheet: {
          headers: ["Item"],
          rows: [{ Item: "Vinyl" }],
          lineNumbers: [2],
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.stageInventoryImport).not.toHaveBeenCalled();
  });
});
