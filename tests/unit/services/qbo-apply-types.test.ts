// tests/unit/services/qbo-apply-types.test.ts
import { describe, it, expect } from "vitest";
import type {
  MatchAction,
  QboApplyDecision,
  QboApplyResult,
} from "@/lib/types/qbo-import";

describe("QBO apply type contract", () => {
  it("MatchAction admits the four locked actions", () => {
    const actions: MatchAction[] = ["link", "create", "skip", "needs_review"];
    expect(actions).toHaveLength(4);
  });

  it("QboApplyDecision carries customer_qb_id + action + optional client_id", () => {
    const d: QboApplyDecision = {
      customer_qb_id: "QB-CUST-1",
      action: "link",
      client_id: "11111111-1111-1111-1111-111111111111",
    };
    expect(d.action).toBe("link");
    const created: QboApplyDecision = { customer_qb_id: "QB-CUST-2", action: "create" };
    expect(created.client_id).toBeUndefined();
  });

  it("QboApplyResult exposes per-entity applied counts + qb_write_calls=0", () => {
    const r: QboApplyResult = {
      clientsLinked: 1,
      clientsCreated: 2,
      clientsSkipped: 0,
      estimatesUpserted: 3,
      invoicesUpserted: 4,
      lineItemsInserted: 10,
      paymentsUpserted: 5,
      invoicesReconciled: 4,
      qb_write_calls: 0,
    };
    expect(r.qb_write_calls).toBe(0);
    expect(r.invoicesReconciled).toBe(r.invoicesUpserted);
  });
});
