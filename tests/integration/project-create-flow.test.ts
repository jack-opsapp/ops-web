/**
 * Integration tests for `useProjectMutations.createProject` (Phase 11.2).
 *
 * Asserts the full create-flow side effects:
 *   1. ProjectService.createProject inserts the project row.
 *   2. ProjectNoteService.createSystemEvent writes a project_created entry
 *      to the unified workspace timeline.
 *
 * Strategy: stub the two services + auth store, then
 * mount the hook and run mutateAsync. We inspect the captured calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock state ────────────────────────────────────────────────────────────

const createProjectMock = vi.fn<(input: unknown) => Promise<string>>(() =>
  Promise.resolve("p-new"),
);
const createSystemEventMock = vi.fn<(input: unknown) => Promise<{ id: string }>>(
  () => Promise.resolve({ id: "note-1" }),
);

vi.mock("@/lib/api/services/project-service", () => ({
  ProjectService: {
    createProject: (input: unknown) => createProjectMock(input),
  },
}));

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createSystemEvent: (input: unknown) => createSystemEventMock(input),
  },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    company: { id: "co-1" },
    currentUser: { id: "u-1", firstName: "Jack", lastName: "Sweet" },
  }),
}));

// useCreateProjectNote is exported alongside the hook we're testing — stub
// it so our hook construction doesn't reach into note-service internals.
vi.mock("@/lib/hooks/use-project-notes", () => ({
  useCreateProjectNote: () => ({
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import { useProjectMutations } from "@/lib/hooks/use-project-mutations";
import { ProjectStatus } from "@/lib/types/models";

beforeEach(() => {
  createProjectMock.mockClear();
  createSystemEventMock.mockClear();
});

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("useProjectMutations.createProject", () => {
  it("inserts the project row and writes the project_created timeline event", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useProjectMutations(null), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.createProject.mutateAsync({
        title: "Re-roof, 410 Birch",
        teamMemberIds: ["u-1", "u-2", "u-3"],
        status: ProjectStatus.RFQ,
      });
    });

    // (a) project row inserted
    expect(createProjectMock).toHaveBeenCalledOnce();
    const createArgs = createProjectMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(createArgs.title).toBe("Re-roof, 410 Birch");
    expect(createArgs.teamMemberIds).toEqual(["u-1", "u-2", "u-3"]);
    expect(createArgs.companyId).toBe("co-1");

    // (b) timeline event written with project_created kind
    expect(createSystemEventMock).toHaveBeenCalledOnce();
    const ev = createSystemEventMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(ev.eventKind).toBe("project_created");
    expect(ev.projectId).toBe("p-new");
    expect(ev.companyId).toBe("co-1");
    expect(ev.authorId).toBe("u-1");
  });

  it("supports creation when no team members are provided", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useProjectMutations(null), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.createProject.mutateAsync({
        title: "Solo Project",
      });
    });

    expect(createProjectMock).toHaveBeenCalledOnce();
    expect(createSystemEventMock).toHaveBeenCalledOnce();
  });
});
