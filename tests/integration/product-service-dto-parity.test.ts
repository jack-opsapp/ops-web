/**
 * Integration tests for the OPS-Web↔iOS Product DTO parity (P1-1).
 *
 * Confirms that ProductService.mapFromDb + mapToDb round-trip every field the
 * iOS `ProductDTO` carries — without those, a product authored on iOS with a
 * thumbnail / SKU / minimum charge would drop those fields the moment a web
 * user opened and saved the row. See `ops-web-kind-type-and-dto-drift` plan.
 *
 * The tests stub `requireSupabase` so we observe the exact rows passed to
 * `.insert(...)` / `.update(...)` and the exact data shape the service hands
 * back to the caller.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

interface MockState {
  lastInsertRow: Record<string, unknown> | null;
  lastUpdateRow: Record<string, unknown> | null;
  selectResult: { data: unknown; error: unknown };
}
const state: MockState = {
  lastInsertRow: null,
  lastUpdateRow: null,
  selectResult: { data: null, error: null },
};

function makeBuilder() {
  let mode: "select" | "insert" | "update" | null = null;
  const builder: Record<string, unknown> = {};
  builder.select = () => {
    mode = mode ?? "select";
    return builder;
  };
  builder.insert = (row: Record<string, unknown>) => {
    state.lastInsertRow = row;
    mode = "insert";
    return builder;
  };
  builder.update = (patch: Record<string, unknown>) => {
    state.lastUpdateRow = patch;
    mode = "update";
    return builder;
  };
  builder.eq = () => builder;
  builder.is = () => builder;
  builder.order = () => builder;
  builder.single = async () => state.selectResult;
  builder.then = (onResolve: (v: unknown) => unknown, onReject?: unknown) => {
    return Promise.resolve(state.selectResult).then(
      onResolve,
      onReject as never
    );
  };
  return builder;
}

const supabaseMock = {
  from: () => makeBuilder(),
};

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => supabaseMock,
  parseDate: (v: unknown) =>
    v instanceof Date ? v : v ? new Date(v as string) : null,
}));

import { ProductService } from "@/lib/api/services/product-service";

beforeEach(() => {
  state.lastInsertRow = null;
  state.lastUpdateRow = null;
  state.selectResult = { data: null, error: null };
});

describe("product-service iOS DTO parity (P1-1)", () => {
  it("mapToDb (create): writes every parity column when supplied", async () => {
    state.selectResult = {
      data: { id: "prod-1", company_id: "co-1", name: "Demo" },
      error: null,
    };
    await ProductService.createProduct({
      companyId: "co-1",
      name: "Demo",
      description: "Demo product",
      defaultPrice: 100,
      unitCost: 50,
      unit: "each",
      unitId: "unit-uuid",
      category: "Materials",
      categoryId: "cat-uuid",
      taskTypeId: "task-type-text-id",
      isTaxable: true,
      isActive: true,
      kind: "good",
      type: "MATERIAL",
      sku: "DEMO-001",
      thumbnailUrl: "https://example.com/thumb.png",
      pricingUnit: "each",
      minimumCharge: 25,
      minimumQuantity: 1,
      showBomOnEstimate: true,
      showInStorefront: false,
      isFavorite: true,
      tieredPricing: { tiers: [] },
      taskTypeRef: "task-type-fk-uuid",
    });
    const row = state.lastInsertRow!;
    // Core columns
    expect(row.company_id).toBe("co-1");
    expect(row.name).toBe("Demo");
    expect(row.default_price).toBe(100);
    expect(row.unit).toBe("each");
    expect(row.unit_id).toBe("unit-uuid");
    expect(row.category).toBe("Materials");
    expect(row.category_id).toBe("cat-uuid");
    expect(row.type).toBe("MATERIAL");
    // iOS DTO parity columns
    expect(row.kind).toBe("good");
    expect(row.sku).toBe("DEMO-001");
    expect(row.thumbnail_url).toBe("https://example.com/thumb.png");
    expect(row.pricing_unit).toBe("each");
    expect(row.minimum_charge).toBe(25);
    expect(row.minimum_quantity).toBe(1);
    expect(row.show_bom_on_estimate).toBe(true);
    expect(row.show_in_storefront).toBe(false);
    expect(row.is_favorite).toBe(true);
    expect(row.tiered_pricing).toEqual({ tiers: [] });
    expect(row.task_type_ref).toBe("task-type-fk-uuid");
  });

  it("mapToDb (sparse update): omits fields that weren't passed in the patch", async () => {
    state.selectResult = {
      data: { id: "prod-1", company_id: "co-1", name: "Renamed" },
      error: null,
    };
    await ProductService.updateProduct("prod-1", {
      name: "Renamed",
      isFavorite: true,
    });
    const row = state.lastUpdateRow!;
    expect(row.name).toBe("Renamed");
    expect(row.is_favorite).toBe(true);
    // Anything we didn't touch must NOT be in the patch — that's what keeps
    // an iOS-uploaded thumbnail safe from a web edit that doesn't know
    // about it.
    expect("thumbnail_url" in row).toBe(false);
    expect("kind" in row).toBe(false);
    expect("type" in row).toBe(false);
    expect("sku" in row).toBe(false);
    expect("minimum_charge" in row).toBe(false);
    expect("minimum_quantity" in row).toBe(false);
    expect("show_bom_on_estimate" in row).toBe(false);
    expect("tiered_pricing" in row).toBe(false);
    expect("task_type_ref" in row).toBe(false);
  });

  it("mapToDb: null is an explicit clear for nullable parity fields", async () => {
    state.selectResult = {
      data: { id: "prod-1", company_id: "co-1", name: "Demo" },
      error: null,
    };
    await ProductService.updateProduct("prod-1", {
      sku: null,
      minimumCharge: null,
      minimumQuantity: null,
      thumbnailUrl: null,
      taskTypeRef: null,
    });
    const row = state.lastUpdateRow!;
    expect(row.sku).toBeNull();
    expect(row.minimum_charge).toBeNull();
    expect(row.minimum_quantity).toBeNull();
    expect(row.thumbnail_url).toBeNull();
    expect(row.task_type_ref).toBeNull();
  });

  it("mapFromDb: reads every parity column", async () => {
    state.selectResult = {
      data: {
        id: "prod-1",
        company_id: "co-1",
        name: "Demo",
        description: "Demo product",
        default_price: "100.00",
        unit_cost: "50.00",
        unit: "each",
        unit_id: "unit-uuid",
        category: "Materials",
        category_id: "cat-uuid",
        is_taxable: true,
        is_active: true,
        type: "MATERIAL",
        task_type_id: "task-type-text-id",
        kind: "good",
        sku: "DEMO-001",
        thumbnail_url: "https://example.com/thumb.png",
        pricing_unit: "each",
        minimum_charge: "25.00",
        minimum_quantity: "1.00",
        show_bom_on_estimate: true,
        show_in_storefront: false,
        is_favorite: true,
        tiered_pricing: { tiers: [] },
        task_type_ref: "task-type-fk-uuid",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        deleted_at: null,
      },
      error: null,
    };
    const product = await ProductService.fetchProduct("prod-1");
    expect(product.kind).toBe("good");
    expect(product.type).toBe("MATERIAL");
    expect(product.sku).toBe("DEMO-001");
    expect(product.thumbnailUrl).toBe("https://example.com/thumb.png");
    expect(product.pricingUnit).toBe("each");
    expect(product.minimumCharge).toBe(25);
    expect(product.minimumQuantity).toBe(1);
    expect(product.showBomOnEstimate).toBe(true);
    expect(product.showInStorefront).toBe(false);
    expect(product.isFavorite).toBe(true);
    expect(product.tieredPricing).toEqual({ tiers: [] });
    expect(product.taskTypeRef).toBe("task-type-fk-uuid");
  });

  it("mapFromDb: missing parity columns default to safe nulls / falses", async () => {
    state.selectResult = {
      data: {
        id: "prod-1",
        company_id: "co-1",
        name: "Legacy",
        default_price: "0",
        unit: "each",
        type: "LABOR",
        is_taxable: false,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        deleted_at: null,
        // No kind / sku / thumbnail_url / minimum_* / favorite / etc.
      },
      error: null,
    };
    const product = await ProductService.fetchProduct("prod-1");
    expect(product.kind).toBeNull();
    expect(product.sku).toBeNull();
    expect(product.thumbnailUrl).toBeNull();
    expect(product.pricingUnit).toBeNull();
    expect(product.minimumCharge).toBeNull();
    expect(product.minimumQuantity).toBeNull();
    expect(product.showBomOnEstimate).toBe(false);
    expect(product.showInStorefront).toBe(false);
    expect(product.isFavorite).toBe(false);
    expect(product.tieredPricing).toBeNull();
    expect(product.taskTypeRef).toBeNull();
  });
});
