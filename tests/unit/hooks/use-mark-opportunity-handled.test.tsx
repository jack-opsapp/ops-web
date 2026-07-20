import type { PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api/query-client";
import { useMarkOpportunityHandled } from "@/lib/hooks/use-opportunities";
import type { Opportunity } from "@/lib/types/pipeline";

const service = vi.hoisted(() => ({ markHandled: vi.fn() }));

vi.mock("@/lib/api/services/opportunity-service", () => ({
  OpportunityService: service,
}));

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useMarkOpportunityHandled", () => {
  beforeEach(() => service.markHandled.mockReset());

  it("reconciles the server-returned chase state through detail and list caches", async () => {
    const current = {
      id: "opp-1",
      handledAt: null,
      nextFollowUpAt: null,
      title: "Deck rebuild",
    } as Opportunity;
    const server = {
      ...current,
      handledAt: new Date("2026-07-19T12:00:00.000Z"),
      nextFollowUpAt: new Date("2026-07-22T12:00:00.000Z"),
    };
    service.markHandled.mockResolvedValue(server);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(queryKeys.opportunities.detail("opp-1"), current);
    queryClient.setQueryData(queryKeys.opportunities.list("company-1"), [
      current,
    ]);

    const { result } = renderHook(() => useMarkOpportunityHandled(), {
      wrapper: wrapperFor(queryClient),
    });
    act(() =>
      result.current.mutate({
        id: "opp-1",
        currentNextFollowUpAt: null,
      })
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(service.markHandled).toHaveBeenCalledWith("opp-1", null);
    expect(
      queryClient.getQueryData<Opportunity>(
        queryKeys.opportunities.detail("opp-1")
      )
    ).toMatchObject(server);
    expect(
      queryClient.getQueryData<Opportunity[]>(
        queryKeys.opportunities.list("company-1")
      )?.[0]
    ).toMatchObject(server);
  });
});
