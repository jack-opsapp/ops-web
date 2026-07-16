import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPipelineMetricsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/services/metrics-service", () => ({
  MetricsService: { fetchPipelineMetrics: fetchPipelineMetricsMock },
}));

import { usePipelineMetrics } from "@/lib/hooks/use-metrics";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper({ children }: PropsWithChildren) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    },
  };
}

function setViewScope(scope: "all" | "assigned") {
  usePermissionStore.setState({
    permissions: new Map([["pipeline.view", scope]]),
    configuredPermissions: new Set(["pipeline.view"]),
    initialized: true,
  });
}

describe("usePipelineMetrics access scoping", () => {
  beforeEach(() => {
    fetchPipelineMetricsMock.mockReset();
    useAuthStore.setState({
      company: { id: "company-1" } as never,
      currentUser: { id: "actor-1" } as never,
    });
    setViewScope("all");
  });

  it("does not reuse all-lead aggregates after view scope narrows", async () => {
    const allMetrics = [{ label: "ALL LEADS" }];
    const assignedMetrics = [{ label: "ASSIGNED LEADS" }];
    fetchPipelineMetricsMock
      .mockResolvedValueOnce(allMetrics)
      .mockResolvedValueOnce(assignedMetrics);
    const { queryClient, wrapper } = harness();
    const { result } = renderHook(() => usePipelineMetrics(), { wrapper });

    await waitFor(() => expect(result.current.data).toBe(allMetrics));

    act(() => setViewScope("assigned"));

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe(assignedMetrics));
    expect(fetchPipelineMetricsMock).toHaveBeenCalledTimes(2);
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["metrics", "pipeline"] })
        .map((query) => query.queryKey)
    ).toEqual([
      [
        "metrics",
        "pipeline",
        {
          actorUserId: "actor-1",
          companyId: "company-1",
          viewScope: "assigned",
        },
      ],
    ]);
  });

  it("does not share pipeline aggregates between actors in one company", async () => {
    const actorOneMetrics = [{ label: "ACTOR ONE" }];
    const actorTwoMetrics = [{ label: "ACTOR TWO" }];
    fetchPipelineMetricsMock
      .mockResolvedValueOnce(actorOneMetrics)
      .mockResolvedValueOnce(actorTwoMetrics);
    const { wrapper } = harness();
    const { result } = renderHook(() => usePipelineMetrics(), { wrapper });

    await waitFor(() => expect(result.current.data).toBe(actorOneMetrics));

    act(() => {
      useAuthStore.setState({ currentUser: { id: "actor-2" } as never });
    });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe(actorTwoMetrics));
    expect(fetchPipelineMetricsMock).toHaveBeenCalledTimes(2);
  });
});
