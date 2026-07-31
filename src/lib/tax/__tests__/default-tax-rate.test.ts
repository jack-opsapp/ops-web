import { describe, expect, it } from "vitest";
import {
  calculateEstimateDraftTotals,
  normalizeStoredTaxRate,
} from "../estimate-tax";

describe("estimate default tax", () => {
  it("adds 5% GST on top of the taxable $1,500 minimum", () => {
    const totals = calculateEstimateDraftTotals(
      [
        {
          lineTotalBeforeTax: 1500,
          isTaxable: true,
          isOptional: false,
          isSelected: true,
        },
      ],
      0.05,
    );

    expect(totals).toEqual({
      subtotal: 1500,
      taxableSubtotal: 1500,
      taxAmount: 75,
      total: 1575,
    });
  });

  it("does not tax non-taxable or unselected optional lines", () => {
    const totals = calculateEstimateDraftTotals(
      [
        {
          lineTotalBeforeTax: 1000,
          isTaxable: false,
          isOptional: false,
          isSelected: true,
        },
        {
          lineTotalBeforeTax: 500,
          isTaxable: true,
          isOptional: true,
          isSelected: false,
        },
      ],
      0.05,
    );

    expect(totals.subtotal).toBe(1000);
    expect(totals.taxAmount).toBe(0);
    expect(totals.total).toBe(1000);
  });

  it("rejects whole-percent storage instead of silently guessing", () => {
    expect(() => normalizeStoredTaxRate(5)).toThrow(/decimal/i);
    expect(normalizeStoredTaxRate(0.05)).toBe(0.05);
  });
});
