import { describe, expect, it } from "vitest";

import { MoneySchema } from "@/lib/agent-control-plane/contracts/common";
import {
  EXPENSE_READ_FETCH_LIMIT,
  EXPENSE_READ_MAX_ALLOCATIONS,
  EXPENSE_READ_MAX_PAGE_ITEMS,
  EXPENSE_READ_MAX_SOURCE_ROWS,
  ExpenseAllocationSchema,
  ExpenseSummarySchema,
  GetExpenseContextInputSchema,
  GetExpenseContextResultSchema,
  ListExpensesInputSchema,
  ListExpensesResultSchema,
  P2ExpenseMoneySchema,
  ReimbursementBatchSummarySchema,
  assertNoExpenseForbiddenFields,
} from "@/lib/agent-control-plane/contracts/expenses";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const PROOF = `ops_proof:v1:${"a".repeat(64)}`;
const EVIDENCE = `ops_evidence:v1:${"b".repeat(64)}`;
const READ_AT = "2026-08-22T12:34:56.789Z";
const revisions = [{ domain: "expenses", source_revision: 7 }];
const money = (amount_minor: number) => ({ amount_minor, currency: "CAD" });

function allocation(id = B) {
  return {
    allocation_ref: { kind: "expense_allocation" as const, id },
    project_ref: { kind: "project" as const, id: C },
    percentage_basis_points: 10_000,
    amount: money(12_345),
  };
}

function expense(id = A) {
  return {
    item_kind: "expense" as const,
    expense_ref: { kind: "expense" as const, id },
    submitted_by: {
      team_member_ref: { kind: "team_member" as const, id: B },
      display_name: "Carly Hunter",
      content_kind: "untrusted_business_data" as const,
    },
    category: {
      kind: "category" as const,
      category_ref: { kind: "expense_category" as const, id: C },
      name: "Materials",
      content_kind: "untrusted_business_data" as const,
    },
    merchant_name: "Deck Supply",
    expense_date: "2026-08-20",
    amount: money(12_345),
    tax_amount: money(1_605),
    lifecycle: "submitted" as const,
    batch_ref: null,
    allocations: [allocation()],
    updated_at: READ_AT,
    content_kind: "untrusted_business_data" as const,
  };
}

function batch(id = A) {
  return {
    item_kind: "reimbursement_batch" as const,
    batch_ref: { kind: "expense_batch" as const, id },
    batch_number: "RB-0042",
    submitted_by: {
      team_member_ref: { kind: "team_member" as const, id: B },
      display_name: "Carly Hunter",
      content_kind: "untrusted_business_data" as const,
    },
    period_start: "2026-08-01",
    period_end: "2026-08-15",
    lifecycle: "approved" as const,
    total: money(25_000),
    approved: money(20_000),
    reimbursement_amount: money(20_000),
    paid_at: null,
    disposition: "owed" as const,
    content_kind: "untrusted_business_data" as const,
  };
}

function proof() {
  return { proof_ref: PROOF, read_at: READ_AT, source_revisions: revisions };
}

function expenseEvidence() {
  return {
    evidence_ref: EVIDENCE,
    source_domain: "expenses" as const,
    source_type: "expense" as const,
    occurred_at: READ_AT,
  };
}

