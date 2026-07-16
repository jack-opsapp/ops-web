/**
 * Step-3 verification: a deal-scoped estimate surfaces in
 * `useEstimates({ opportunityId })` for that deal after creation.
 *
 * The non-obvious contract under test is the cache wiring: `useCreateEstimate`
 * invalidates `queryKeys.estimates.lists()` (= ["estimates","list"]), which must
 * PREFIX-MATCH the opportunity-scoped query key
 * (["estimates","list",companyId,{opportunityId}]) so the active Overview-tab
 * observer refetches and picks up the new estimate. We exercise the REAL
 * queryKeys + invalidation (only the Supabase service boundary is mocked).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// vi.mock is hoisted; vi.hoisted() initialises the spies before the factory runs.
const { fetchEstimates, createEstimate } = vi.hoisted(() => ({
  fetchEstimates: vi.fn(),
  createEstimate: vi.fn(),
}));

vi.mock("@/lib/api/services/estimate-service", () => ({
  EstimateService: { fetchEstimates, createEstimate },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co-1" } }),
}));

// estimates.view is required by useEstimates — grant it.
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (
    selector: (s: { can: (p: string) => boolean }) => unknown
  ) => selector({ can: () => true }),
}));

import { useEstimates, useCreateEstimate } from "@/lib/hooks/use-estimates";

beforeEach(() => {
  fetchEstimates.mockReset();
  createEstimate.mockReset();
});

describe("estimate ↔ opportunity scoping (cache contract)", () => {
  it("surfaces a newly created deal-scoped estimate in useEstimates({ opportunityId }) via invalidation → refetch", async () => {
    // Server-side store the mocked service reads from; createEstimate writes it.
    let store: Array<{
      id: string;
      opportunityId: string;
      estimateNumber: string;
    }> = [];
    fetchEstimates.mockImplementation(
      (_companyId: string, options: { opportunityId?: string } = {}) =>
        Promise.resolve(
          store.filter(
            (e) =>
              !options.opportunityId ||
              e.opportunityId === options.opportunityId
          )
        )
    );
    const created = {
      id: "est-new",
      opportunityId: "opp-1",
      estimateNumber: "EST-2001",
    };
    createEstimate.mockImplementation(() => {
      store = [created];
      return Promise.resolve(created);
    });

    // ONE stable QueryClient so the mutation's invalidation reaches the list
    // query (a per-render client would sever the link).
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => ({
        list: useEstimates({ opportunityId: "opp-1" }),
        create: useCreateEstimate(),
      }),
      { wrapper }
    );

    // Initial scoped fetch resolves empty.
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.list.data).toEqual([]);

    // Create an estimate linked to opp-1.
    await act(async () => {
      await result.current.create.mutateAsync({
        data: {
          companyId: "co-1",
          clientId: "client-1",
          opportunityId: "opp-1",
        },
        lineItems: [],
      });
    });

    // The service received the deal's opportunityId…
    expect(createEstimate).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: "opp-1" }),
      []
    );
    // …and the invalidation refetched the opportunity-scoped list, which now
    // includes the new estimate.
    await waitFor(() => expect(result.current.list.data).toEqual([created]));
  });
});
