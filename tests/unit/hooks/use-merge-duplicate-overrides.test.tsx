/**
 * useMergeDuplicate + useMergeConflicts — payload wiring (Surface 1).
 *
 * Asserts that useMergeDuplicate forwards the operator-confirmed
 * confirmedOverrides to POST /api/duplicates/[id]/merge (and stops sending the
 * empty fieldOverrides), and that useMergeConflicts posts { reviewIds, winnerId }
 * to /api/duplicates/conflicts and returns the service shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co-1" } }),
}));

import { useMergeDuplicate, useMergeConflicts } from "@/lib/hooks/use-duplicate-reviews";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function lastBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe("useMergeDuplicate — confirmedOverrides wiring", () => {
  it("forwards confirmedOverrides to the merge route and omits fieldOverrides", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const { result } = renderHook(() => useMergeDuplicate(), { wrapper });

    result.current.mutate({
      reviewIds: ["r-1"],
      winnerId: "w-1",
      confirmedOverrides: { contact_email: "b@y.com" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/duplicates/r-1/merge");
    const body = lastBody();
    expect(body.winnerId).toBe("w-1");
    expect(body.confirmedOverrides).toEqual({ contact_email: "b@y.com" });
    expect(body).not.toHaveProperty("fieldOverrides");
  });

  it("sends no confirmedOverrides when the override map is empty", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const { result } = renderHook(() => useMergeDuplicate(), { wrapper });

    result.current.mutate({ reviewIds: ["r-1"], winnerId: "w-1", confirmedOverrides: {} });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(lastBody().confirmedOverrides).toBeUndefined();
  });

  it("forwards a per-loser keyed override map for multi-loser clusters", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const { result } = renderHook(() => useMergeDuplicate(), { wrapper });

    result.current.mutate({
      reviewIds: ["r-1", "r-2"],
      winnerId: "w-1",
      confirmedOverrides: { "loser-1": { contact_email: "b@y.com" } },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const body = lastBody();
    expect(body.additionalReviewIds).toEqual(["r-2"]);
    expect(body.confirmedOverrides).toEqual({ "loser-1": { contact_email: "b@y.com" } });
  });

  it("forwards success-notification display fields to the merge route", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const { result } = renderHook(() => useMergeDuplicate(), { wrapper });

    result.current.mutate({
      reviewIds: ["r-1"],
      winnerId: "w-1",
      confirmedOverrides: {},
      winnerTitle: "Deck — Smith",
      absorbedCount: 1,
      resolvedCount: 2,
      notificationActionUrl: "/dashboard?openProject=w-1&mode=view",
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const body = lastBody();
    expect(body.winnerTitle).toBe("Deck — Smith");
    expect(body.absorbedCount).toBe(1);
    expect(body.resolvedCount).toBe(2);
    expect(body.notificationActionUrl).toBe(
      "/dashboard?openProject=w-1&mode=view"
    );
  });
});

describe("useMergeConflicts", () => {
  it("posts { reviewIds, winnerId } and returns the service shape", async () => {
    const serviceResult = {
      entityType: "opportunity",
      perLoser: [{ loserId: "loser-1", reconciliation: { fieldFill: {}, conflicts: [] } }],
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => serviceResult });
    const { result } = renderHook(() => useMergeConflicts(), { wrapper });

    result.current.mutate({ reviewIds: ["r-1"], winnerId: "w-1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/duplicates/conflicts");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      reviewIds: ["r-1"],
      winnerId: "w-1",
    });
    expect(result.current.data).toEqual(serviceResult);
  });

  it("throws the route error message on failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "boom" }) });
    const { result } = renderHook(() => useMergeConflicts(), { wrapper });

    result.current.mutate({ reviewIds: ["r-1"], winnerId: "w-1" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("boom");
  });
});
