import { describe, it, expect } from "vitest";
import {
  normalizeHeader,
  suggestProductsMapping,
  suggestStockMapping,
} from "@/lib/catalog-setup/column-mapping";

// Ports `ProductsImportColumnMapping.suggest` + `CatalogImportColumnMapping.suggest`
// from the iOS mappers. Two-stage match, faithful to Swift:
//   1. exact-alias hit (normalized header == normalized alias), in alias order
//   2. substring fallback (first header whose normalized form contains the
//      normalized alias), in alias order
// `normalize`: lowercase, trim, `_`/`-` → space.

describe("normalizeHeader", () => {
  it("lowercases, trims, and maps _ and - to space", () => {
    expect(normalizeHeader(" Unit_Cost-Override ")).toBe("unit cost override");
    expect(normalizeHeader("SKU")).toBe("sku");
    expect(normalizeHeader("Family-Name")).toBe("family name");
  });
});

describe("suggestProductsMapping", () => {
  it("maps name + base price + cost via exact alias", () => {
    const m = suggestProductsMapping(["Product Name", "List Price", "Our Cost"]);
    expect(m.name).toBe("Product Name");
    expect(m.basePrice).toBe("List Price");
    expect(m.unitCost).toBe("Our Cost");
  });

  it("falls back to substring when no exact alias exists", () => {
    const m = suggestProductsMapping(["Item Title", "Rate Each"]);
    expect(m.name).toBe("Item Title"); // "title" alias via substring
    expect(m.basePrice).toBe("Rate Each"); // "rate" alias via substring
  });

  it("maps the full optional column set", () => {
    const m = suggestProductsMapping([
      "Name",
      "Price",
      "Description",
      "Unit Cost",
      "Category",
      "Unit",
      "Pricing Unit",
      "SKU",
      "Kind",
      "Line Item Type",
      "Taxable",
    ]);
    expect(m.name).toBe("Name");
    expect(m.basePrice).toBe("Price");
    expect(m.description).toBe("Description");
    expect(m.unitCost).toBe("Unit Cost");
    expect(m.category).toBe("Category");
    expect(m.unit).toBe("Unit");
    expect(m.pricingUnit).toBe("Pricing Unit");
    expect(m.sku).toBe("SKU");
    expect(m.kind).toBe("Kind");
    expect(m.type).toBe("Line Item Type");
    expect(m.isTaxable).toBe("Taxable");
  });

  it("leaves unmapped logical columns undefined", () => {
    const m = suggestProductsMapping(["Color", "Weight"]);
    expect(m.name).toBeUndefined();
    expect(m.basePrice).toBeUndefined();
  });

  it("isReadyToMap requires name + basePrice", () => {
    expect(suggestProductsMapping(["Name", "Price"]).isReadyToMap).toBe(true);
    expect(suggestProductsMapping(["Color"]).isReadyToMap).toBe(false);
    expect(suggestProductsMapping(["Name"]).isReadyToMap).toBe(false);
  });
});

describe("suggestStockMapping", () => {
  it("maps family_name + quantity + thresholds", () => {
    const m = suggestStockMapping(["Family", "Qty", "On Hand", "Min"]);
    expect(m.familyName).toBe("Family"); // "family" alias
    expect(m.quantity).toBe("Qty"); // "qty" alias
    // "min" is an exact alias of criticalThreshold
    expect(m.criticalThreshold).toBe("Min");
  });

  it("maps the family + variant column set", () => {
    const m = suggestStockMapping([
      "Family Name",
      "SKU",
      "Quantity",
      "Unit",
      "Category",
      "Unit Cost",
      "Description",
    ]);
    expect(m.familyName).toBe("Family Name");
    expect(m.quantity).toBe("Quantity");
    expect(m.sku).toBe("SKU");
    expect(m.defaultUnit).toBe("Unit");
    expect(m.category).toBe("Category");
    expect(m.defaultUnitCost).toBe("Unit Cost");
    expect(m.familyDescription).toBe("Description");
  });

  it("isReadyToMap requires familyName + quantity", () => {
    expect(suggestStockMapping(["Family Name", "Quantity"]).isReadyToMap).toBe(
      true,
    );
    expect(suggestStockMapping(["Family Name"]).isReadyToMap).toBe(false);
    expect(suggestStockMapping(["Color"]).isReadyToMap).toBe(false);
  });
});
