import { describe, expect, it } from "vitest";
import { CANPRO_VINYL_LIVE_SNAPSHOT } from "../__fixtures__/canpro-vinyl";
import { buildDeksmartVinylDesiredStructure } from "../__fixtures__/canpro-desired";
import { reconcileCatalogStructure } from "../reconcile";
import {
  buildResolvedProductInput,
  CatalogExecutionReferenceError,
  compileCatalogExecutionBlueprint,
} from "../execution-plan";

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

describe("Phase C execution blueprint", () => {
  it("batches three families while preserving all existing variant ids", () => {
    const plan = compileCatalogExecutionBlueprint(blueprint);

    expect(plan.families).toHaveLength(3);
    expect(
      plan.families.find((family) => family.family.clientId === "deksmart-ultra-68")
        ?.family.variants?.filter((variant) => variant.id),
    ).toHaveLength(12);
    expect(
      plan.families
        .find((family) => family.family.clientId === "deksmart-smoothback-60")
        ?.family.variants?.map((variant) => variant.id),
    ).toEqual(
      expect.arrayContaining([
        "d08abff0-ea12-4673-927a-0d2db60adbb3",
        "5a5e9a74-4fd8-45c8-9dce-58e7b79082c0",
      ]),
    );
  });

  it("never resets live inventory quantities while updating catalog variants", () => {
    const plan = compileCatalogExecutionBlueprint(blueprint);

    expect(
      plan.families
        .flatMap((entry) => entry.family.variants ?? [])
        .every((variant) => variant.quantity === undefined),
    ).toBe(true);
  });

  it("keeps products, rules, supplier costs, capabilities, and cleanup explicit", () => {
    const plan = compileCatalogExecutionBlueprint(blueprint);

    expect(plan.products).toHaveLength(2);
    expect(plan.products[0].options.map((option) => option.name)).toEqual([
      "Color",
    ]);
    expect(plan.materialRules).toHaveLength(10);
    expect(plan.supplierCostProfiles.length).toBeGreaterThan(20);
    expect(plan.capabilityBindings).toHaveLength(2);
    expect(plan.archives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionType: "archive_catalog_option" }),
        expect.objectContaining({ actionType: "archive_catalog_variant" }),
      ]),
    );
  });

  it("carries GST and exact task-type reuse outside catalog payload batches", () => {
    const plan = compileCatalogExecutionBlueprint(blueprint);

    expect(plan.taxRates).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ name: "GST", rate: 0.05 }),
      }),
    ]);
    expect(plan.taskTypes).toEqual([
      expect.objectContaining({
        actionType: "reuse_task_type",
        existingId: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
      }),
    ]);
  });

  it("resolves cross-RPC family and task references before product commit", () => {
    const plan = compileCatalogExecutionBlueprint(blueprint);
    const productPlan = plan.products.find(
      (entry) => entry.action.clientId === "vinyl-install-68",
    )!;
    const idMap = Object.fromEntries(
      blueprint.actions.flatMap((action) =>
        action.clientId
          ? [[action.clientId, action.existingId ?? crypto.randomUUID()]]
          : [],
      ),
    );

    const product = buildResolvedProductInput(productPlan, idMap);

    expect(product.taskTypeRef).toBe(
      "a53dd13d-dc0c-4df0-88d6-118404b161ce",
    );
    expect(product.linkedCatalogItemId).toBe(idMap["deksmart-ultra-68"]);
    expect(product.recipes?.[0]).toEqual(
      expect.objectContaining({
        clientId: "vinyl-install-68:membrane",
        catalogItemId: idMap["deksmart-ultra-68"],
        variantSelector: { color: "$option.color" },
      }),
    );
    expect(product.catalogOptionMappings?.[0]).toEqual(
      expect.objectContaining({
        catalogItemId: idMap["deksmart-ultra-68"],
        catalogOptionId: idMap["deksmart-ultra-68:color"],
      }),
    );
  });

  it("blocks a product call when a prior action did not resolve", () => {
    const plan = compileCatalogExecutionBlueprint(blueprint);

    expect(() => buildResolvedProductInput(plan.products[0], {})).toThrow(
      CatalogExecutionReferenceError,
    );
  });
});
