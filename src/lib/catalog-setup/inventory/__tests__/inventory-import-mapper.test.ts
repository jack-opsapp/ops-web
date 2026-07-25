import { describe, expect, it } from "vitest";
import { CANPRO_VINYL_LIVE_SNAPSHOT } from "../../phase-c/__fixtures__/canpro-vinyl";
import { buildDeksmartVinylDesiredStructure } from "../../phase-c/reference/deksmart-desired";
import { reconcileCatalogStructure } from "../../phase-c/reconcile";
import { mapInventorySheet } from "../inventory-import-mapper";

// Build a compact post-setup snapshot from the deterministic plan so the mapper
// test uses the same logical DekSmart family/value identities as guided setup.
const plan = reconcileCatalogStructure(
  CANPRO_VINYL_LIVE_SNAPSHOT,
  buildDeksmartVinylDesiredStructure({
    standardPricePerSqft: 11.73,
    smoothbackPricePerSqft: 12.73,
    standardLaborCostPerSqft: 2,
    smoothbackLaborCostPerSqft: 2.25,
    minimumCharge: 1500,
    taxRate: 0.05,
    taskTypeDisplay: "Vinyl Install",
  }),
);

const familyIds = new Map<string, string>();
const optionIds = new Map<string, string>();
const valueIds = new Map<string, string>();
for (const action of plan.actions) {
  if (action.actionType === "upsert_catalog_family" && action.clientId) {
    familyIds.set(action.clientId, action.existingId ?? `id:${action.clientId}`);
  }
  if (action.actionType === "upsert_catalog_option" && action.clientId) {
    optionIds.set(action.clientId, action.existingId ?? `id:${action.clientId}`);
  }
  if (
    action.actionType === "upsert_catalog_option_value" &&
    action.clientId
  ) {
    valueIds.set(action.clientId, action.existingId ?? `id:${action.clientId}`);
  }
}

const postSetup = {
  ...CANPRO_VINYL_LIVE_SNAPSHOT,
  families: plan.actions
    .filter((action) => action.actionType === "upsert_catalog_family")
    .map((action) => ({
      id: familyIds.get(action.clientId!)!,
      company_id: "canpro-company",
      name: action.payload.name,
      deleted_at: null,
    })),
  catalogOptions: plan.actions
    .filter((action) => action.actionType === "upsert_catalog_option")
    .map((action) => ({
      id: optionIds.get(action.clientId!)!,
      catalog_item_id: familyIds.get(String(action.payload.familyRef))!,
      name: action.payload.name,
      deleted_at: null,
    })),
  catalogOptionValues: plan.actions
    .filter((action) => action.actionType === "upsert_catalog_option_value")
    .map((action) => ({
      id: valueIds.get(action.clientId!)!,
      option_id: optionIds.get(String(action.payload.optionRef))!,
      value: action.payload.value,
      deleted_at: null,
    })),
  variants: plan.actions
    .filter(
      (action) =>
        action.actionType === "upsert_catalog_variant" ||
        action.actionType === "move_catalog_variant",
    )
    .map((action) => ({
      id: action.existingId ?? `id:${action.clientId}`,
      company_id: "canpro-company",
      catalog_item_id: familyIds.get(
        String(
          action.payload.destinationFamilyRef ?? action.payload.familyRef,
        ),
      )!,
      sku: action.payload.supplierSku ?? null,
      is_active: true,
      deleted_at: null,
    })),
  variantOptionValues: plan.actions
    .filter(
      (action) => action.actionType === "replace_variant_option_values",
    )
    .flatMap((action) =>
      (action.payload.optionValueRefs as string[]).map((valueRef) => ({
        variant_id:
          plan.actions.find(
            (candidate) =>
              (candidate.actionType === "upsert_catalog_variant" ||
                candidate.actionType === "move_catalog_variant") &&
              (candidate.clientId === action.payload.variantRef ||
                candidate.existingId === action.payload.variantRef),
          )?.existingId ?? `id:${String(action.payload.variantRef)}`,
        option_value_id: valueIds.get(valueRef)!,
        deleted_at: null,
      })),
    ),
};

describe("inventory list mapper", () => {
  it("matches a physical 68mil membrane offcut by thickness and color", () => {
    const result = mapInventorySheet(
      {
        headers: ["Item", "Thickness", "Color", "Length", "Location"],
        rows: [
          {
            Item: "Vinyl membrane",
            Thickness: "68mil",
            Color: "Cobblestone",
            Length: "22",
            Location: "",
          },
        ],
        lineNumbers: [2],
      },
      postSetup,
      "Canpro Shop",
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        status: "matched",
        proposedStockUnit: expect.objectContaining({
          unit_kind: "offcut",
          width_value: 72,
          remaining_length_value: 22,
          length_unit: "ft",
          location: "Canpro Shop",
        }),
      }),
    );
  });

  it("accepts conservative quarter-pail adhesive inventory", () => {
    const result = mapInventorySheet(
      {
        headers: ["Material", "Quantity"],
        rows: [{ Material: "DekSmart 2510 Contact", Quantity: "1/2" }],
        lineNumbers: [2],
      },
      postSetup,
      "Canpro Shop",
    );

    expect(result[0].status).toBe("matched");
    expect(result[0].proposedStockUnit?.quantity_value).toBe(0.5);
    expect(result[0].proposedStockUnit?.status).toBe("partial");
  });

  it("keeps full roll counts physical so commit can create one stock row per roll", () => {
    const result = mapInventorySheet(
      {
        headers: ["Item", "Thickness", "Color", "Quantity"],
        rows: [
          {
            Item: "Vinyl membrane",
            Thickness: "68mil",
            Color: "Cobblestone",
            Quantity: "7",
          },
        ],
        lineNumbers: [2],
      },
      postSetup,
      "Canpro Shop",
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        status: "matched",
        proposedStockUnit: expect.objectContaining({
          unit_kind: "roll",
          quantity_value: 7,
          width_value: 72,
          remaining_length_value: 75,
        }),
      }),
    );
  });

  it("uses verified full-stick lengths for DekSmart flashing", () => {
    const result = mapInventorySheet(
      {
        headers: ["SKU", "Quantity"],
        rows: [{ SKU: "VDF15", Quantity: "3" }],
        lineNumbers: [2],
      },
      postSetup,
      "Canpro Shop",
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        status: "matched",
        proposedStockUnit: expect.objectContaining({
          unit_kind: "length",
          quantity_value: 3,
          remaining_length_value: 8,
          length_unit: "ft",
        }),
      }),
    );
  });

  it("requires whole counts for physical roll and length inventory", () => {
    const result = mapInventorySheet(
      {
        headers: ["Item", "Thickness", "Color", "Quantity"],
        rows: [
          {
            Item: "Vinyl membrane",
            Thickness: "68mil",
            Color: "Cobblestone",
            Quantity: "1.5",
          },
        ],
        lineNumbers: [2],
      },
      postSetup,
      "Canpro Shop",
    );

    expect(result[0].status).toBe("needs_input");
    expect(result[0].issues).toContainEqual(
      expect.objectContaining({ code: "invalid_physical_quantity" }),
    );
  });

  it("holds ambiguous rows for input instead of guessing", () => {
    const result = mapInventorySheet(
      {
        headers: ["Item", "Quantity"],
        rows: [{ Item: "Vinyl membrane", Quantity: "1" }],
        lineNumbers: [2],
      },
      postSetup,
      "Canpro Shop",
    );

    expect(result[0].status).toBe("needs_input");
    expect(result[0].issues).toContainEqual(
      expect.objectContaining({ code: "variant_ambiguous" }),
    );
  });
});
