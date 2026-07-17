import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { ReactNode } from "react";

// vi.mock is hoisted; use vi.hoisted() so the spy is initialised before
// the mock factory runs.
const { fetchAllProjects } = vi.hoisted(() => ({ fetchAllProjects: vi.fn() }));

vi.mock("@/lib/api/services/project-service", () => ({
  ProjectService: { fetchAllProjects },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co-1" } }),
}));

import { useClientProjects } from "@/lib/hooks/use-client-projects";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchAllProjects.mockReset();
});

describe("useClientProjects", () => {
  it("does not fire the service when clientId is null", async () => {
    fetchAllProjects.mockResolvedValue([]);
    renderHook(() => useClientProjects(null), { wrapper });
    // small await to let any accidental queries settle
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchAllProjects).not.toHaveBeenCalled();
  });

  it("calls ProjectService.fetchAllProjects with companyId + clientId", async () => {
    fetchAllProjects.mockResolvedValue([]);
    renderHook(() => useClientProjects("client-42"), { wrapper });
    await waitFor(() => expect(fetchAllProjects).toHaveBeenCalled());
    expect(fetchAllProjects).toHaveBeenCalledWith("co-1", { clientId: "client-42" });
  });

  it("returns the project list when the query resolves", async () => {
    const projects = [{ id: "p1" }, { id: "p2" }];
    fetchAllProjects.mockResolvedValue(projects);
    const { result } = renderHook(() => useClientProjects("client-42"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(projects);
  });
});
