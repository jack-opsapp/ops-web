import { describe, expect, it } from "vitest";

import {
  SupplierBillIntakeContractError,
  canonicalizeAllocationOverride,
  canonicalizeSupplierBillIntakeDraft,
  deriveSupplierBillIntakeStage,
  proportionalSharedChargeAllocations,
  requiredChecksForDocument,
  resolveJobMatch,
} from "../intake-contracts";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_A = "10000000-0000-4000-8000-000000000002";
const PROJECT_B = "10000000-0000-4000-8000-000000000003";

function clearedChecks(kind: "material" | "subcontractor" = "material") {
  return requiredChecksForDocument(kind).map((key) => ({
    key,
    outcome: "clear" as const,
    disposition: "accepted" as const,
    note: null,
  }));
}

describe("supplier bill intake contract", () => {
  it.each([
    [
      "material",
      [
        "rate_compliance",
        "duplicate_billing",
        "quantity_scope",
        "order_specification",
        "receipt",
      ],
    ],
    [
      "subcontractor",
      ["rate_compliance", "duplicate_billing", "quantity_scope"],
    ],
    ["employee", ["duplicate_billing"]],
  ] as const)(
    "requires the right clearance checks for %s invoices",
    (kind, keys) => {
      expect(requiredChecksForDocument(kind)).toEqual(keys);
    }
  );

  it.each([
    [
      "review",
      {
        documentKind: "material",
        checks: clearedChecks(),
        approvedAt: null,
        paidAt: null,
        holdReason: null,
        nextAction: null,
        paymentOwnerId: null,
        plannedPaymentDate: null,
      },
    ],
    [
      "to_pay",
      {
        documentKind: "material",
        checks: clearedChecks(),
        approvedAt: "2026-09-03T20:00:00.000Z",
        paidAt: null,
        holdReason: null,
        nextAction: null,
        paymentOwnerId: OWNER_ID,
        plannedPaymentDate: "2026-09-13",
      },
    ],
    [
      "paid",
      {
        documentKind: "material",
        checks: clearedChecks(),
        approvedAt: "2026-09-03T20:00:00.000Z",
        paidAt: "2026-09-13T20:00:00.000Z",
        holdReason: null,
        nextAction: null,
        paymentOwnerId: OWNER_ID,
        plannedPaymentDate: "2026-09-13",
      },
    ],
    [
      "held",
      {
        documentKind: "material",
        checks: [
          ...clearedChecks().slice(0, 2),
          {
            key: "quantity_scope",
            outcome: "exception",
            disposition: "held",
            note: "Confirm installed square footage with the foreman.",
          },
          ...clearedChecks().slice(3),
        ],
        approvedAt: null,
        paidAt: null,
        holdReason: "Quantity exceeds the confirmed site measure.",
        nextAction: "Jared confirms the installed square footage.",
        paymentOwnerId: null,
        plannedPaymentDate: null,
      },
    ],
    [
      "payroll",
      {
        documentKind: "employee",
        checks: [],
        approvedAt: null,
        paidAt: null,
        holdReason: null,
        nextAction: null,
        paymentOwnerId: null,
        plannedPaymentDate: null,
      },
    ],
  ] as const)(
    "derives the %s stage from durable review state",
    (stage, state) => {
      expect(deriveSupplierBillIntakeStage(state)).toBe(stage);
    }
  );

  it("blocks approval while a required exception has no human disposition", () => {
    const checks = clearedChecks("subcontractor");
    checks[0] = {
      key: "rate_compliance",
      outcome: "exception",
      disposition: "unresolved",
      note: null,
    };

    expect(() =>
      deriveSupplierBillIntakeStage({
        documentKind: "subcontractor",
        checks,
        approvedAt: "2026-09-03T20:00:00.000Z",
        paidAt: null,
        holdReason: null,
        nextAction: null,
        paymentOwnerId: OWNER_ID,
        plannedPaymentDate: "2026-09-13",
      })
    ).toThrowError(
      new SupplierBillIntakeContractError(
        "unresolved_checks",
        "Every required clearance check needs a disposition before approval."
      )
    );
  });

  it("requires a reason and next action for a held document", () => {
    expect(() =>
      deriveSupplierBillIntakeStage({
        documentKind: "material",
        checks: clearedChecks(),
        approvedAt: null,
        paidAt: null,
        holdReason: "Quantity mismatch.",
        nextAction: null,
        paymentOwnerId: null,
        plannedPaymentDate: null,
      })
    ).toThrowError(
      new SupplierBillIntakeContractError(
        "incomplete_hold",
        "A held bill needs a reason and next action."
      )
    );
  });

  it("keeps a missing supplier due date null and a payment target separate", () => {
    const result = canonicalizeSupplierBillIntakeDraft({
      documentKind: "material",
      supplierName: "  DeksMart   Vinyl Products ",
      invoiceNumber: " 43066 ",
      invoiceDate: "2026-08-25",
      dueDate: null,
      plannedPaymentDate: "2026-09-13",
      purchaseOrder: null,
      shippingReference: "Tracking 123",
      currency: "cad",
      subtotal: "100.00",
      taxTotal: "5.00",
      total: "105.00",
      lines: [
        {
          position: 1,
          sku: "VINYL-60-SMOOTH",
          description: "60 mil smooth vinyl",
          orderedQuantity: "62.5",
          invoicedQuantity: "63",
          unitOfMeasure: "SQFT",
          unitPrice: "2.25",
          subtotal: "100.00",
          taxAmount: "5.00",
          total: "105.00",
          jobHint: "123 Sample Street",
        },
      ],
    });

    expect(result).toMatchObject({
      supplierName: "DeksMart Vinyl Products",
      normalizedSupplierName: "deksmart vinyl products",
      invoiceNumber: "43066",
      dueDate: null,
      plannedPaymentDate: "2026-09-13",
      currency: "CAD",
      shippingReference: "Tracking 123",
    });
    expect(result.lines[0]).toMatchObject({
      orderedQuantity: "62.5",
      invoicedQuantity: "63",
      unitOfMeasure: "SQFT",
      jobHint: "123 Sample Street",
    });
  });

  it("allocates a shared charge proportionally with an exact-cent remainder", () => {
    expect(
      proportionalSharedChargeAllocations("690.90", [
        { projectId: PROJECT_A, materialSubtotal: "1116.72" },
        { projectId: PROJECT_B, materialSubtotal: "592.20" },
      ])
    ).toEqual([
      { projectId: PROJECT_A, amount: "451.48" },
      { projectId: PROJECT_B, amount: "239.42" },
    ]);
  });

  it("accepts a human allocation override only when it balances exactly", () => {
    expect(
      canonicalizeAllocationOverride("690.90", [
        { projectId: PROJECT_A, amount: "400.00" },
        { projectId: PROJECT_B, amount: "290.90" },
      ])
    ).toEqual([
      { projectId: PROJECT_A, amount: "400.00" },
      { projectId: PROJECT_B, amount: "290.90" },
    ]);

    expect(() =>
      canonicalizeAllocationOverride("690.90", [
        { projectId: PROJECT_A, amount: "400.00" },
        { projectId: PROJECT_B, amount: "290.89" },
      ])
    ).toThrowError(
      new SupplierBillIntakeContractError(
        "allocation_mismatch",
        "Project allocations must equal the line total."
      )
    );
  });

  it("keeps address and PO matches as suggestions until a person confirms them", () => {
    expect(
      resolveJobMatch({
        projectId: PROJECT_A,
        basis: "address",
        sourceValue: "123 Sample Street",
        confirmedByUser: false,
      })
    ).toEqual({
      projectId: PROJECT_A,
      basis: "address",
      sourceValue: "123 Sample Street",
      status: "suggested",
    });

    expect(
      resolveJobMatch({
        projectId: PROJECT_A,
        basis: "purchase_order",
        sourceValue: "PO-123",
        confirmedByUser: true,
      }).status
    ).toBe("confirmed");
  });
});
