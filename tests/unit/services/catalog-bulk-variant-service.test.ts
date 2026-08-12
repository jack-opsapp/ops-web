import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({ rpc }),
}));

import {
  CatalogBulkVariantRpcError,
  CatalogBulkVariantService,
} from "@/lib/api/services/catalog-bulk-variant-service";

const request = {
  companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  payload: {
    axis_name: "Top profile",
    existing_value: "Round top",
    new_values: ["Flat top"],
    families: [],
  },
};

describe("CatalogBulkVariantService.expandVariants", () => {
  beforeEach(() => rpc.mockReset());

  it("calls the single atomic RPC through the Firebase-backed browser client", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        replayed: false,
        family_count: 2,
        existing_variant_assignment_count: 4,
        new_variant_count: 4,
      },
      error: null,
    });

    await expect(
      CatalogBulkVariantService.expandVariants(request)
    ).resolves.toMatchObject({
      ok: true,
      family_count: 2,
      new_variant_count: 4,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("catalog_bulk_expand_variants", {
      p_company_id: request.companyId,
      p_idempotency_key: request.idempotencyKey,
      p_payload: request.payload,
    });
  });

  it("preserves typed stale and permission rejections for guided recovery", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        ok: false,
        replayed: false,
        error_code: "stale_catalog",
        message: "Catalog changed.",
      },
      error: null,
    });

    await expect(
      CatalogBulkVariantService.expandVariants(request)
    ).rejects.toEqual(
      expect.objectContaining<Partial<CatalogBulkVariantRpcError>>({
        name: "CatalogBulkVariantRpcError",
        code: "stale_catalog",
      })
    );

    rpc.mockResolvedValueOnce({
      data: {
        ok: false,
        replayed: false,
        error_code: "permission_denied",
        message: "Catalog management permission is required.",
      },
      error: null,
    });

    await expect(
      CatalogBulkVariantService.expandVariants(request)
    ).rejects.toEqual(expect.objectContaining({ code: "permission_denied" }));
  });

  it("wraps transport failures without inventing a server outcome", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "fetch failed" } });

    await expect(
      CatalogBulkVariantService.expandVariants(request)
    ).rejects.toEqual(
      expect.objectContaining({
        code: "transport_error",
        message: "fetch failed",
      })
    );
  });
});
