import { describe, expect, it } from "vitest";
import { CANPRO_VINYL_LIVE_SNAPSHOT } from "../__fixtures__/canpro-vinyl";
import { DEKSMART_ULTRA_COLORS } from "../__fixtures__/canpro-deksmart-reference";
import { buildDeksmartVinylDesiredStructure } from "../__fixtures__/canpro-desired";
import {
  reconcileCatalogStructure,
  type DesiredCatalogStructure,
} from "../reconcile";

const desired: DesiredCatalogStructure = {
  taxRates: [
    {
      clientId: "gst",
      name: "GST",
      rate: 0.05,
      isDefault: true,
      isActive: true,
    },
  ],
  taskTypes: [
    {
      clientId: "vinyl-install",
      display: "Vinyl Install",
    },
  ],
  families: [
    {
      clientId: "deksmart-ultra-68",
      name: "DekSmart Ultra 68mil membrane",
      aliases: ["Vinyl"],
      optionName: "Color",
      variants: DEKSMART_ULTRA_COLORS.map((color) => ({
        clientId: `ultra-${color.toLowerCase().replaceAll(" ", "-")}`,
        label: color,
        supplierSku: null,
        legacyMatch: {
          familyName: "Vinyl",
          optionValues: {
            Color: color,
            Type: "68mil Fuzzy",
          },
        },
      })),
    },
    {
      clientId: "deksmart-smoothback-60",
      name: "DekSmart Smoothback 60mil membrane",
      optionName: "Color",
      variants: ["Antique Beige", "Dove Grey"].map((color) => ({
        clientId: `smoothback-${color.toLowerCase().replaceAll(" ", "-")}`,
        label: color,
        supplierSku: null,
        legacyMatch: {
          familyName: "Vinyl",
          optionValues: {
            Color: color,
            Type: "60mil Smooth",
          },
        },
      })),
    },
  ],
};

const desiredWithProducts: DesiredCatalogStructure = {
  ...desired,
  products: [
    {
      clientId: "vinyl-install-68",
      name: "Vinyl membrane installation",
      description: "Supply and install DekSmart Ultra 68mil membrane.",
      basePrice: 11.73,
      unitCost: 2,
      pricingUnit: "sqft",
      minimumCharge: 1500,
      isTaxable: true,
      showInStorefront: true,
      taskTypeClientId: "vinyl-install",
      linkedFamilyRef: "deksmart-ultra-68",
      options: [
        {
          clientId: "vinyl-install-68:color",
          name: "Color",
          required: true,
          affectsRecipe: true,
          catalogOptionRef: "deksmart-ultra-68:color",
          values: DEKSMART_ULTRA_COLORS.map((color) => ({
            clientId: `vinyl-install-68:color:${color.toLowerCase().replaceAll(" ", "-")}`,
            label: color,
            catalogValueRef: `deksmart-ultra-68:color:${color.toLowerCase().replaceAll(" ", "-")}`,
          })),
        },
      ],
      materials: [
        {
          clientId: "vinyl-install-68:membrane",
          catalogItemRef: "deksmart-ultra-68",
          variantSelector: {
            productOptionRef: "vinyl-install-68:color",
          },
          quantityPerUnit: 1,
          quantityRule: {
            calculationKind: "cut_plan",
            measureSource: "deck_geometry/v1",
            requiredInputs: ["finished_area_sqft", "deck_dimensions"],
            wasteFactor: 1,
            purchaseRounding: "none",
            fallbackRule: { mode: "manual_dimensions" },
            config: { orderMode: "precut_or_roll" },
          },
        },
      ],
      capability: {
        capabilityKey: "deck_geometry/v1",
        requiredInputs: [
          "finished_area_sqft",
          "deck_dimensions",
          "exposed_edge_lf",
          "wall_edge_lf",
        ],
        fallbackBehavior: { mode: "manual_dimensions" },
      },
    },
    {
      clientId: "vinyl-install-60",
      name: "Vinyl membrane installation — 60mil",
      description: "Supply and install DekSmart Smoothback 60mil membrane.",
      basePrice: 12.73,
      unitCost: 2.25,
      pricingUnit: "sqft",
      minimumCharge: 1500,
      isTaxable: true,
      showInStorefront: false,
      taskTypeClientId: "vinyl-install",
      linkedFamilyRef: "deksmart-smoothback-60",
      options: [
        {
          clientId: "vinyl-install-60:color",
          name: "Color",
          required: true,
          affectsRecipe: true,
          catalogOptionRef: "deksmart-smoothback-60:color",
          values: ["Antique Beige", "Dove Grey"].map((color) => ({
            clientId: `vinyl-install-60:color:${color.toLowerCase().replaceAll(" ", "-")}`,
            label: color,
            catalogValueRef: `deksmart-smoothback-60:color:${color.toLowerCase().replaceAll(" ", "-")}`,
          })),
        },
      ],
      materials: [],
    },
  ],
};

