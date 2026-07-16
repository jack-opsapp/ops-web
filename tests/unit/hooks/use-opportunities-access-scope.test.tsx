import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOpportunities } from "@/lib/hooks/use-opportunities";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { Opportunity } from "@/lib/types/pipeline";

const fetchOpportunities = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/services/opportunity-service", () => ({
  OpportunityService: { fetchOpportunities },
}));

function lead(id: string, assignedTo: string | null): Opportunity {
  return {
    id,
    assignedTo,
    stage: "qualifying",
    archivedAt: null,
    deletedAt: null,
  } as Opportunity;
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function setViewPermission(scope: "all" | "assigned" | null): void {
  usePermissionStore.setState({
    permissions: scope
      ? new Map([["pipeline.view", scope]])
      : new Map<string, "all" | "assigned">(),
    configuredPermissions: new Set(["pipeline.view"]),
    initialized: true,
  });
}

describe("useOpportunities access-scoped cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      company: { id: "company-1" } as never,
      currentUser: { id: "actor-1" } as never,
    });
    setViewPermission("all");
    fetchOpportunities.mockResolvedValue([
      lead("mine", "actor-1"),
      lead("theirs", "actor-2"),
    ]);
  });

  afterEach(() => {
    cleanup();
    usePermissionStore.getState().clear();
    useAuthStore.setState({ company: null, currentUser: null });
  });

  it("changes cache identity and removes inaccessible rows when view scope narrows", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useOpportunities(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map(({ id }) => id)).toEqual([
      "mine",
      "theirs",
    ]);

    act(() => setViewPermission("assigned"));

    await waitFor(() =>
      expect(result.current.data?.map(({ id }) => id)).toEqual(["mine"])
    );
    expect(fetchOpportunities).toHaveBeenCalledTimes(2);
  });

  it("fails closed immediately when an explicit view permission is revoked", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useOpportunities(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    act(() => setViewPermission(null));

    await waitFor(() => expect(result.current.data).toBeUndefined());
    expect(result.current.fetchStatus).toBe("idle");
  });
});
