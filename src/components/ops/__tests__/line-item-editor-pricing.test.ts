import { describe, expect, it } from "vitest";
import {
  computeAmount,
  computeLinePricingBreakdown,
  createEmptyLineItem,
} from "../line-item-editor";

describe("LineItemEditor configured pricing", () => {
  it("applies the signed minimum before GST", () => {
    const item = {
      ...createEmptyLineItem(),
      quantity: 100,
      unitPrice: 11.73,
      discountPercent: 0,
      minimumChargeSnapshot: 1500,
      isTaxable: true,
    };

    expect(computeAmount(item, 0.05)).toEqual({
      lineTotal: 1500,
      tax: 75,
      total: 1575,
    });
  });

  it("does not charge an unselected optional line", () => {
    const item = {
      ...createEmptyLineItem(),
      quantity: 100,
      unitPrice: 11.73,
      minimumChargeSnapshot: 1500,
      isOptional: true,
      isSelected: false,
    };

    expect(computeAmount(item, 0.05)).toEqual({
      lineTotal: 0,
      tax: 0,
      total: 0,
    });
  });

  it("reconciles a line discount, minimum charge, and GST", () => {
    const item = {
      ...createEmptyLineItem(),
      quantity: 200,
      unitPrice: 11.73,
      discountPercent: 50,
      minimumChargeSnapshot: 1500,
      isTaxable: true,
    };

    expect(computeLinePricingBreakdown(item, 0.05)).toEqual({
      subtotal: 2346,
      discountAmount: 846,
      lineTotal: 1500,
      tax: 75,
      total: 1575,
    });
  });

  it("does not invent a discount when the minimum exceeds the raw extension", () => {
    const item = {
      ...createEmptyLineItem(),
      quantity: 100,
      unitPrice: 11.73,
      discountPercent: 10,
      minimumChargeSnapshot: 1500,
      isTaxable: true,
    };

    expect(computeLinePricingBreakdown(item, 0.05)).toEqual({
      subtotal: 1500,
      discountAmount: 0,
      lineTotal: 1500,
      tax: 75,
      total: 1575,
    });
  });
});
