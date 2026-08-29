import { describe, expect, it } from "vitest";

import {
  exactExpenseSourceRevisions,
  expenseCollectionProofRef,
  expenseContextEntityProofRef,
  expenseContextEvidenceRef,
  expenseEntityProofRef,
  expenseListEvidenceRef,
  expenseListProofContext,
} from "../expense-proof";
import {
  EXPENSE_ID,
  EXPENSE_READ_AT,
  EXPENSE_SOURCE_REVISIONS,
  expenseSummary,
  getExpenseAuthorization,
  listExpenseAuthorization,
} from "./expense-fixtures";

describe("P2 expense proof material", () => {
  it("accepts only the exact expenses revision vector", () => {
    expect(exactExpenseSourceRevisions(EXPENSE_SOURCE_REVISIONS)).toEqual(
      EXPENSE_SOURCE_REVISIONS
    );
    for (const invalid of [
      [],
      [{ domain: "payments", source_revision: 19 }],
      [...EXPENSE_SOURCE_REVISIONS, ...EXPENSE_SOURCE_REVISIONS],
    ]) {
      expect(() => exactExpenseSourceRevisions(invalid)).toThrow(
        "EXPENSE_REVISION_VECTOR_INVALID"
      );
    }
  });

  it("binds exact authority, query, source work, money, and collection children", async () => {
    const authorization = await listExpenseAuthorization();
    const context = expenseListProofContext({
      authorization,
      cursor: null,
      readAt: EXPENSE_READ_AT,
      sourceRevisions: EXPENSE_SOURCE_REVISIONS,
      sourceInspected: 1,
      sourceHasMore: false,
    });
    const item = expenseSummary();
    const entity = expenseEntityProofRef({ context, item });
    const evidence = expenseListEvidenceRef({ context, item });
    const collection = expenseCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: false,
      children: [
        {
          item_ref: item.expense_ref,
          proof_ref: entity,
          evidence_ref: evidence,
        },
      ],
    });
    expect(entity).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(collection).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(evidence).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
    expect(
      expenseEntityProofRef({
        context,
        item: expenseSummary({
          amount: { amount_minor: 12_346, currency: "CAD" },
          allocations: [
            {
              ...item.allocations[0],
              amount: { amount_minor: 12_346, currency: "CAD" },
            },
          ],
        }),
      })
    ).not.toBe(entity);
  });

  it("binds detail evidence and proof to bounded review disclosure", async () => {
    const authorization = await getExpenseAuthorization();
    const base = {
      expense: expenseSummary(),
      batch: null,
      payout_state: "not_eligible" as const,
      review_reason: null,
    };
    const proof = expenseContextEntityProofRef({
      authorization,
      readAt: EXPENSE_READ_AT,
      sourceRevisions: EXPENSE_SOURCE_REVISIONS,
      sourceInspected: { allocations: 1, batches: 0 },
      result: base,
    });
    const evidence = expenseContextEvidenceRef({
      companyId: authorization.actorContext.companyId,
      expenseId: EXPENSE_ID,
      occurredAt: expenseSummary().updated_at,
    });
    expect(proof).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(evidence).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
  });
});