describe("Phase C Canpro vinyl reconciliation", () => {
  it("produces a reviewable complete DekSmart plan from the observed live catalog", () => {
    const blueprint = reconcileCatalogStructure(
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

    expect(blueprint.ready).toBe(true);
    expect(
      blueprint.issues.filter((issue) => issue.severity === "blocker"),
    ).toEqual([]);
    expect(
      blueprint.actions.filter(
        (action) => action.actionType === "upsert_product",
      ),
    ).toHaveLength(2);
    expect(
      blueprint.actions.filter(
        (action) => action.actionType === "upsert_product_material",
      ),
    ).toHaveLength(10);
  });

  it("preserves all 12 existing Ultra IDs and creates only seven missing colors", () => {
    const blueprint = reconcileCatalogStructure(
      CANPRO_VINYL_LIVE_SNAPSHOT,
      desired,
    );
    const ultraVariantActions = blueprint.actions.filter(
      (action) =>
        action.actionType === "upsert_catalog_variant" &&
        action.payload.familyRef === "deksmart-ultra-68",
    );

    expect(
      ultraVariantActions.filter((action) => action.existingId).map(
        (action) => action.existingId,
      ),
    ).toHaveLength(12);
    expect(
      ultraVariantActions.filter((action) => action.group === "CREATE"),
    ).toHaveLength(7);
    expect(
      new Set(ultraVariantActions.map((action) => action.payload.label)).size,
    ).toBe(19);
  });

  it("moves the two Smoothback variants into a separate family without changing IDs", () => {
    const blueprint = reconcileCatalogStructure(
      CANPRO_VINYL_LIVE_SNAPSHOT,
      desired,
    );
    const moveActions = blueprint.actions.filter(
      (action) => action.actionType === "move_catalog_variant",
    );

    expect(moveActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          existingId: "d08abff0-ea12-4673-927a-0d2db60adbb3",
          payload: expect.objectContaining({
            destinationFamilyRef: "deksmart-smoothback-60",
            label: "Antique Beige",
          }),
        }),
        expect.objectContaining({
          existingId: "5a5e9a74-4fd8-45c8-9dce-58e7b79082c0",
          payload: expect.objectContaining({
            destinationFamilyRef: "deksmart-smoothback-60",
            label: "Dove Grey",
          }),
        }),
      ]),
    );
  });

  it("reuses Vinyl Install, retires Type after the split, and preflights the blank variant", () => {
    const blueprint = reconcileCatalogStructure(
      CANPRO_VINYL_LIVE_SNAPSHOT,
      desired,
    );

    expect(blueprint.actions).toContainEqual(
      expect.objectContaining({
        group: "REUSE",
        actionType: "reuse_task_type",
        existingId: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
      }),
    );
    expect(blueprint.actions).toContainEqual(
      expect.objectContaining({
        group: "ARCHIVE",
        actionType: "archive_catalog_option",
        existingId: "eac1b169-30dd-4d58-8480-14f97b670654",
      }),
    );
    expect(blueprint.actions).toContainEqual(
      expect.objectContaining({
        group: "NEEDS_INPUT",
        actionType: "create_verification_item",
        payload: expect.objectContaining({
          subjectId: "d2187acd-2f4a-4ac8-bc7c-120897e07522",
          check: "variant_reference_preflight",
        }),
      }),
    );
    expect(blueprint.actions).toContainEqual(
      expect.objectContaining({
        group: "ARCHIVE",
        actionType: "archive_catalog_variant",
        existingId: "d2187acd-2f4a-4ac8-bc7c-120897e07522",
        dependsOn: [
          "verify:catalog_variant:d2187acd-2f4a-4ac8-bc7c-120897e07522",
        ],
      }),
    );
  });

  it("creates the missing 5% GST rate as the company default", () => {
    const blueprint = reconcileCatalogStructure(
      CANPRO_VINYL_LIVE_SNAPSHOT,
      desired,
    );

    expect(blueprint.actions).toContainEqual(
      expect.objectContaining({
        group: "CREATE",
        actionType: "upsert_tax_rate",
        clientId: "gst",
        payload: {
          name: "GST",
          rate: 0.05,
          isDefault: true,
          isActive: true,
        },
      }),
    );
  });

  it("never emits duplicate normalized families, colors, or task types", () => {
    const blueprint = reconcileCatalogStructure(
      CANPRO_VINYL_LIVE_SNAPSHOT,
      desired,
    );
    const signatures = blueprint.actions.map(
      (action) =>
        `${action.actionType}:${action.existingId ?? action.clientId}:${String(
          action.payload.label ?? action.payload.name ?? "",
        ).trim().toLowerCase()}`,
    );

    expect(new Set(signatures).size).toBe(signatures.length);
    expect(
      blueprint.issues.filter((issue) => issue.code === "ambiguous_match"),
    ).toHaveLength(0);
  });

  it("builds two quote products with Color only and keeps 60mil off the storefront", () => {
    const blueprint = reconcileCatalogStructure(
      CANPRO_VINYL_LIVE_SNAPSHOT,
      desiredWithProducts,
    );
    const products = blueprint.actions.filter(
      (action) => action.actionType === "upsert_product",
    );
    const options = blueprint.actions.filter(
      (action) => action.actionType === "upsert_product_option",
    );

    expect(products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: "vinyl-install-68",
          payload: expect.objectContaining({
            basePrice: 11.73,
            unitCost: 2,
            minimumCharge: 1500,
            isTaxable: true,
            showInStorefront: true,
            taskTypeClientId: "vinyl-install",
          }),
        }),
        expect.objectContaining({
          clientId: "vinyl-install-60",
          payload: expect.objectContaining({
            name: "Vinyl membrane installation — 60mil",
            basePrice: 12.73,
            unitCost: 2.25,
            showInStorefront: false,
          }),
        }),
      ]),
    );
    expect(options.map((action) => action.payload.name)).toEqual([
      "Color",
      "Color",
    ]);
    expect(options.some((action) => action.payload.name === "Thickness")).toBe(
      false,
    );
  });

  it("connects the standard product to deck geometry with a manual fallback", () => {
    const blueprint = reconcileCatalogStructure(
      CANPRO_VINYL_LIVE_SNAPSHOT,
      desiredWithProducts,
    );

    expect(blueprint.actions).toContainEqual(
      expect.objectContaining({
        actionType: "upsert_material_quantity_rule",
        payload: expect.objectContaining({
          calculationKind: "cut_plan",
          measureSource: "deck_geometry/v1",
          fallbackRule: { mode: "manual_dimensions" },
        }),
      }),
    );
    expect(blueprint.actions).toContainEqual(
      expect.objectContaining({
        actionType: "upsert_capability_binding",
        payload: expect.objectContaining({
          capabilityKey: "deck_geometry/v1",
          fallbackBehavior: { mode: "manual_dimensions" },
        }),
      }),
    );
  });
});
