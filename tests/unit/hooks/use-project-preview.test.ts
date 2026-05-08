/**
 * useProjectPreview — hover-triggered preview fetch for the calendar
 * card popover.
 *
 * Smoke coverage:
 *   - disabled when projectId is null/undefined
 *   - disabled when options.enabled === false (so the popover can lazy-
 *     fetch only when it actually opens)
 *   - fetches via ProjectPreviewService.fetch when both id + enabled
 *     are present
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchPreview = vi.fn();

vi.mock("@/lib/api/services/project-preview-service", () => ({
  ProjectPreviewService: {
    fetch: (...args: unknown[]) => fetchPreview(...args),
  },
}));

import { useProjectPreview } from "@/lib/hooks/use-project-preview";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  fetchPreview.mockReset();
  fetchPreview.mockResolvedValue({
    id: "proj-1",
    title: "Acme HQ",
    address: "123 Industry Way",
  });
});

describe("useProjectPreview", () => {
  it("does not fetch when projectId is null", () => {
    renderHook(() => useProjectPreview(null), { wrapper: makeWrapper() });
    expect(fetchPreview).not.toHaveBeenCalled();
  });

  it("does not fetch when projectId is undefined", () => {
    renderHook(() => useProjectPreview(undefined), { wrapper: makeWrapper() });
    expect(fetchPreview).not.toHaveBeenCalled();
  });

  it("does not fetch when options.enabled is false", () => {
    renderHook(() => useProjectPreview("proj-1", { enabled: false }), {
      wrapper: makeWrapper(),
    });
    expect(fetchPreview).not.toHaveBeenCalled();
  });

  it("fetches the preview when projectId is set and enabled is unset (default true)", async () => {
    renderHook(() => useProjectPreview("proj-1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledWith("proj-1"));
  });

  it("fetches when enabled is explicitly true", async () => {
    renderHook(() => useProjectPreview("proj-1", { enabled: true }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledWith("proj-1"));
  });

  it("returns the preview data once resolved", async () => {
    const { result } = renderHook(() => useProjectPreview("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({
      id: "proj-1",
      title: "Acme HQ",
    });
  });
});
