/**
 * A capability binding is only useful if the runtime that consumes it can find
 * it. The OPS capability registry publishes hyphenated refs (`deck-geometry/v1`);
 * a binding written as `deck_geometry/v1` is invisible to any consumer that
 * looks the capability up by ref — and that mismatch shipped in the Phase C
 * fixtures. These tests pin the ref format at the payload contract, so a
 * mis-keyed binding or `cut_plan` measure source is rejected before it is
 * persisted rather than discovered later by a consumer finding nothing.
 */

import { describe, expect, it } from "vitest";
import { validateCatalogActionPayload } from "../action-payload-contracts";
import { OPS_CAPABILITY_REFS } from "@/lib/ops-capabilities/registry";

const bindingPayload = (capabilityKey: string) => ({
  productRef: "product-picket-rail",
  capabilityKey,
  requiredInputs: ["finished_area_sqft", "deck_dimensions"],
  fallbackBehavior: { mode: "manual_dimensions" },
});

const cutPlanRulePayload = (measureSource: string) => ({
  productMaterialRef: "material-vinyl",
  calculationKind: "cut_plan" as const,
  measureSource,
  requiredInputs: ["finished_area_sqft", "deck_dimensions"],
  wasteFactor: 1,
  purchaseRounding: "whole_length" as const,
  roundingIncrement: 10,
  packageQuantity: 10,
  fallbackRule: { mode: "manual_dimensions" },
  config: {},
});

describe("capability refs on Phase C payloads", () => {
  it("publishes deck-geometry/v1 in the registry, hyphenated", () => {
    expect(OPS_CAPABILITY_REFS).toContain("deck-geometry/v1");
    expect(OPS_CAPABILITY_REFS).not.toContain("deck_geometry/v1");
  });

  it("accepts a capability binding keyed by a registered ref", () => {
    const result = validateCatalogActionPayload(
      "upsert_capability_binding",
      bindingPayload("deck-geometry/v1"),
    );
    expect(result).toEqual({ success: true, unsupportedFields: [] });
  });

  it("rejects the underscored capability key", () => {
    const result = validateCatalogActionPayload(
      "upsert_capability_binding",
      bindingPayload("deck_geometry/v1"),
    );
    expect(result.success).toBe(false);
    expect(result.unsupportedFields).toEqual(["capabilityKey"]);
  });

  it("rejects a capability key OPS does not publish", () => {
    const result = validateCatalogActionPayload(
      "upsert_capability_binding",
      bindingPayload("invented-capability/v9"),
    );
    expect(result.success).toBe(false);
    expect(result.unsupportedFields).toEqual(["capabilityKey"]);
  });

  it("requires a cut_plan rule to measure a registered capability ref", () => {
    expect(
      validateCatalogActionPayload(
        "upsert_material_quantity_rule",
        cutPlanRulePayload("deck-geometry/v1"),
      ),
    ).toEqual({ success: true, unsupportedFields: [] });

    const mismatched = validateCatalogActionPayload(
      "upsert_material_quantity_rule",
      cutPlanRulePayload("deck_geometry/v1"),
    );
    expect(mismatched.success).toBe(false);
    expect(mismatched.unsupportedFields).toEqual(["measureSource"]);
  });

  it("leaves estimate-measured rules as free text", () => {
    const result = validateCatalogActionPayload(
      "upsert_material_quantity_rule",
      {
        ...cutPlanRulePayload("exposed_edge_lf"),
        calculationKind: "edge_length" as const,
      },
    );
    expect(result).toEqual({ success: true, unsupportedFields: [] });
  });
});
