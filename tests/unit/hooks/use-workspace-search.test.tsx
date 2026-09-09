import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { WorkspaceSearchResult } from "@/lib/types/workspace-search";

// vi.mock is hoisted above the imports; vi.hoisted keeps these alive at that
// point instead of hitting the module-scope temporal dead zone.
const { search, auth } = vi.hoisted(() => ({
  search: vi.fn(),
  auth: { companyId: "co-1" as string | null },
}));

vi.mock("@/lib/api/services/workspace-search-service", () => ({
  WorkspaceSearchService: { search },
  DEFAULT_WORKSPACE_SEARCH_LIMIT: 8,
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ company: auth.companyId ? { id: auth.companyId } : null }),
}));

import { useWorkspaceSearch } from "@/lib/hooks/use-workspace-search";

function envelope(query: string): WorkspaceSearchResult {
  const empty = { total: 0, items: [] };
  return {
    query,
    tokens: query.split(" ").filter(Boolean),
    projects: { ...empty },
    clients: { ...empty },
    leads: { ...empty },
    tasks: { ...empty },
    documents: { ...empty },
  };
}

function makeHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Mount empty (as the palette does) so the debounce actually governs typing. */
function mountPalette(enabled = true) {
  const { queryClient, wrapper } = makeHarness();
  const view = renderHook(
    ({ q }: { q: string }) => useWorkspaceSearch(q, { enabled }),
    { wrapper, initialProps: { q: "" } },
  );
  return { queryClient, ...view };
}

/**
 * Long enough to cover the one retry the hook allows: TanStack's default
 * `retryDelay` is 1000 ms for the first attempt.
 */