describe("P2 expense contracts", () => {
  it("pins the common 25/26/501 read bounds and MoneySchema identity", () => {
    expect(EXPENSE_READ_MAX_PAGE_ITEMS).toBe(25);
    expect(EXPENSE_READ_FETCH_LIMIT).toBe(26);
    expect(EXPENSE_READ_MAX_SOURCE_ROWS).toBe(501);
    expect(EXPENSE_READ_MAX_ALLOCATIONS).toBe(25);
    expect(P2ExpenseMoneySchema).toBe(MoneySchema);
  });

  it("defaults to mine and accepts only the five closed list variants", () => {
    expect(ListExpensesInputSchema.parse({})).toEqual({
      view: { kind: "mine" },
      limit: 25,
    });
    expect(
      ListExpensesInputSchema.parse({
        view: { kind: "job", job_ref: { kind: "project", id: A } },
      }).view
    ).toEqual({ kind: "job", job_ref: { kind: "project", id: A } });
    expect(
      ListExpensesInputSchema.parse({
        view: { kind: "reimbursement_batches", disposition: "paid" },
      }).view
    ).toEqual({ kind: "reimbursement_batches", disposition: "paid" });
    for (const kind of ["company", "pending_approval"] as const) {
      expect(ListExpensesInputSchema.parse({ view: { kind } }).view).toEqual({
        kind,
      });
    }
    expect(() =>
      ListExpensesInputSchema.parse({ view: { kind: "employee", id: B } })
    ).toThrow();
    expect(() =>
      ListExpensesInputSchema.parse({ view: { kind: "company", user_id: B } })
    ).toThrow();
    expect(() => ListExpensesInputSchema.parse({ limit: 26 })).toThrow();
  });

  it("pins exact expense detail input without caller-selected employee or authority", () => {
    expect(
      GetExpenseContextInputSchema.parse({
        expense_ref: { kind: "expense", id: A },
      })
    ).toEqual({ expense_ref: { kind: "expense", id: A } });
    expect(() =>
      GetExpenseContextInputSchema.parse({
        expense_ref: { kind: "expense", id: A },
        approval_scope: "all",
      })
    ).toThrow();
  });

  it("accepts safe category, merchant, allocation, and batch projections", () => {
    expect(ExpenseAllocationSchema.parse(allocation())).toEqual(allocation());
    expect(ExpenseSummarySchema.parse(expense())).toEqual(expense());
    expect(ReimbursementBatchSummarySchema.parse(batch())).toEqual(batch());
  });

  it("rejects non-canonical allocation totals and unlike currencies", () => {
    expect(() =>
      ExpenseAllocationSchema.parse({
        ...allocation(),
        percentage_basis_points: 10_001,
      })
    ).toThrow();
    expect(() =>
      ExpenseSummarySchema.parse({
        ...expense(),
        tax_amount: { amount_minor: 1_605, currency: "USD" },
      })
    ).toThrow();
    expect(() =>
      ExpenseSummarySchema.parse({
        ...expense(),
        allocations: [allocation(B), allocation(C)],
      })
    ).toThrow();
    expect(() =>
      ReimbursementBatchSummarySchema.parse({
        ...batch(),
        approved: { amount_minor: 20_000, currency: "USD" },
      })
    ).toThrow();
  });

  it("accepts a coupled expense list and a reimbursement list without aggregate counts", () => {
    const expenseList = {
      items: [expense()],
      item_proofs: [proof()],
      evidence: [expenseEvidence()],
      collection_proof: {
        ...proof(),
        returned_count: 1,
        has_more: false,
      },
      next_cursor: null,
    };
    expect(ListExpensesResultSchema.parse(expenseList)).toEqual(expenseList);

    const batchList = {
      ...expenseList,
      items: [batch()],
      evidence: [
        {
          ...expenseEvidence(),
          source_type: "expense_batch" as const,
        },
      ],
    };
    expect(ListExpensesResultSchema.parse(batchList)).toEqual(batchList);
    expect(JSON.stringify(batchList)).not.toContain("expense_count");
    expect(() =>
      ListExpensesResultSchema.parse({
        ...batchList,
        items: [{ ...batch(), expense_count: 4 }],
      })
    ).toThrow();
  });

  it("rejects mixed list kinds, proof/evidence mismatch, and non-canonical order", () => {
    const base = {
      items: [expense(A), expense(B)],
      item_proofs: [proof(), proof()],
      evidence: [expenseEvidence(), expenseEvidence()],
      collection_proof: {
        ...proof(),
        returned_count: 2,
        has_more: false,
      },
      next_cursor: null,
    };
    expect(() =>
      ListExpensesResultSchema.parse({
        ...base,
        items: [expense(), batch()],
      })
    ).toThrow();
    expect(() =>
      ListExpensesResultSchema.parse({ ...base, item_proofs: [proof()] })
    ).toThrow();
    expect(() =>
      ListExpensesResultSchema.parse({
        ...base,
        items: [expense(B), expense(A)],
      })
    ).toThrow();
  });

  it("returns bounded exact context and only an authorized review reason projection", () => {
    const result = {
      expense: expense(),
      batch: null,
      payout_state: "not_eligible" as const,
      review_reason: {
        kind: "flag" as const,
        text: "Receipt needs a clearer total.",
        content_kind: "untrusted_business_data" as const,
      },
      evidence: [expenseEvidence()],
      proof: proof(),
    };
    expect(GetExpenseContextResultSchema.parse(result)).toEqual(result);
    expect(() =>
      GetExpenseContextResultSchema.parse({
        ...result,
        review_reason: {
          ...result.review_reason,
          text: "x".repeat(1_001),
        },
      })
    ).toThrow();
  });

  it("forbids receipt, OCR, accounting, payment, notes, actor, and private identity fields recursively", () => {
    for (const forbidden of [
      "receipt_image_url",
      "receipt_state",
      "receipt_thumbnail_url",
      "receipt_storage_path",
      "ocr_data",
      "ocr_merchant_name",
      "accounting_id",
      "accounting_sync_status",
      "payment_method",
      "description",
      "notes",
      "review_notes",
      "approved_by",
      "rejected_by",
      "paid_by",
      "email",
      "phone",
      "employee_count",
      "expense_count",
    ]) {
      expect(() =>
        assertNoExpenseForbiddenFields({ nested: { [forbidden]: "x" } })
      ).toThrow("EXPENSE_FORBIDDEN_FIELD");
    }
    expect(() => assertNoExpenseForbiddenFields(expense())).not.toThrow();
  });
});
