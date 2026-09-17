import { describe, expect, it } from "vitest";
import { getEstimateDraftBlocker } from "../estimate-draft-validation";
import { resolveProductConfiguration } from "@/lib/products/product-configuration-resolver";

const baseLine = {
  isTaxable: true,
  isOptional: false,
  isSelected: true,
  missingRequiredOptions: [] as string[],
};

describe("estimate draft validation", () => {
  it("blocks a configured product until its required Color is selected", () => {
    expect(
      getEstimateDraftBlocker(
        [{ ...baseLine, missingRequiredOptions: ["color"] }],
        { id: "gst", rate: 0.05 },
      ),
    ).toBe("missing_required_options");
  });

  it("blocks a taxable quote when no default tax rate exists", () => {
    expect(getEstimateDraftBlocker([baseLine], null)).toBe(
      "missing_default_tax_rate",
    );
  });

  it("ignores an unselected optional taxable line", () => {
    expect(
      getEstimateDraftBlocker(
        [{ ...baseLine, isOptional: true, isSelected: false }],
        null,
      ),
    ).toBeNull();
  });

  // A count left blank must stop the save, even when the catalogue still
  // carries a default for it: acceptance refuses a blank count, so the editor
  // asks for it first.
  describe("a railing line's counts", () => {
    const railing = {
      product: {
        id: "canpro-railing",
        name: "Picket Rail — Level",
        basePrice: 70,
        minimumCharge: null,
        isTaxable: true,
        showInStorefront: true,
        taskTypeId: null,
        unitCost: null,
        pricingUnit: "linear_foot",
      },
      options: [
        { id: "opt-color", name: "Color", kind: "select", required: true, defaultValue: "Black", sortOrder: 0 },
        { id: "opt-left", name: "Left ends", kind: "integer", required: true, defaultValue: "1", sortOrder: 1 },
        { id: "opt-corners", name: "Corners", kind: "integer", required: true, defaultValue: "0", sortOrder: 2 },
      ],
      values: [{ id: "val-black", optionId: "opt-color", value: "Black", sortOrder: 0 }],
      modifiers: [],
      quantity: 40,
    };
    const gst = { id: "gst", rate: 0.05 };

    it("blocks the save while any count is blank", () => {
      const resolved = resolveProductConfiguration({
        ...railing,
        configuredOptions: { "opt-left": 2 },
      });
      expect(resolved.missingRequiredOptions).toEqual(["opt-corners"]);
      expect(
        getEstimateDraftBlocker(
          [{ ...baseLine, missingRequiredOptions: resolved.missingRequiredOptions }],
          gst,
        ),
      ).toBe("missing_required_options");
    });

    it("saves once every count is entered, 0 included", () => {
      const resolved = resolveProductConfiguration({
        ...railing,
        configuredOptions: { "opt-left": 2, "opt-corners": 0 },
      });
      expect(resolved.configuredOptions).toStrictEqual({
        "opt-color": "val-black",
        "opt-left": 2,
        "opt-corners": 0,
      });
      expect(
        getEstimateDraftBlocker(
          [{ ...baseLine, missingRequiredOptions: resolved.missingRequiredOptions }],
          gst,
        ),
      ).toBeNull();
    });
  });
});
