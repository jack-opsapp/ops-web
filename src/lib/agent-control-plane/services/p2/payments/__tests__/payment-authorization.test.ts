import { describe, expect, it } from "vitest";

import { ListPaymentsInputSchema } from "@/lib/agent-control-plane/contracts/sales-documents";
import {
  authorizeListPaymentsRead,
  isAuthorizedListPaymentsRead,
  PaymentReadAuthorizationError,
} from "../payment-authorization";
import {
  listPaymentAuthorization,
  paymentCandidateAuthorization,
} from "./payment-fixtures";

describe("P2 payment authorization", () => {
  it("mints exact full-finance payment authority for all and assigned invoices", async () => {
    const all = await listPaymentAuthorization();
    expect(isAuthorizedListPaymentsRead(all)).toBe(true);
    expect(all.authorizationCandidate).toMatchObject({
      variantKey: "payment",
      financeScope: "all",
      invoiceScope: "all",
      pipelineScope: "all",
      projectsScope: "all",
      satisfiedPermissionGroupIndexes: [0, 1, 2],
    });
    const assigned = await listPaymentAuthorization(
      {},
      {
        "finances.view": "all",
        "invoices.view": "assigned",
        "projects.view": "assigned",
      }
    );
    expect(assigned.authorizationCandidate).toMatchObject({
      financeScope: "all",
      invoiceScope: "assigned",
      pipelineScope: null,
      projectsScope: "assigned",
      satisfiedPermissionGroupIndexes: [1],
    });
    expect(Object.isFrozen(assigned)).toBe(true);
    expect(Object.isFrozen(assigned.authorizationCandidate)).toBe(true);
  });

  it("rejects assigned finance, absent finance, missing job scope, wrong OAuth, and borrowed proofs", async () => {
    for (const permissions of [
      { "finances.view": "assigned", "invoices.view": "all" },
      { "finances.view": null, "invoices.view": "all" },
      { "finances.view": "all", "invoices.view": "assigned" },
    ] as const) {
      await expect(
        listPaymentAuthorization({}, permissions)
      ).rejects.toBeTruthy();
    }
    await expect(
      paymentCandidateAuthorization({
        oauthScopes: ["ops.financial_documents.read"],
      })
    ).rejects.toBeTruthy();

    const query = ListPaymentsInputSchema.parse({});
    const nominal = await paymentCandidateAuthorization();
    for (const authorizations of [
      {},
      { payment: { ...nominal } },
      { payment: nominal, extra: nominal },
    ]) {
      expect(() =>
        authorizeListPaymentsRead({ query, authorizations })
      ).toThrow(PaymentReadAuthorizationError);
    }
  });
});
