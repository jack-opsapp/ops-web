import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authedFetchMock, toastSuccessMock } = vi.hoisted(() => ({
  authedFetchMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/utils/authed-fetch", () => ({
  authedFetch: authedFetchMock,
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "company-1" } }),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: toastSuccessMock,
  },
}));

import { useTriggerGmailSync } from "@/lib/hooks/use-gmail-connections";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children
  );
}

function response(status: number, state: "complete" | "continuing"): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      state,
      retryable: false,
      connectionsProcessed: 1,
      failedConnections: 0,
      pendingConnections: state === "continuing" ? 1 : 0,
      totalActivitiesCreated: 1,
      results: [{ matched: 2, needsReview: 1, newLeads: 3 }],
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  );
}

describe("useTriggerGmailSync", () => {
  beforeEach(() => {
    authedFetchMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it("does not announce completion for an accepted continuation", async () => {
    authedFetchMock.mockResolvedValue(response(202, "continuing"));
    const { result } = renderHook(() => useTriggerGmailSync(), { wrapper });

    let resolvedState: unknown;
    await act(async () => {
      const data = await result.current.mutateAsync();
      resolvedState = data.state;
    });

    expect(resolvedState).toBe("continuing");
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("announces counts only after a completed sync", async () => {
    authedFetchMock.mockResolvedValue(response(200, "complete"));
    const { result } = renderHook(() => useTriggerGmailSync(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(toastSuccessMock).toHaveBeenCalledOnce();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Synced — 2 matched, 1 need review, 3 new leads"
    );
  });
});