const RETRY_SETTLE_MS = 2000;

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  // The debounce timer only queues a re-render; the fetch starts when React
  // flushes the effect at the END of that act(), so draining the query promise
  // needs further passes — advancing timers inside the same act() is too early.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset();
  search.mockResolvedValue(envelope(""));
  auth.companyId = "co-1";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkspaceSearch", () => {
  it("never calls the service for a single character", async () => {
    const { rerender } = mountPalette();
    rerender({ q: "h" });
    await tick(1000);
    expect(search).not.toHaveBeenCalled();
  });

  it("calls the service once, 150 ms after the last keystroke", async () => {
    const { rerender } = mountPalette();
    rerender({ q: "hi" });
    await tick(140);
    expect(search).not.toHaveBeenCalled();
    await tick(20);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("hi", 8);
  });

  it("collapses a burst of keystrokes into one call for the final query", async () => {
    const { rerender } = mountPalette();
    for (const q of ["h", "hi", "hid", "hidd", "hidde", "hidden"]) {
      rerender({ q });
      await tick(20);
    }
    expect(search).not.toHaveBeenCalled();
    await tick(200);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("hidden", 8);
  });

  it("keys the cache on the trimmed, lower-cased query and the company", async () => {
    const { queryClient, rerender, result } = mountPalette();
    rerender({ q: "  Hidden  " });
    await tick(200);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toContainEqual(["search", "workspace", "co-1", "hidden"]);
    expect(result.current.activeQuery).toBe("hidden");
    // The request text is the key text: one cache entry can never stand for two
    // different request strings.
    expect(search).toHaveBeenCalledWith("hidden", 8);
  });

  it("passes a caller-supplied per-kind limit through", async () => {
    const { queryClient, wrapper } = makeHarness();
    const { rerender } = renderHook(
      ({ q }: { q: string }) =>
        useWorkspaceSearch(q, { enabled: true, limitPerKind: 4 }),
      { wrapper, initialProps: { q: "" } },
    );
    rerender({ q: "hidden" });
    await tick(200);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("hidden", 4);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toContainEqual(["search", "workspace", "co-1", "hidden"]);
  });

  it("calls nothing while disabled", async () => {
    const { rerender, result } = mountPalette(false);
    rerender({ q: "hidden" });
    await tick(1000);
    expect(search).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it("calls nothing without a company", async () => {
    auth.companyId = null;
    const { rerender, result } = mountPalette();
    rerender({ q: "hidden" });
    await tick(1000);
    expect(search).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
  });

  it("keeps the previous envelope on screen while the next query is in flight", async () => {
    let releaseSecond: ((value: WorkspaceSearchResult) => void) | undefined;
    search
      .mockImplementationOnce(() => Promise.resolve(envelope("hidden")))
      .mockImplementationOnce(
        () =>
          new Promise<WorkspaceSearchResult>((resolve) => {
            releaseSecond = resolve;
          }),
      );

    const { rerender, result } = mountPalette();
    rerender({ q: "hidden" });
    await tick(200);
    expect(result.current.result?.query).toBe("hidden");
    expect(result.current.isFetching).toBe(false);

    rerender({ q: "hidden oaks" });
    await tick(200);
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.current.result?.query).toBe("hidden");
    expect(result.current.isFetching).toBe(true);

    await act(async () => {
      releaseSecond?.(envelope("hidden oaks"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.result?.query).toBe("hidden oaks");
    expect(result.current.isFetching).toBe(false);
  });

  it("drops the settled envelope once the query falls below the minimum length", async () => {
    search.mockResolvedValue(envelope("hidden"));
    const { rerender, result } = mountPalette();
    rerender({ q: "hidden" });
    await tick(200);
    expect(result.current.enabled).toBe(true);
    expect(result.current.result?.query).toBe("hidden");

    // Backspacing to one character disables the search. `keepPreviousData` is
    // not gated on `enabled`, so without the guard in the hook the "hidden"
    // envelope would stay on screen as the answer to a query nobody is running
    // — the same leak the palette hits on close and reopen.
    rerender({ q: "h" });
    await tick(200);
    expect(result.current.enabled).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it("hands back a refetch that re-runs the query the key points at", async () => {
    search.mockResolvedValue(envelope("hidden"));
    const { rerender, result } = mountPalette();
    rerender({ q: "hidden" });
    await tick(200);
    expect(search).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
    });
    await tick(0);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith("hidden", 8);
    expect(result.current.result?.query).toBe("hidden");
  });

  it("surfaces a failure without pretending the last result is current", async () => {
    search.mockRejectedValue(new Error("permission denied for function search_workspace"));
    const { result, rerender } = mountPalette();
    rerender({ q: "hidden" });
    await tick(200);
    await tick(RETRY_SETTLE_MS);
    expect(result.current.isError).toBe(true);
    expect((result.current.error as Error | null)?.message).toMatch(/permission denied/);
    expect(result.current.result).toBeNull();
  });

  it("retries a hard failure exactly once", async () => {
    search.mockRejectedValue(new Error("permission denied for function search_workspace"));
    const { result, rerender } = mountPalette();
    rerender({ q: "hidden" });
    await tick(200);
    await tick(RETRY_SETTLE_MS);
    expect(result.current.isError).toBe(true);
    // The global policy only declines a retry when the error carries `status`,
    // and a PostgREST failure does not — unbounded, one typing pause against a
    // hard fault would cost three RPCs. One attempt plus one retry, no more.
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("never presents the previous envelope as the failed query's result", async () => {
    search
      .mockResolvedValueOnce(envelope("hidden"))
      .mockRejectedValue(new Error("permission denied for function search_workspace"));

    const { result, rerender } = mountPalette();
    rerender({ q: "hidden" });
    await tick(200);
    expect(result.current.result?.query).toBe("hidden");

    rerender({ q: "hidden oaks" });
    await tick(200);
    await tick(RETRY_SETTLE_MS);

    expect(result.current.isError).toBe(true);
    // The kept-previous envelope is substituted only while the query is still
    // pending; once the error settles the new key has no data of its own. So
    // `isPlaceholderData` is false and `result` is null — the "hidden"
    // envelope is never presented as the answer to "hidden oaks" (spec §6:
    // previous results are not shown as if current).
    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.result).toBeNull();
  });
});
