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

const railingProduct = {
  id: "canpro-railing",
  name: "Aluminum railing",
  basePrice: 95,
  minimumCharge: null,
  isTaxable: true,
  showInStorefront: true,
  taskTypeId: null,
  unitCost: null,
  pricingUnit: "linear_foot",
};

/**
 * Canpro railing: four selects and five integer counts. The counts carry the
 * catalogue defaults production held before 2026-09-17 (1, 1, 0, 0, 0) so every
 * test below proves a count default is never used, whatever the data says.
 */
function canproOptions() {
  const select = (id: string, name: string, defaultValue: string, sortOrder: number) => ({
    id,
    name,
    kind: "select",
    required: true,
    defaultValue,
    sortOrder,
  });
  const integer = (id: string, name: string, defaultValue: string | null, sortOrder: number) => ({
    id,
    name,
    kind: "integer",
    required: true,
    defaultValue,
    sortOrder,
  });
  return [
    select("opt-color", "Color", "Black", 0),
    select("opt-mount", "Mount Type", "Side mount", 1),
    select("opt-height", "Height", '42"', 2),
    select("opt-lag", "Lag length", '3"', 3),
    integer("opt-left", "Left ends", "1", 4),
    integer("opt-right", "Right ends", "1", 5),
    integer("opt-corners", "Corners", "0", 6),
    integer("opt-45", "45° corners", "0", 7),
    integer("opt-wall", "Wall returns", "0", 8),
  ];
}

const canproValues = [
  { id: "val-black", optionId: "opt-color", value: "Black", sortOrder: 0 },
  { id: "val-white", optionId: "opt-color", value: "White", sortOrder: 1 },
  { id: "val-side", optionId: "opt-mount", value: "Side mount", sortOrder: 0 },
  { id: "val-top", optionId: "opt-mount", value: "Top mount", sortOrder: 1 },
  { id: "val-36", optionId: "opt-height", value: '36"', sortOrder: 0 },
  { id: "val-42", optionId: "opt-height", value: '42"', sortOrder: 1 },
  { id: "val-lag-3", optionId: "opt-lag", value: '3"', sortOrder: 0 },
  { id: "val-lag-4", optionId: "opt-lag", value: '4"', sortOrder: 1 },
];

