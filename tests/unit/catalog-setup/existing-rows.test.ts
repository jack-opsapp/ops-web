import { describe, it, expect } from "vitest";
import {
  toExistingCatalog,
  type ExistingProductRow,
} from "@/lib/catalog-setup/existing-rows";

/**
 * toExistingCatalog — pure derivation of the dedupe inputs the wizard route
 * needs from the live product rows it reads: the matcher's `liveRows` and the
 * canvas's `existingRows` (the on-file SellFields the show-diff card renders).
 */

describe("toExistingCatalog", () => {
  it("derives matcher liveRows + canvas existingRows from product rows", () => {
    const rows: ExistingProductRow[] = [
      {
        id: "p1",
        sku: "WRAP-001",
        name: "Vehicle wrap",
        base_price: 1000,
        unit_cost: 600,
        is_taxable: true,
        kind: "service",
        description: null,
        category_id: null,
        is_active: true,
        show_in_storefront: false,
        pricing_unit: null,
        external_source: null,
        external_id: null,
      },
    ];

    const { liveRows, existingRows } = toExistingCatalog(rows);

    expect(liveRows).toHaveLength(1);
    expect(liveRows[0]).toMatchObject({
      id: "p1",
      sku: "WRAP-001",
      name: "Vehicle wrap",
      base_price: 1000,
      unit_cost: 600,
    });
    expect(existingRows["p1"]).toMatchObject({
      name: "Vehicle wrap",
      defaultPrice: 1000,
      unitCost: 600,
      isTaxable: true,
    });
  });

  it("keeps a null sku / cost and maps an unknown kind to a safe default", () => {
    const rows: ExistingProductRow[] = [
      {
        id: "p2",
        sku: null,
        name: "Labor",
        base_price: 0,
        unit_cost: null,
        is_taxable: null,
        kind: "weird",
        description: null,
        category_id: null,
        is_active: null,
        show_in_storefront: null,
        pricing_unit: null,
        external_source: null,
        external_id: null,
      },
    ];

    const { liveRows, existingRows } = toExistingCatalog(rows);

    expect(liveRows[0].sku).toBeNull();
    expect(existingRows["p2"].unitCost).toBeNull();
    expect(["service", "material", "package"]).toContain(existingRows["p2"].kind);
  });

  it("returns empty structures for an empty catalog", () => {
    const { liveRows, existingRows } = toExistingCatalog([]);
    expect(liveRows).toHaveLength(0);
    expect(Object.keys(existingRows)).toHaveLength(0);
  });
});
