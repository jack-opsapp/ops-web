import { describe, expect, it, vi } from "vitest";
import { CANPRO_VINYL_LIVE_SNAPSHOT } from "../__fixtures__/canpro-vinyl";
import { buildDeksmartVinylDesiredStructure } from "../__fixtures__/canpro-desired";
import { reconcileCatalogStructure } from "../reconcile";
import {
  executeGuidedCatalogCommit,
  type CatalogGuidedCommitAdapter,
} from "../commit-service";

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

function stableId(value: string): string {
  const hex = Array.from(value)
    .reduce((sum, char) => sum + char.charCodeAt(0), 0)
    .toString(16)
    .padStart(12, "0")
    .slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

function fakeAdapter(
  archiveResult: { ok: boolean; references?: Record<string, number> } = {
    ok: true,
  },
) {
  const catalogPayloads: Array<Record<string, unknown>> = [];
  const finish = vi.fn(async () => ({ ok: true }));
  const adapter: CatalogGuidedCommitAdapter = {
    begin: vi.fn(async () => ({
      operationId: "b16d488a-80bb-4a12-a318-359c46eb7c5c",
      replayed: false,
      status: "committing",
    })),
    loadBlueprint: vi.fn(async () => blueprint),
    markActions: vi.fn(async () => undefined),
    resolveTaskType: vi.fn(async (action) =>
      action.existingId ?? stableId(action.clientId ?? action.actionKey),
    ),
    upsertTaxRate: vi.fn(async (action) =>
      action.existingId ?? stableId(action.clientId ?? action.actionKey),
    ),
    saveCatalog: vi.fn(async (_key, payload) => {
      catalogPayloads.push(payload as unknown as Record<string, unknown>);
      const idMap: Record<string, string> = {};
      const family = payload.family;
      if (family) {
        if (family.client_id)
          idMap[family.client_id] = family.id ?? stableId(family.client_id);
        for (const option of payload.catalog_options ?? []) {
          idMap[option.client_id] =
            option.id ?? stableId(option.client_id);
          for (const value of option.values) {
            idMap[value.client_id] =
              value.id ?? stableId(value.client_id);
          }
        }
        for (const variant of payload.variants ?? []) {
          idMap[variant.client_id] =
            variant.id ?? stableId(variant.client_id);
        }
      }
      for (const product of payload.products ?? []) {
        idMap[product.client_id] =
          product.id ?? stableId(product.client_id);
        for (const option of product.options ?? []) {
          idMap[option.client_id] =
            option.id ?? stableId(option.client_id);
          for (const value of option.values) {
            idMap[value.client_id] =
              value.id ?? stableId(value.client_id);
          }
        }
        for (const material of product.product_materials ?? []) {
          idMap[material.client_id] = stableId(material.client_id);
        }
      }
      return { ok: true, idMap };
    }),
    upsertSupplierCost: vi.fn(async (action) =>
      stableId(action.clientId ?? action.actionKey),
    ),
    upsertMaterialRule: vi.fn(async (action) =>
      stableId(action.clientId ?? action.actionKey),
    ),
    upsertCapability: vi.fn(async (action) =>
      stableId(action.clientId ?? action.actionKey),
    ),
    upsertVerification: vi.fn(async (action) =>
      stableId(action.clientId ?? action.actionKey),
    ),
    archiveVariant: vi.fn(async () => archiveResult),
    archiveOption: vi.fn(async () => true),
    readback: vi.fn(async () => ({
      products: 2,
      families: 3,
      status: "verified",
    })),
    finish,
  };
  return { adapter, catalogPayloads, finish };
}

describe("Phase C catalog commit service", () => {
  it("executes only the server-loaded blueprint and resolves cross-call ids", async () => {
    const { adapter, catalogPayloads, finish } = fakeAdapter();

    const result = await executeGuidedCatalogCommit({
      sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      approvalHash: "sha256:reviewed-plan",
      adapter,
    });

    expect(adapter.begin).toHaveBeenCalledWith(
      "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      "sha256:reviewed-plan",
    );
    expect(adapter.loadBlueprint).toHaveBeenCalledWith(
      "54ce9e88-5688-4e73-ae4e-a62f85044b77",
    );
    expect(catalogPayloads).toHaveLength(4);
    const productPayload = catalogPayloads[3] as {
      products: Array<{
        task_type_ref?: string;
        linked_catalog_item_id?: string;
        product_materials?: Array<{
          client_id: string;
          catalog_variant_id?: string;
          catalog_item_id?: string;
        }>;
      }>;
    };
    expect(productPayload.products).toHaveLength(2);
    expect(productPayload.products[0].task_type_ref).toBe(
      "a53dd13d-dc0c-4df0-88d6-118404b161ce",
    );
    expect(productPayload.products[0].linked_catalog_item_id).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(
      productPayload.products[0].product_materials?.every(
        (material) =>
          Boolean(material.catalog_variant_id) ||
          Boolean(material.catalog_item_id),
      ),
    ).toBe(true);
    expect(finish).toHaveBeenCalledWith(
      "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      "b16d488a-80bb-4a12-a318-359c46eb7c5c",
      true,
      expect.objectContaining({ status: "verified" }),
      expect.any(Array),
    );
    expect(result.status).toBe("complete");
    expect(result.replayed).toBe(false);
  });

  it("ends in attention with exact references when blank-variant cleanup is unsafe", async () => {
    const { adapter, finish } = fakeAdapter({
      ok: false,
      references: { catalog_stock_units: 1 },
    });

    const result = await executeGuidedCatalogCommit({
      sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      approvalHash: "sha256:reviewed-plan",
      adapter,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "attention",
        blockers: [
          expect.objectContaining({
            code: "variant_has_references",
            references: { catalog_stock_units: 1 },
          }),
        ],
      }),
    );
    expect(finish).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      false,
      expect.objectContaining({
        blockers: expect.any(Array),
      }),
      expect.any(Array),
    );
  });

  it("returns a completed readback without executing actions on replay", async () => {
    const { adapter } = fakeAdapter();
    vi.mocked(adapter.begin).mockResolvedValue({
      operationId: "b16d488a-80bb-4a12-a318-359c46eb7c5c",
      replayed: true,
      status: "complete",
      readback: { products: 2, status: "verified" },
    });

    const result = await executeGuidedCatalogCommit({
      sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      approvalHash: "sha256:reviewed-plan",
      adapter,
    });

    expect(result.replayed).toBe(true);
    expect(result.readback.products).toBe(2);
    expect(adapter.loadBlueprint).not.toHaveBeenCalled();
    expect(adapter.saveCatalog).not.toHaveBeenCalled();
    expect(adapter.finish).not.toHaveBeenCalled();
  });
});
