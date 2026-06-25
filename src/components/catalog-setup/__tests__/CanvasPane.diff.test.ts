import { describe, it, expect } from "vitest";
import { buildDiff, type DiffLabels } from "../CanvasPane";
import type { SellFields, StagingCard } from "@/lib/catalog-setup/staging-card";
import type { OnFileProduct } from "@/lib/catalog-setup/existing-rows";

const L: DiffLabels = {
  name: "NAME",
  price: "PRICE",
  taxable: "TAX",
  taxableYes: "taxable",
  taxableNo: "not taxable",
};

const existing: OnFileProduct = {
  name: "Old Name",
  defaultPrice: 100,
  unitCost: 40,
  isTaxable: true,
  kind: "service",
  isActive: true,
};

const mergeCard = (fields: Partial<SellFields>): StagingCard =>
  ({
    id: "c1",
    source: "manual",
    state: "merge",
    module: "sell",
    matchedExistingId: "p1",
    fields: { ...existing, ...fields },
  }) as unknown as StagingCard;

describe("CanvasPane buildDiff", () => {
  it("surfaces a name-only rename (previously silent — price/cost unchanged)", () => {
    const diff = buildDiff(mergeCard({ name: "New Name" }), existing, L);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      field: "name",
      label: "NAME",
      oldValue: "Old Name",
      newValue: "New Name",
    });
  });

  it("surfaces an is_taxable change with human values", () => {
    const diff = buildDiff(mergeCard({ isTaxable: false }), existing, L);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      field: "is_taxable",
      label: "TAX",
      oldValue: "taxable",
      newValue: "not taxable",
    });
  });

  it("emits one row per COMMITTABLE changed field (cost excluded — the RPC never writes it)", () => {
    const diff = buildDiff(
      mergeCard({ name: "X", defaultPrice: 120, unitCost: 50, isTaxable: false }),
      existing,
      L,
    );
    // unit_cost differs (40→50) but is NOT emitted: catalog_setup_save never
    // overwrites products.unit_cost, so the canvas offers no cost verdict toggle.
    expect(diff.map((d) => d.label)).toEqual(["NAME", "PRICE", "TAX"]);
    // The field keys tie each toggle to fieldSelections + the commit adapter.
    expect(diff.map((d) => d.field)).toEqual([
      "name",
      "base_price",
      "is_taxable",
    ]);
  });

  it("a cost-only change emits no diff row (cost is not committable)", () => {
    expect(buildDiff(mergeCard({ unitCost: 999 }), existing, L)).toHaveLength(0);
  });

  it("returns no diff when nothing changed, or for a non-merge/non-sell input", () => {
    expect(buildDiff(mergeCard({}), existing, L)).toHaveLength(0);
    expect(buildDiff(mergeCard({ name: "X" }), undefined, L)).toHaveLength(0);
  });
});
