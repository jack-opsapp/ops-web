import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api/query-client";
import { CatalogBulkVariantService } from "@/lib/api/services/catalog-bulk-variant-service";
import {
  useCatalogBulkVariantFamilies,
  useExpandCatalogVariants,
} from "@/lib/hooks/use-catalog-bulk-variants";

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: COMPANY_ID } }),
}));

vi.mock("@/lib/api/services/catalog-bulk-variant-service", () => ({
  CatalogBulkVariantService: {
    fetchFamilies: vi.fn(),
    expandVariants: vi.fn(),
  },
}));

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("catalog bulk variant hooks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the exact family snapshots under a company-scoped key", async () => {
    vi.mocked(CatalogBulkVariantService.fetchFamilies).mockResolvedValue([]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useCatalogBulkVariantFamilies(), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(CatalogBulkVariantService.fetchFamilies).toHaveBeenCalledWith(
      COMPANY_ID
    );
    expect(
      client.getQueryState(queryKeys.catalog.bulkVariantFamilies(COMPANY_ID))
    ).toBeDefined();
  });

  it("waits for both stock and snapshot refetches before reporting success", async () => {
    vi.mocked(CatalogBulkVariantService.expandVariants).mockResolvedValue({
      ok: true,
      replayed: false,
      family_count: 2,
      existing_variant_assignment_count: 4,
      new_variant_count: 4,
    });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const refetch = vi
      .spyOn(client, "refetchQueries")
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useExpandCatalogVariants(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        companyId: COMPANY_ID,
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        payload: {
          axis_name: "Top profile",
          existing_value: "Round top",
          new_values: ["Flat top"],
          families: [],
        },
      });
    });

    expect(refetch).toHaveBeenNthCalledWith(1, {
      queryKey: queryKeys.catalog.stock(COMPANY_ID),
      type: "active",
    });
    expect(refetch).toHaveBeenNthCalledWith(2, {
      queryKey: queryKeys.catalog.bulkVariantFamilies(COMPANY_ID),
      type: "active",
    });
  });

  it("does not automatically retry an ambiguous mutation", async () => {
    vi.mocked(CatalogBulkVariantService.expandVariants).mockRejectedValue(
      new Error("connection dropped")
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useExpandCatalogVariants(), {
      wrapper: wrapper(client),
    });
    await expect(
      result.current.mutateAsync({
        companyId: COMPANY_ID,
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        payload: {
          axis_name: "Top profile",
          existing_value: "Round top",
          new_values: ["Flat top"],
          families: [],
        },
      })
    ).rejects.toThrow("connection dropped");
    expect(CatalogBulkVariantService.expandVariants).toHaveBeenCalledTimes(1);
  });
});
