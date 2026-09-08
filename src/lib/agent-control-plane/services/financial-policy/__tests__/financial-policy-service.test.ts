import { describe, it, expect, vi } from "vitest";
import { FinancialPolicyService } from "../financial-policy-service";
const identity = {
  actorId: "10000000-0000-4000-8000-000000000001",
  companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
describe("owner financial policy service", () => {
  it("rejects identity spoofing before an RPC", async () => {
    const rpc = vi.fn();
    const service = new FinancialPolicyService(rpc);
    await expect(
      service.decide(identity, {
        action: "revoke",
        policy_id: "50000000-0000-4000-8000-000000000001",
        policy_sha256: `sha256:${"a".repeat(64)}`,
        company_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed when database returns another company", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        data: { company_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        error: null,
      });
    await expect(
      new FinancialPolicyService(rpc).readiness(identity)
    ).rejects.toThrow();
  });
  it("never substitutes client identity or leaks database errors", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        error: { message: "sensitive SQL detail" },
        data: null,
      });
    await expect(
      new FinancialPolicyService(rpc).readiness(identity)
    ).rejects.toThrow("FINANCIAL_POLICY_UNAVAILABLE");
    expect(rpc).toHaveBeenCalledWith(
      "get_financial_policy_readiness_as_actor",
      {
        p_actor: identity.actorId,
        p_company: identity.companyId,
        p_source: null,
      }
    );
  });
});
