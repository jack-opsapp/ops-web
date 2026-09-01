import { describe, expect, it } from "vitest";

import {
  exactPaymentSourceRevisions,
  paymentCollectionProofRef,
  paymentEntityProofRef,
  paymentListEvidenceRef,
  paymentListProofContext,
} from "../payment-proof";
import {
  PAYMENT_READ_AT,
  PAYMENT_SOURCE_REVISIONS,
  listPaymentAuthorization,
  paymentItem,
} from "./payment-fixtures";

describe("P2 payment proof material", () => {
  it("accepts only payment + sales-document + selected-job revisions", () => {
    expect(exactPaymentSourceRevisions(PAYMENT_SOURCE_REVISIONS)).toEqual(
      PAYMENT_SOURCE_REVISIONS
    );
    for (const invalid of [
      [],
      PAYMENT_SOURCE_REVISIONS.slice(1),
      [
        PAYMENT_SOURCE_REVISIONS[0],
        PAYMENT_SOURCE_REVISIONS[2],
        PAYMENT_SOURCE_REVISIONS[1],
      ],
    ]) {
      expect(() => exactPaymentSourceRevisions(invalid)).toThrow(
        "PAYMENT_REVISION_VECTOR_INVALID"
      );
    }
  });

  it("binds authority path, exact query, source work, money, and collection children", async () => {
    const authorization = await listPaymentAuthorization();
    const context = paymentListProofContext({
      authorization,
      cursor: null,
      readAt: PAYMENT_READ_AT,
      sourceRevisions: PAYMENT_SOURCE_REVISIONS,
      sourceInspected: 1,
      sourceHasMore: false,
    });
    const item = paymentItem();
    const proof = paymentEntityProofRef({
      context,
      item,
      authorityPath: "project",
    });
    const evidence = paymentListEvidenceRef({
      context,
      item,
      authorityPath: "project",
    });
    const collection = paymentCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: false,
      children: [
        {
          payment_ref: item.payment_ref,
          proof_ref: proof,
          evidence_ref: evidence,
        },
      ],
    });
    expect(proof).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(evidence).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
    expect(collection).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(
      paymentEntityProofRef({
        context,
        item: paymentItem({
          amount: { amount_minor: 25_001, currency: "CAD" },
        }),
        authorityPath: "project",
      })
    ).not.toBe(proof);
  });
});
