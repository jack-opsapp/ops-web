import { describe, expect, it } from "vitest";
import { buildDeksmartVinylDesiredStructure } from "../reference/deksmart-desired";

const desired = buildDeksmartVinylDesiredStructure({
  standardPricePerSqft: 11.73,
  smoothbackPricePerSqft: 12.73,
  standardLaborCostPerSqft: 2,
  smoothbackLaborCostPerSqft: 2.25,
  minimumCharge: 1500,
  taxRate: 0.05,
  taskTypeDisplay: "Vinyl Install",
});

describe("verified DekSmart desired catalog", () => {
  it("creates two sell products with Color only and a hidden 60mil exception", () => {
    expect(desired.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: "vinyl-install-68",
          basePrice: 11.73,
          unitCost: 2,
          minimumCharge: 1500,
          showInStorefront: true,
        }),
        expect.objectContaining({
          clientId: "vinyl-install-60",
          basePrice: 12.73,
          unitCost: 2.25,
          minimumCharge: 1500,
          showInStorefront: false,
        }),
      ]),
    );
    expect(
      desired.products?.flatMap((product) =>
        product.options.map((option) => option.name),
      ),
    ).toEqual(["Color", "Color"]);
  });

  it("uses the exact compatible materials for each system", () => {
    const standard = desired.products?.find(
      (product) => product.clientId === "vinyl-install-68",
    );
    const smoothback = desired.products?.find(
      (product) => product.clientId === "vinyl-install-60",
    );

    expect(standard?.materials.map((material) => material.catalogVariantRef)).toEqual(
      [
        undefined,
        "material-vg2510",
        "material-vg15023",
        "material-vdf15",
        "material-vdf05",
        "material-vinyl-clip-grey",
      ],
    );
    expect(
      smoothback?.materials.map((material) => material.catalogVariantRef),
    ).toEqual([
      undefined,
      "material-vg4500",
      "material-vdfg",
      "material-vdf05",
    ]);
    expect(
      smoothback?.materials.some(
        (material) => material.catalogVariantRef === "material-vinyl-clip-grey",
      ),
    ).toBe(false);
  });

  it("keeps standard cost default and CONDO as an explicit internal override", () => {
    const materials = desired.families.find(
      (family) => family.clientId === "deksmart-system-materials",
    );
    const summer = materials?.variants.find(
      (variant) => variant.clientId === "material-vg2510",
    );

    expect(summer?.supplierSku).toBe("VG2510");
    expect(summer?.costProfiles).toEqual([
      expect.objectContaining({
        profileKey: "standard",
        unitCost: 219,
        isDefault: true,
      }),
      expect.objectContaining({
        profileKey: "condo",
        unitCost: 204,
        isDefault: false,
        activationRule: { orderTag: "CONDO" },
      }),
    ]);
    expect(
      materials?.variants.find(
        (variant) => variant.clientId === "material-vinyl-clip-grey",
      )?.supplierSku,
    ).toBeNull();
  });

  it("stores whole-package and whole-length purchasing rules with manual geometry fallback", () => {
    const standard = desired.products?.find(
      (product) => product.clientId === "vinyl-install-68",
    );
    const summer = standard?.materials.find(
      (material) => material.catalogVariantRef === "material-vg2510",
    );
    const drip = standard?.materials.find(
      (material) => material.catalogVariantRef === "material-vdf15",
    );
    const membrane = standard?.materials[0];

    expect(summer?.quantityRule).toEqual(
      expect.objectContaining({
        calculationKind: "coverage",
        coverageQuantity: 400,
        purchaseRounding: "whole_package",
        packageQuantity: 1,
      }),
    );
    expect(drip?.quantityRule).toEqual(
      expect.objectContaining({
        calculationKind: "edge_length",
        purchaseRounding: "whole_length",
        roundingIncrement: 8,
      }),
    );
    expect(membrane?.quantityRule).toEqual(
      expect.objectContaining({
        calculationKind: "cut_plan",
        measureSource: "deck_geometry/v1",
        fallbackRule: { mode: "manual_dimensions" },
      }),
    );
  });
});
