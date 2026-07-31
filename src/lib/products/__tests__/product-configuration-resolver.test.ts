import { describe, expect, it } from "vitest";
import { resolveProductConfiguration } from "../product-configuration-resolver";

const colorOption = {
  id: "color",
  name: "Color",
  kind: "select",
  required: true,
  defaultValue: null,
  sortOrder: 0,
};

const colorValues = [
  {
    id: "cobblestone",
    optionId: "color",
    value: "Cobblestone",
    sortOrder: 0,
  },
  {
    id: "dove-grey",
    optionId: "color",
    value: "Dove Grey",
    sortOrder: 1,
  },
];

describe("resolveProductConfiguration", () => {
  it("resolves the 68mil sellable product by Color and floors the line at $1,500", () => {
    const result = resolveProductConfiguration({
      product: {
        id: "standard",
        name: "Vinyl membrane installation",
        basePrice: 11.73,
        minimumCharge: 1500,
        isTaxable: true,
        showInStorefront: true,
        taskTypeId: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
        unitCost: 2,
        pricingUnit: "sqft",
      },
      options: [colorOption],
      values: colorValues,
      modifiers: [],
      configuredOptions: { color: "cobblestone" },
      quantity: 100,
      discountPercent: 0,
    });

    expect(result.missingRequiredOptions).toEqual([]);
    expect(result.unitPrice).toBe(11.73);
    expect(result.extendedBeforeMinimum).toBe(1173);
    expect(result.lineTotalBeforeTax).toBe(1500);
    expect(result.resolvedOptionsLabel).toBe("Color: Cobblestone");
    expect(result.configuredOptions).toEqual({ color: "cobblestone" });
  });

  it("keeps 60mil as a separate staff product, never a Thickness option", () => {
    const result = resolveProductConfiguration({
      product: {
        id: "alternate",
        name: "Vinyl membrane installation — 60mil",
        basePrice: 12.73,
        minimumCharge: 1500,
        isTaxable: true,
        showInStorefront: false,
        taskTypeId: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
        unitCost: 2.25,
        pricingUnit: "sqft",
      },
      options: [colorOption],
      values: colorValues.slice(1),
      modifiers: [],
      configuredOptions: { color: "dove-grey" },
      quantity: 200,
    });

    expect(result.unitPrice).toBe(12.73);
    expect(result.lineTotalBeforeTax).toBe(2546);
    expect(result.resolvedOptionsLabel).toBe("Color: Dove Grey");
    expect(result.resolvedOptionsLabel).not.toMatch(/thickness/i);
  });

  it("applies option price modifiers and discount before the minimum floor", () => {
    const result = resolveProductConfiguration({
      product: {
        id: "product",
        name: "Configured service",
        basePrice: 100,
        minimumCharge: 250,
        isTaxable: true,
        showInStorefront: true,
        taskTypeId: null,
        unitCost: null,
        pricingUnit: "each",
      },
      options: [colorOption],
      values: colorValues,
      modifiers: [
        {
          optionId: "color",
          optionValueId: "dove-grey",
          kind: "add_flat",
          amount: 25,
        },
      ],
      configuredOptions: { color: "dove-grey" },
      quantity: 2,
      discountPercent: 10,
    });

    expect(result.unitPrice).toBe(125);
    expect(result.extendedBeforeMinimum).toBe(225);
    expect(result.lineTotalBeforeTax).toBe(250);
  });

  it("reports required options without silently choosing an arbitrary value", () => {
    const result = resolveProductConfiguration({
      product: {
        id: "product",
        name: "Configured service",
        basePrice: 100,
        minimumCharge: null,
        isTaxable: false,
        showInStorefront: true,
        taskTypeId: null,
        unitCost: null,
        pricingUnit: "each",
      },
      options: [colorOption],
      values: colorValues,
      modifiers: [],
      configuredOptions: {},
      quantity: 1,
    });

    expect(result.missingRequiredOptions).toEqual(["color"]);
    expect(result.resolvedOptionsLabel).toBe("");
  });
});
