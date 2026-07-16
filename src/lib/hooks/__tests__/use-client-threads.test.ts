import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type ReactNode } from "react";

const { fetchMock, getIdTokenMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getIdTokenMock: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: getIdTokenMock,
}));

vi.stubGlobal("fetch", fetchMock);

// Mock the auth store. The hook calls useAuthStore with selectCompanyId, so
// the mock returns the value the selector would compute against an in-memory
// auth-state shape. selectCompanyId is exported as a named selector helper —
// preserve the export so the hook's import resolves.
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: <T>(
    selector: (state: { company: { id: string } | null }) => T
  ) => selector({ company: { id: "co-1" } }),
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
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  getIdTokenMock.mockReset();
  getIdTokenMock.mockResolvedValue("firebase-token");
});

describe("useClientThreads", () => {
  it("does not fire listSiblings when clientId is null", async () => {
    const { result } = renderHook(
      () => useClientThreads(null, { excludeId: "t-current" }),
      { wrapper }
    );
    // The query should be parked — TanStack reports `idle` fetchStatus
    // until `enabled` flips true.
    expect(result.current.fetchStatus).toBe("idle");
    // Allow any microtask-deferred fetch to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fire listSiblings when excludeId is null", async () => {
    const { result } = renderHook(
      () => useClientThreads("c-1", { excludeId: null }),
      { wrapper }
    );
    expect(result.current.fetchStatus).toBe("idle");
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads siblings through the authenticated anchor-thread route", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn(async () => ({
        threads: [
          {
            id: "t-2",
            subject: "Roof quote",
            labels: [],
            unreadCount: 1,
            lastMessageAt: "2026-07-15T11:00:00.000Z",
            latestDirection: "inbound",
            archivedAt: null,
          },
        ],
      })),
    });

    const { result } = renderHook(
      () => useClientThreads("c-1", { excludeId: "t-current" }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: "t-2",
        subject: "Roof quote",
        lastMessageAt: new Date("2026-07-15T11:00:00.000Z"),
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/inbox/threads/t-current/siblings",
      { headers: { Authorization: "Bearer firebase-token" } }
    );
  });
});
