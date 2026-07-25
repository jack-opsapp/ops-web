import { describe, expect, it } from "vitest";
import { getEstimateDraftBlocker } from "../estimate-draft-validation";

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
});