describe("resolveProductConfiguration — every option kind", () => {
  it("builds a new line with the four select defaults and every count left blank", () => {
    const result = resolveProductConfiguration({
      product: railingProduct,
      options: canproOptions(),
      values: canproValues,
      modifiers: [],
      configuredOptions: {},
      quantity: 20,
    });

    expect(result.configuredOptions).toStrictEqual({
      "opt-color": "val-black",
      "opt-mount": "val-side",
      "opt-height": "val-42",
      "opt-lag": "val-lag-3",
    });
    expect(result.missingRequiredOptions).toEqual([
      "opt-left",
      "opt-right",
      "opt-corners",
      "opt-45",
      "opt-wall",
    ]);
    expect(result.resolvedOptionsLabel).toBe(
      'Color: Black · Mount Type: Side mount · Height: 42" · Lag length: 3"',
    );
  });

  it("lets an explicit value win over the default for selects, and takes counts only as entered", () => {
    const result = resolveProductConfiguration({
      product: railingProduct,
      options: canproOptions(),
      values: canproValues,
      modifiers: [],
      configuredOptions: {
        "opt-color": "val-white",
        "opt-mount": "top mount",
        "opt-left": 2,
        "opt-corners": "3",
        "opt-45": 0,
      },
      quantity: 20,
    });

    expect(result.configuredOptions["opt-color"]).toBe("val-white");
    expect(result.configuredOptions["opt-mount"]).toBe("val-top");
    expect(result.configuredOptions["opt-height"]).toBe("val-42");
    expect(result.configuredOptions["opt-left"]).toBe(2);
    expect(result.configuredOptions["opt-corners"]).toBe(3);
    // An entered 0 is a count, not a blank.
    expect(result.configuredOptions["opt-45"]).toBe(0);
    expect(result.configuredOptions).not.toHaveProperty("opt-right");
    expect(result.configuredOptions).not.toHaveProperty("opt-wall");
    expect(result.missingRequiredOptions).toEqual(["opt-right", "opt-wall"]);
    expect(result.resolvedOptionsLabel).toBe(
      'Color: White · Mount Type: Top mount · Height: 42" · Lag length: 3" · Left ends: 2 · Corners: 3 · 45° corners: 0',
    );
  });

  it.each<[string | null, string]>([
    ["1", "a whole count"],
    ["0", "zero"],
    [" 2 ", "a padded count"],
    ["-1", "a negative count"],
    ["abc", "text"],
    ["1.5", "a decimal string"],
    ["", "an empty string"],
    [null, "no default"],
  ])("never fills a count from default %j (%s)", (defaultValue) => {
    const options = canproOptions().map((option) =>
      option.id === "opt-left" ? { ...option, defaultValue } : option,
    );
    const result = resolveProductConfiguration({
      product: railingProduct,
      options,
      values: canproValues,
      modifiers: [],
      configuredOptions: {},
      quantity: 20,
    });
    expect(result.configuredOptions).not.toHaveProperty("opt-left");
    expect(result.missingRequiredOptions).toContain("opt-left");
    expect(result.resolvedOptionsLabel).not.toMatch(/Left ends/);
  });

  it("keeps a count blank rather than 0 when the stored snapshot carries null for it", () => {
    const result = resolveProductConfiguration({
      product: railingProduct,
      options: canproOptions(),
      values: canproValues,
      modifiers: [],
      configuredOptions: { "opt-left": null, "opt-right": 1 },
      quantity: 20,
    });
    expect(result.configuredOptions).not.toHaveProperty("opt-left");
    expect(result.configuredOptions["opt-right"]).toBe(1);
    expect(result.missingRequiredOptions).toEqual([
      "opt-left",
      "opt-corners",
      "opt-45",
      "opt-wall",
    ]);
  });

  it("is idempotent when its own output is fed back in", () => {
    const first = resolveProductConfiguration({
      product: railingProduct,
      options: canproOptions(),
      values: canproValues,
      modifiers: [],
      configuredOptions: { "opt-left": 4 },
      quantity: 20,
    });
    const second = resolveProductConfiguration({
      product: railingProduct,
      options: canproOptions(),
      values: canproValues,
      modifiers: [],
      configuredOptions: first.configuredOptions,
      quantity: 20,
    });
    expect(second).toStrictEqual(first);
  });

  it("accepts integer strings with surrounding whitespace and negative counts", () => {
    const result = resolveProductConfiguration({
      product: railingProduct,
      options: canproOptions(),
      values: canproValues,
      modifiers: [],
      configuredOptions: { "opt-left": " 3 ", "opt-right": "-1" },
      quantity: 20,
    });
    expect(result.configuredOptions["opt-left"]).toBe(3);
    expect(result.configuredOptions["opt-right"]).toBe(-1);
  });

  it("treats an invalid explicit count as blank, never as a default or zero", () => {
    const result = resolveProductConfiguration({
      product: railingProduct,
      options: canproOptions(),
      values: canproValues,
      modifiers: [],
      configuredOptions: {
        "opt-left": 2.5,
        "opt-right": true,
        "opt-corners": 0,
        "opt-45": 0,
        "opt-wall": 0,
      },
      quantity: 20,
    });
    expect(result.configuredOptions).not.toHaveProperty("opt-left");
    expect(result.configuredOptions).not.toHaveProperty("opt-right");
    expect(result.missingRequiredOptions).toEqual(["opt-left", "opt-right"]);
  });

  it.each<[string | null, string]>([
    ["1", "with a default"],
    [null, "without a default"],
  ])("leaves an optional count %s unset and not missing", (defaultValue) => {
    const options = canproOptions().map((option) =>
      option.kind === "integer"
        ? { ...option, required: false, defaultValue }
        : option,
    );
    const result = resolveProductConfiguration({
      product: railingProduct,
      options,
      values: canproValues,
      modifiers: [],
      configuredOptions: {},
      quantity: 20,
    });
    expect(result.configuredOptions).not.toHaveProperty("opt-wall");
    expect(result.configuredOptions).not.toHaveProperty("opt-left");
    expect(result.missingRequiredOptions).toEqual([]);
  });

  it("parses boolean defaults and values, emits JSON booleans and labels Yes / No", () => {
    const options = [
      { id: "opt-lights", name: "Post lights", kind: "boolean", required: true, defaultValue: "TRUE", sortOrder: 0 },
      { id: "opt-caps", name: "Post caps", kind: "boolean", required: true, defaultValue: " false ", sortOrder: 1 },
      { id: "opt-gate", name: "Gate", kind: "boolean", required: true, defaultValue: "true", sortOrder: 2 },
      { id: "opt-bad", name: "Kick plate", kind: "boolean", required: true, defaultValue: "yes", sortOrder: 3 },
      { id: "opt-free", name: "Toe rail", kind: "boolean", required: false, defaultValue: "1", sortOrder: 4 },
    ];
    const result = resolveProductConfiguration({
      product: railingProduct,
      options,
      values: [],
      modifiers: [],
      configuredOptions: { "opt-gate": false },
      quantity: 1,
    });

    expect(result.configuredOptions).toStrictEqual({
      "opt-lights": true,
      "opt-caps": false,
      "opt-gate": false,
    });
    expect(result.missingRequiredOptions).toEqual(["opt-bad"]);
    expect(result.resolvedOptionsLabel).toBe(
      "Post lights: Yes · Post caps: No · Gate: No",
    );
  });

  it("accepts boolean strings from a stored snapshot", () => {
    const result = resolveProductConfiguration({
      product: railingProduct,
      options: [
        { id: "opt-lights", name: "Post lights", kind: "boolean", required: false, defaultValue: null, sortOrder: 0 },
      ],
      values: [],
      modifiers: [],
      configuredOptions: { "opt-lights": "False" },
      quantity: 1,
    });
    expect(result.configuredOptions).toStrictEqual({ "opt-lights": false });
  });

  it("keeps pricing modifiers keyed on select value ids alongside integer options", () => {
    const result = resolveProductConfiguration({
      product: railingProduct,
      options: canproOptions(),
      values: canproValues,
      modifiers: [
        { optionId: "opt-color", optionValueId: "val-white", kind: "add_flat", amount: 5 },
        { optionId: "opt-color", optionValueId: "val-black", kind: "add_flat", amount: 10 },
      ],
      configuredOptions: {},
      quantity: 20,
    });
    expect(result.unitPrice).toBe(105);
    expect(result.lineTotalBeforeTax).toBe(2100);
  });
});
