import { describe, expect, it } from "vitest";

import {
  SupplierBillContractError,
  canonicalizeSupplierBillCapture,
} from "../contracts";

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000002";
const CATEGORY_ID = "10000000-0000-4000-8000-000000000003";
const PROJECT_A = "10000000-0000-4000-8000-000000000004";
const PROJECT_B = "10000000-0000-4000-8000-000000000005";

function unpaidFixture() {
  return {
    requestId: "10000000-0000-4000-8000-000000000006",
    idempotencyKey: "supplier-bill:fixture:42995:v1",
    companyId: COMPANY_ID,
    actorUserId: ACTOR_ID,
    supplier: {
      displayName: "  Example   Vinyl Products  ",
      email: "ap@example.test",
      phone: null,
      taxNumber: null,
    },
    invoiceNumber: " inv-42995 ",
    invoiceDate: "2026-08-25",
    dueDate: null,
    currency: "cad",
    categoryId: CATEGORY_ID,
    subtotal: "2366.92",
    taxTotal: "118.35",
    total: "2485.27",
    balance: "2485.27",
    notes: null,
    lineItems: [
      {
        position: 1,
        sku: "VINYL-A",
        description: "Vinyl membrane — project A",
        quantity: "66",
        unitPrice: "16.92",
        subtotal: "1116.72",
        taxAmount: "55.84",
        total: "1172.56",
        categoryId: null,
        allocations: [{ projectId: PROJECT_A, amount: "1172.56" }],
      },
      {
        position: 2,
        sku: "VINYL-B",
        description: "Vinyl membrane — project B",
        quantity: "35",
        unitPrice: "16.92",
        subtotal: "592.20",
        taxAmount: "29.61",
        total: "621.81",
        categoryId: null,
        allocations: [{ projectId: PROJECT_B, amount: "621.81" }],
      },
      {
        position: 3,
        sku: null,
        description: "Adhesive and freight",
        quantity: "1",
        unitPrice: "658.00",
        subtotal: "658.00",
        taxAmount: "32.90",
        total: "690.90",
        categoryId: null,
        allocations: [
          { projectId: PROJECT_A, amount: "345.45" },
          { projectId: PROJECT_B, amount: "345.45" },
        ],
      },
    ],
    sourceDocument: {
      bucket: "ops-app-files-prod",
      objectKey: `${COMPANY_ID}/supplier-bills/fixture.pdf`,
      publicUrl: `https://cdn.example.test/${COMPANY_ID}/supplier-bills/fixture.pdf`,
      originalFilename: "supplier-invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42_000,
      sha256: "a".repeat(64),
    },
    paidPurchase: null,
  } as const;
}

describe("supplier bill capture contract", () => {
  it("canonicalizes an unpaid, two-job invoice without inventing a due date", () => {
    const result = canonicalizeSupplierBillCapture(unpaidFixture());

    expect(result.route).toBe("supplier_bill");
    expect(result.supplier.displayName).toBe("Example Vinyl Products");
    expect(result.supplier.normalizedName).toBe("example vinyl products");
    expect(result.invoiceNumber).toBe("inv-42995");
    expect(result.normalizedInvoiceNumber).toBe("INV-42995");
    expect(result.currency).toBe("CAD");
    expect(result.dueDate).toBeNull();
    expect(result.status).toBe("open");
    expect(result.projectIds).toEqual([PROJECT_A, PROJECT_B]);
    expect(result.confirmationText).toBe(
      "RECORD BILL INV-42995 FOR CAD 2,485.27"
    );
  });

  it("routes a zero-balance document through the existing paid-expense path", () => {
    const input = unpaidFixture();
    const result = canonicalizeSupplierBillCapture({
      ...input,
      balance: "0.00",
      paidPurchase: {
        expenseId: "10000000-0000-4000-8000-000000000007",
        paymentMethod: "company_card",
        paidDate: "2026-08-25",
      },
    });

    expect(result.route).toBe("expense");
    expect(result.status).toBe("paid");
    expect(result.confirmationText).toBe(
      "RECORD PAID PURCHASE INV-42995 FOR CAD 2,485.27"
    );
  });

  it("rejects total arithmetic that does not match the source document", () => {
    expect(() =>
      canonicalizeSupplierBillCapture({ ...unpaidFixture(), total: "2485.26" })
    ).toThrowError(
      new SupplierBillContractError(
        "amount_mismatch",
        "Bill subtotal plus tax must equal total."
      )
    );
  });

  it("requires every line to be fully allocated without cross-line leakage", () => {
    const input = unpaidFixture();
    expect(() =>
      canonicalizeSupplierBillCapture({
        ...input,
        lineItems: input.lineItems.map((line, index) =>
          index === 0
            ? {
                ...line,
                allocations: [{ projectId: PROJECT_A, amount: "1.00" }],
              }
            : line
        ),
      })
    ).toThrowError(
      new SupplierBillContractError(
        "allocation_mismatch",
        "Every line allocation must equal that line's total."
      )
    );
  });

  it("rejects a due date before the invoice date", () => {
    expect(() =>
      canonicalizeSupplierBillCapture({
        ...unpaidFixture(),
        dueDate: "2026-08-24",
      })
    ).toThrowError(
      new SupplierBillContractError(
        "invalid_due_date",
        "Due date cannot be before the invoice date."
      )
    );
  });
});
