import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const { authenticate, rpc } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../../_lib/auth", () => ({
  authenticateRequest: authenticate,
  isErrorResponse: (value: unknown) => value instanceof Response,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc }),
}));
import { GET, POST } from "../route";
const identity = {
  id: "10000000-0000-4000-8000-000000000001",
  companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
describe("financial policy HTTP authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue(identity);
  });
  it("requires authentication before parsing a body or reading policy", async () => {
    authenticate.mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 })
    );
    expect(
      (
        await POST(
          new NextRequest(
            "https://example.invalid/api/agent/financial-policy",
            { method: "POST", body: "not json" }
          )
        )
      ).status
    ).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects oversized and identity-bearing requests before any RPC", async () => {
    for (const body of [
      "x".repeat(65537),
      JSON.stringify({
        action: "revoke",
        policy_id: "50000000-0000-4000-8000-000000000001",
        policy_sha256: `sha256:${"a".repeat(64)}`,
        company_id: identity.companyId,
      }),
    ]) {
      expect(
        (
          await POST(
            new NextRequest(
              "https://example.invalid/api/agent/financial-policy",
              { method: "POST", body }
            )
          )
        ).status
      ).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("binds source reads to the authenticated company and masks errors", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "private SQL detail" },
    });
    const result = await GET(
      new NextRequest(
        "https://example.invalid/api/agent/financial-policy?company_id=foreign"
      )
    );
    expect(rpc).toHaveBeenCalledWith(
      "get_financial_policy_readiness_as_actor",
      { p_actor: identity.id, p_company: identity.companyId, p_source: null }
    );
    expect(await result.json()).toEqual({
      error: "FINANCIAL_POLICY_UNAVAILABLE",
    });
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  });
});
