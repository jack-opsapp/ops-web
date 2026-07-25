import { describe, expect, it } from "vitest";
import {
  computeAmount,
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
});
