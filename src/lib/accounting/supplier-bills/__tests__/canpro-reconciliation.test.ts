import { describe, expect, it } from "vitest";

import {
  evaluateCanproRate,
  evaluateQuantityVariance,
  findDuplicateCandidates,
  isSharedSupplierCharge,
  suggestSharedChargeAllocations,
} from "../canpro-reconciliation";

const PROJECT_A = "10000000-0000-4000-8000-000000000002";
const PROJECT_B = "10000000-0000-4000-8000-000000000003";

describe("Canpro supplier invoice reconciliation", () => {
  it.each([
    ["60 mil smooth vinyl", "SQFT", "2.30", "2.25", "exception"],
    ["45 mil fuzzy vinyl", "SQFT", "2.00", "2.00", "clear"],
    ["Scupper", "EA", "25.00", "25.00", "clear"],
    ["Roof drain", "EA", "20.00", "15.00", "exception"],
  ] as const)(
    "checks %s against its literal Canpro rate ceiling",
    (description, unit, actual, ceiling, outcome) => {
      expect(
        evaluateCanproRate({
          documentKind: "subcontractor",
          description,
          unitOfMeasure: unit,
          unitPrice: actual,
        })
      ).toEqual({
        checkKey: "rate_compliance",
        outcome,
        observedValue: `CAD ${actual} / ${unit}`,
        policyLimit: `CAD ${ceiling} / ${unit}`,
        rule: "canpro-fin-001",
      });
    }
  );

  it("leaves an unknown supplier item for review instead of inventing a rate", () => {
    expect(
      evaluateCanproRate({
        documentKind: "subcontractor",
        description: "Custom flashing",
        unitOfMeasure: "EA",
        unitPrice: "75.00",
      })
    ).toEqual({
      checkKey: "rate_compliance",
      outcome: "pending",
      observedValue: "CAD 75.00 / EA",
      policyLimit: null,
      rule: null,
    });
  });

  it("does not apply subcontractor labour ceilings to material supplier lines", () => {
    expect(
      evaluateCanproRate({
        documentKind: "material",
        description: "60 mil smooth vinyl",
        unitOfMeasure: "SQFT",
        unitPrice: "2.30",
      }).policyLimit
    ).toBeNull();
  });

  it("finds normalized invoice and exact-document duplicate candidates", () => {
    expect(
      findDuplicateCandidates(
        {
          normalizedSupplierName: "deksmart vinyl products",
          normalizedInvoiceNumber: "43066",
          sourceSha256: "a".repeat(64),
        },
        [
          {
            id: "intake-1",
            normalizedSupplierName: "deksmart vinyl products",
            normalizedInvoiceNumber: "43066",
            sourceSha256: "b".repeat(64),
          },
          {
            id: "intake-2",
            normalizedSupplierName: "another supplier",
            normalizedInvoiceNumber: "100",
            sourceSha256: "a".repeat(64),
          },
          {
            id: "intake-3",
            normalizedSupplierName: "another supplier",
            normalizedInvoiceNumber: "101",
            sourceSha256: "c".repeat(64),
          },
        ]
      )
    ).toEqual([
      { id: "intake-1", reason: "supplier_invoice" },
      { id: "intake-2", reason: "source_document" },
    ]);
  });

  it.each([
    ["62.50", "63.00", "exception", "0.50"],
    ["40.00", "40.00", "clear", "0.00"],
    [null, "40.00", "pending", null],
  ] as const)(
    "evaluates ordered %s versus invoiced %s without guessing plan quantity",
    (ordered, invoiced, outcome, variance) => {
      expect(evaluateQuantityVariance(ordered, invoiced)).toEqual({
        checkKey: "quantity_scope",
        outcome,
        orderedQuantity: ordered,
        invoicedQuantity: invoiced,
        variance,
      });
    }
  );

  it("recognizes only known shared supplier charges", () => {
    expect(isSharedSupplierCharge("Freight")).toBe(true);
    expect(isSharedSupplierCharge("Adhesive and hazmat")).toBe(true);
    expect(isSharedSupplierCharge("60 mil smooth vinyl")).toBe(false);
  });

  it("suggests an exact-cent shared-charge split by material subtotal", () => {
    expect(
      suggestSharedChargeAllocations("690.90", [
        { projectId: PROJECT_A, materialSubtotal: "1116.72" },
        { projectId: PROJECT_B, materialSubtotal: "592.20" },
      ])
    ).toEqual([
      { projectId: PROJECT_A, amount: "451.48" },
      { projectId: PROJECT_B, amount: "239.42" },
    ]);
  });
});
