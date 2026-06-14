import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { verifyAuthToken, findUserByAuth, checkPermissionById, generate } = vi.hoisted(
  () => ({
    verifyAuthToken: vi.fn(),
    findUserByAuth: vi.fn(),
    checkPermissionById: vi.fn(),
    generate: vi.fn(),
  }),
);

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAuthToken }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: [] }) }),
    }),
  }),
}));
vi.mock("@/lib/catalog-setup/agent/setup-agent-service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateCatalogProposals: generate,
}));

import { POST } from "../route";
import { SetupAgentConfigError } from "@/lib/catalog-setup/agent/setup-agent-service";

const makeReq = (body: unknown): NextRequest =>
  ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthToken.mockResolvedValue({ uid: "fb-1", email: "op@co.com" });
  findUserByAuth.mockResolvedValue({ id: "u-1", company_id: "co-1" });
  checkPermissionById.mockResolvedValue(true);
});

describe("POST /api/catalog/setup/agent", () => {
  it("turns generated proposals into validated staging cards", async () => {
    generate.mockResolvedValue({
      proposals: [
        { module: "SELL", name: "Tear-off", default_price: 350, is_taxable: true, kind: "service", type: "LABOR" },
        // invalid: price 0 → dropped by the validator, never a broken card
        { module: "SELL", name: "Bad", default_price: 0, is_taxable: true, kind: "service", type: "LABOR" },
        { module: "TYPES", trade: "roofing" },
      ],
    });
    const res = await POST(makeReq({ token: "t", description: "I install roofs" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cards).toHaveLength(2); // valid SELL + TYPES
    expect(json.cards.every((c: { source: string }) => c.source === "agent")).toBe(true);
    expect(json.rejected).toHaveLength(1);
  });

  it("400 when description is blank", async () => {
    const res = await POST(makeReq({ token: "t", description: "   " }));
    expect(res.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it("403 without catalog.run_setup", async () => {
    checkPermissionById.mockResolvedValue(false);
    const res = await POST(makeReq({ token: "t", description: "x" }));
    expect(res.status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });

  it("503 with a guided fallback when the API key is missing", async () => {
    generate.mockRejectedValue(new SetupAgentConfigError("OPENAI_API_KEY is not configured"));
    const res = await POST(makeReq({ token: "t", description: "x" }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.fallback).toBe("guided");
  });
});
