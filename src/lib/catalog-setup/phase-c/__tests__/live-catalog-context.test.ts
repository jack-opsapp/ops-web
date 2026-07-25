import { describe, expect, it } from "vitest";
import {
  buildLiveCatalogSnapshot,
  type LiveCatalogContextRowSets,
} from "../live-catalog-context";

describe("buildLiveCatalogSnapshot", () => {
  it("normalizes and sorts every catalog relationship needed for reconciliation", () => {
    const rows: LiveCatalogContextRowSets = {
      products: [
        {
          id: "product-b",
          company_id: "company-1",
          name: "Second",
          base_price: "12.73",
          deleted_at: null,
        },
        {
          id: "product-a",
          company_id: "company-1",
          name: "First",
          base_price: 11.73,
          deleted_at: null,
        },
      ],
      productOptions: [],
      productOptionValues: [],
      pricingModifiers: [],
      productMaterials: [],
      materialQuantityRules: [],
      families: [{ id: "family-1", company_id: "company-1", name: "Vinyl" }],
      catalogOptions: [],
      catalogOptionValues: [],
      variants: [
        {
          id: "variant-2",
          company_id: "company-1",
          catalog_item_id: "family-1",
          quantity: "0",
        },
        {
          id: "variant-1",
          company_id: "company-1",
          catalog_item_id: "family-1",
          quantity: 0,
        },
      ],
      variantOptionValues: [],
      productOptionMappings: [],
      stockUnits: [],
      supplierCostProfiles: [],
      capabilityBindings: [],
      units: [],
      categories: [],
      taskTypes: [],
      verificationItems: [],
    };

    const snapshot = buildLiveCatalogSnapshot("company-1", rows);

    expect(snapshot.companyId).toBe("company-1");
    expect(snapshot.products.map((row) => row.id)).toEqual([
      "product-a",
      "product-b",
    ]);
    expect(snapshot.products[1].base_price).toBe(12.73);
    expect(snapshot.variants.map((row) => row.id)).toEqual([
      "variant-1",
      "variant-2",
    ]);
    expect(snapshot.variants[1].quantity).toBe(0);
    expect(snapshot.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("changes the content hash when a matched live value changes", () => {
    const base: LiveCatalogContextRowSets = {
      products: [],
      productOptions: [],
      productOptionValues: [],
      pricingModifiers: [],
      productMaterials: [],
      materialQuantityRules: [],
      families: [{ id: "family-1", company_id: "company-1", name: "Vinyl" }],
      catalogOptions: [],
      catalogOptionValues: [],
      variants: [],
      variantOptionValues: [],
      productOptionMappings: [],
      stockUnits: [],
      supplierCostProfiles: [],
      capabilityBindings: [],
      units: [],
      categories: [],
      taskTypes: [],
      verificationItems: [],
    };

    const first = buildLiveCatalogSnapshot("company-1", base);
    const second = buildLiveCatalogSnapshot("company-1", {
      ...base,
      families: [
        {
          id: "family-1",
          company_id: "company-1",
          name: "DekSmart Ultra 68mil membrane",
        },
      ],
    });

    expect(second.hash).not.toBe(first.hash);
  });

  it("rejects rows that escape the verified company scope", () => {
    const rows: LiveCatalogContextRowSets = {
      products: [
        {
          id: "product-other",
          company_id: "company-2",
          name: "Foreign product",
        },
      ],
      productOptions: [],
      productOptionValues: [],
      pricingModifiers: [],
      productMaterials: [],
      materialQuantityRules: [],
      families: [],
      catalogOptions: [],
      catalogOptionValues: [],
      variants: [],
      variantOptionValues: [],
      productOptionMappings: [],
      stockUnits: [],
      supplierCostProfiles: [],
      capabilityBindings: [],
      units: [],
      categories: [],
      taskTypes: [],
      verificationItems: [],
    };

    expect(() => buildLiveCatalogSnapshot("company-1", rows)).toThrow(
      /company scope/i,
    );
  });
});
