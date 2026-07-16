import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOpportunityAssignedContext } from "@/lib/hooks/use-opportunity-assigned-context";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/services/opportunity-assigned-context-service", () => ({
  OpportunityAssignedContextService: { fetch: fetchMock },
}));

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";

function createHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return {
    client,
    wrapper({ children }: PropsWithChildren) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    },
  };
}

function createWrapper() {
  return createHarness().wrapper;
}

describe("useOpportunityAssignedContext", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    useAuthStore.setState({
      company: { id: "company-1" } as never,
      currentUser: { id: "actor-1" } as never,
    });
    usePermissionStore.setState({
      permissions: new Map([
        ["pipeline.view", "all"],
        ["inbox.view", "all"],
      ]),
      configuredPermissions: new Set(["pipeline.view", "inbox.view"]),
      initialized: true,
    });
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

  it("destroys cached email context when inbox permission is revoked", async () => {
    const withEmail = {
      lead: { id: OPPORTUNITY_ID },
      activities: [{ id: "email-1", bodyText: "private email body" }],
    };
    const redacted = {
      lead: { id: OPPORTUNITY_ID },
      activities: [],
    };
    fetchMock.mockResolvedValueOnce(withEmail).mockResolvedValueOnce(redacted);
    const { client, wrapper } = createHarness();
    const { result } = renderHook(
      () => useOpportunityAssignedContext(OPPORTUNITY_ID),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toBe(withEmail));

    act(() => {
      usePermissionStore.setState({
        permissions: new Map([["pipeline.view", "all"]]),
        configuredPermissions: new Set(["pipeline.view", "inbox.view"]),
        initialized: true,
      });
    });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe(redacted));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      client
        .getQueryCache()
        .findAll({
          queryKey: ["opportunities", "assigned-context", OPPORTUNITY_ID],
        })
        .map((query) => query.queryKey)
    ).toEqual([
      [
        "opportunities",
        "assigned-context",
        OPPORTUNITY_ID,
        {
          actorUserId: "actor-1",
          companyId: "company-1",
          inboxSource: "denied",
          inboxViewScope: null,
          pipelineViewScope: "all",
        },
      ],
    ]);
  });

  it("does not share assigned context between actors", async () => {
    const actorOne = { lead: { id: OPPORTUNITY_ID }, marker: "actor-1" };
    const actorTwo = { lead: { id: OPPORTUNITY_ID }, marker: "actor-2" };
    fetchMock.mockResolvedValueOnce(actorOne).mockResolvedValueOnce(actorTwo);
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () => useOpportunityAssignedContext(OPPORTUNITY_ID),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toBe(actorOne));

    act(() => {
      useAuthStore.setState({ currentUser: { id: "actor-2" } as never });
    });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe(actorTwo));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
