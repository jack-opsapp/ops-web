import { describe, expect, it, vi } from "vitest";

import {
  SupplierBillAccountingService,
  buildPaidExpenseCommand,
} from "../service";
import type { CanonicalSupplierBillCapture } from "../contracts";

const ACTOR = {
  actorUserId: "10000000-0000-4000-8000-000000000001",
  companyId: "10000000-0000-4000-8000-000000000002",
  idToken: "verified-token",
};

function canonicalPaid(): CanonicalSupplierBillCapture {
  return {
    requestId: "10000000-0000-4000-8000-000000000003",
    idempotencyKey: "paid-fixture",
    companyId: ACTOR.companyId,
    actorUserId: ACTOR.actorUserId,
    route: "expense",
    status: "paid",
    supplier: {
      displayName: "Example Supply",
      normalizedName: "example supply",
      email: null,
      phone: null,
      taxNumber: null,
    },
    invoiceNumber: "INV-1",
    normalizedInvoiceNumber: "INV-1",
    invoiceDate: "2026-08-01",
    dueDate: null,
    currency: "CAD",
    categoryId: "10000000-0000-4000-8000-000000000004",
    subtotal: "100.00",
    taxTotal: "5.00",
    total: "105.00",
    balance: "0.00",
    notes: null,
    lineItems: [
      {
        position: 1,
        sku: null,
        description: "Materials",
        quantity: "1",
        unitPrice: "100.00",
        subtotal: "100.00",
        taxAmount: "5.00",
        total: "105.00",
        categoryId: "10000000-0000-4000-8000-000000000004",
        allocations: [
          {
            projectId: "10000000-0000-4000-8000-000000000005",
            amount: "70.00",
          },
          {
            projectId: "10000000-0000-4000-8000-000000000006",
            amount: "35.00",
          },
        ],
      },
    ],
    sourceDocument: {
      bucket: "bucket",
      objectKey: `${ACTOR.companyId}/supplier-bills/source.pdf`,
      publicUrl: "https://example.test/source.pdf",
      originalFilename: "source.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: "a".repeat(64),
    },
    paidPurchase: {
      expenseId: "10000000-0000-4000-8000-000000000007",
      paymentMethod: "company_card",
      paidDate: "2026-08-12",
    },
    projectIds: [
      "10000000-0000-4000-8000-000000000005",
      "10000000-0000-4000-8000-000000000006",
    ],
    confirmationText: "RECORD PAID PURCHASE INV-1 FOR CAD 105.00",
  };
}

describe("supplier bill accounting service", () => {
  it("builds the existing expense command with exact multi-job percentages", () => {
    const expense = buildPaidExpenseCommand(canonicalPaid());
    expect(expense.expense_date).toBe("2026-08-12");
    expect(expense.receipt_image_url).toBe("https://example.test/source.pdf");
    expect(expense.submit).toBe(true);
    expect(expense.allocations).toEqual([
      {
        project_id: "10000000-0000-4000-8000-000000000005",
        percentage: 66.666667,
        amount: null,
      },
      {
        project_id: "10000000-0000-4000-8000-000000000006",
        percentage: 33.333333,
        amount: null,
      },
    ]);
  });

  it("commits paid documents through save_expense_atomic then fresh finalization", async () => {
    const paid = canonicalPaid();
    const adminRpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { requiresExpenseCommit: true, command: paid },
        error: null,
      })
      .mockResolvedValueOnce({ data: { entityKind: "expense" }, error: null });
    const actorRpc = vi.fn().mockResolvedValue({
      data: { id: paid.paidPurchase?.expenseId },
      error: null,
    });
    const service = new SupplierBillAccountingService(ACTOR, {
      adminClient: { rpc: adminRpc },
      actorClient: { rpc: actorRpc },
      storeDocument: vi.fn(),
      removeDocument: vi.fn(),
    });

    await expect(
      service.commit({
        intentId: "intent",
        confirmationText: paid.confirmationText,
      })
    ).resolves.toEqual({ entityKind: "expense" });
    expect(actorRpc).toHaveBeenCalledWith("save_expense_atomic", {
      p_command: expect.objectContaining({
        expense_id: paid.paidPurchase?.expenseId,
      }),
    });
    expect(adminRpc).toHaveBeenLastCalledWith(
      "finalize_paid_supplier_purchase",
      {
        p_actor_user_id: ACTOR.actorUserId,
        p_intent_id: "intent",
        p_expense_receipt: { id: paid.paidPurchase?.expenseId },
      }
    );
  });
});
