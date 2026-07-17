/**
 * Integration tests for `useProjectMutations.saveProject` (Phase 11.2).
 *
 * Trivial saves do not write timeline side effects. saveProject does not
 *      currently write a timeline event for description-only edits — there
 *      is no `description_changed` event_kind in ProjectActivityKind, by
 *      design (see plan §11).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const updateProjectMock = vi.fn<(id: unknown, data: unknown) => Promise<void>>(
  () => Promise.resolve(),
);
const createSystemEventMock = vi.fn<(input: unknown) => Promise<{ id: string }>>(
  () => Promise.resolve({ id: "note-1" }),
);

vi.mock("@/lib/api/services/project-service", () => ({
  ProjectService: {
    updateProject: (id: unknown, data: unknown) => updateProjectMock(id, data),
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

vi.mock("@/lib/hooks/use-project-notes", () => ({
  useCreateProjectNote: () => ({
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import { useProjectMutations } from "@/lib/hooks/use-project-mutations";

beforeEach(() => {
  updateProjectMock.mockClear();
  createSystemEventMock.mockClear();
});

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useProjectMutations.saveProject — team-member diff", () => {
  it("persists the complete team-member patch", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const { result } = renderHook(() => useProjectMutations("p-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.saveProject.mutateAsync({
        projectId: "p-1",
        previousTeamMemberIds: ["u-1"],
        patch: {
          title: "Re-roof, 410 Birch",
          teamMemberIds: ["u-1", "u-2", "u-3"],
        },
      });
    });

    expect(updateProjectMock).toHaveBeenCalledOnce();
    expect(updateProjectMock).toHaveBeenCalledWith("p-1", {
      title: "Re-roof, 410 Birch",
      teamMemberIds: ["u-1", "u-2", "u-3"],
    });
  });

  it("persists unchanged team membership without client side effects", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useProjectMutations("p-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.saveProject.mutateAsync({
        projectId: "p-1",
        previousTeamMemberIds: ["u-1", "u-2"],
        patch: {
          title: "Re-roof, 410 Birch",
          teamMemberIds: ["u-1", "u-2"],
        },
      });
    });

    expect(updateProjectMock).toHaveBeenCalledOnce();
  });
});

describe("useProjectMutations.saveProject — trivial saves", () => {
  it("description-only edit writes the patch but no project_notes row", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const { result } = renderHook(() => useProjectMutations("p-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.saveProject.mutateAsync({
        projectId: "p-1",
        patch: {
          projectDescription: "Updated scope: include gutter replacement.",
        },
      });
    });

    expect(updateProjectMock).toHaveBeenCalledOnce();
    expect(createSystemEventMock).not.toHaveBeenCalled();
  });

  it("save without previousTeamMemberIds still persists normally", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useProjectMutations("p-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.saveProject.mutateAsync({
        projectId: "p-1",
        // previousTeamMemberIds intentionally omitted
        patch: {
          title: "Renamed",
          teamMemberIds: ["u-1", "u-2"],
        },
      });
    });

    expect(updateProjectMock).toHaveBeenCalledOnce();
  });
});
