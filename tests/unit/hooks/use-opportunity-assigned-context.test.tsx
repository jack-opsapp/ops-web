import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOpportunityAssignedContext } from "@/lib/hooks/use-opportunity-assigned-context";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/services/opportunity-assigned-context-service", () => ({
  OpportunityAssignedContextService: { fetch: fetchMock },
}));

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useOpportunityAssignedContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the guarded context under a lead-specific cache key", async () => {
    const context = { lead: { id: OPPORTUNITY_ID } };
    fetchMock.mockResolvedValue(context);

    const { result } = renderHook(
      () => useOpportunityAssignedContext(OPPORTUNITY_ID),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(OPPORTUNITY_ID);
    expect(result.current.data).toBe(context);
  });

  it("does not issue a context read without a lead id", () => {
    const { result } = renderHook(
      () => useOpportunityAssignedContext(undefined),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a denied read as an error and does not retry it", async () => {
    fetchMock.mockRejectedValue(new Error("access_denied"));

    const { result } = renderHook(
      () => useOpportunityAssignedContext(OPPORTUNITY_ID),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.current.data).toBeUndefined();
  });
});
