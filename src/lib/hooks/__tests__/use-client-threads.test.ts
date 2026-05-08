import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type ReactNode } from "react";

// vi.mock is hoisted; use vi.hoisted() to ensure listSiblings is initialised
// before the mock factory runs.
const { listSiblings } = vi.hoisted(() => ({ listSiblings: vi.fn() }));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { listSiblings },
}));

// Mock the auth store. The hook calls useAuthStore with selectCompanyId, so
// the mock returns the value the selector would compute against an in-memory
// auth-state shape. selectCompanyId is exported as a named selector helper —
// preserve the export so the hook's import resolves.
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: <T,>(selector: (state: { company: { id: string } | null }) => T) =>
    selector({ company: { id: "co-1" } }),
  selectCompanyId: (state: { company: { id: string } | null }) =>
    state.company?.id ?? null,
}));

import { useClientThreads } from "../use-client-threads";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  listSiblings.mockReset();
});

describe("useClientThreads", () => {
  it("does not fire listSiblings when clientId is null", async () => {
    listSiblings.mockResolvedValue([]);
    const { result } = renderHook(
      () => useClientThreads(null, { excludeId: "t-current" }),
      { wrapper },
    );
    // The query should be parked — TanStack reports `idle` fetchStatus
    // until `enabled` flips true.
    expect(result.current.fetchStatus).toBe("idle");
    // Allow any microtask-deferred fetch to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(listSiblings).not.toHaveBeenCalled();
  });

  it("does not fire listSiblings when excludeId is null", async () => {
    listSiblings.mockResolvedValue([]);
    const { result } = renderHook(
      () => useClientThreads("c-1", { excludeId: null }),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    await new Promise((r) => setTimeout(r, 10));
    expect(listSiblings).not.toHaveBeenCalled();
  });

  it("calls listSiblings with (companyId, clientId, excludeId, 50) and returns its result", async () => {
    // Build minimal EmailThread shapes — only the fields the test asserts on
    // need real values; the rest are coerced via `unknown as` to avoid
    // dragging the full type surface into the test.
    const mockThreads = [
      { id: "t-2", subject: "Roof quote" } as unknown as Awaited<
        ReturnType<typeof listSiblings>
      >[number],
      { id: "t-3", subject: "Site visit" } as unknown as Awaited<
        ReturnType<typeof listSiblings>
      >[number],
    ];
    listSiblings.mockResolvedValue(mockThreads);

    const { result } = renderHook(
      () => useClientThreads("c-1", { excludeId: "t-current" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockThreads);
    expect(listSiblings).toHaveBeenCalledTimes(1);
    expect(listSiblings).toHaveBeenCalledWith("co-1", "c-1", "t-current", 50);
  });
});
