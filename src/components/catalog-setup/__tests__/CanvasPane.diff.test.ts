import { describe, it, expect } from "vitest";
import { buildDiff, type DiffLabels } from "../CanvasPane";
import type { StagingCard } from "@/lib/catalog-setup/staging-card";
import type { SellFields } from "@/lib/catalog-setup/staging-card";

const L: DiffLabels = {
  name: "NAME",
  price: "PRICE",
  cost: "COST",
  taxable: "TAX",
  taxableYes: "taxable",
  taxableNo: "not taxable",
};

const existing: SellFields = {
  name: "Old Name",
  defaultPrice: 100,
  unitCost: 40,
  isTaxable: true,
  kind: "service",
  type: "LABOR",
} as SellFields;

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
    expect(diff[0]).toMatchObject({ label: "NAME", oldValue: "Old Name", newValue: "New Name" });
  });

  it("surfaces an is_taxable change with human values", () => {
    const diff = buildDiff(mergeCard({ isTaxable: false }), existing, L);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ label: "TAX", oldValue: "taxable", newValue: "not taxable" });
  });

  it("emits one row per changed field across name/price/cost/taxable", () => {
    const diff = buildDiff(
      mergeCard({ name: "X", defaultPrice: 120, unitCost: 50, isTaxable: false }),
      existing,
      L,
    );
    expect(diff.map((d) => d.label)).toEqual(["NAME", "PRICE", "COST", "TAX"]);
  });

  it("returns no diff when nothing changed, or for a non-merge/non-sell input", () => {
    expect(buildDiff(mergeCard({}), existing, L)).toHaveLength(0);
    expect(buildDiff(mergeCard({ name: "X" }), undefined, L)).toHaveLength(0);
  });
});
