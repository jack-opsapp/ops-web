/**
 * Integration tests for `useProjectMutations.saveProject` (Phase 11.2).
 *
 * Two behaviors under test:
 *
 *   1. Diff-based assignment dispatch — when previousTeamMemberIds is
 *      passed, only added members get a notification (not the union, not
 *      the full team).
 *
 *   2. Trivial saves don't fire any notifications. saveProject does not
 *      currently write a timeline event for description-only edits — there
 *      is no `description_changed` event_kind in ProjectActivityKind, by
 *      design (see plan §11). So the test asserts NO project_notes write
 *      and NO dispatch when only `projectDescription` changes.
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

interface AssignmentCall {
  projectId: string;
  projectTitle: string;
  newMemberIds: string[];
  companyId: string;
}
const assignmentDispatches: AssignmentCall[] = [];

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

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchProjectAssignment: (params: AssignmentCall) => {
    assignmentDispatches.push(params);
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
  assignmentDispatches.length = 0;
});

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useProjectMutations.saveProject — team-member diff", () => {
  it("only dispatches to newly added members (not the full team)", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
    expect(assignmentDispatches).toHaveLength(1);
    expect(assignmentDispatches[0].newMemberIds.sort()).toEqual([
      "u-2",
      "u-3",
    ]);
    expect(assignmentDispatches[0].projectId).toBe("p-1");
  });

  it("does not dispatch when team membership is unchanged", async () => {
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
    expect(assignmentDispatches).toHaveLength(0);
  });
});

describe("useProjectMutations.saveProject — trivial saves", () => {
  it("description-only edit writes the patch, but no project_notes row and no dispatch", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
    expect(assignmentDispatches).toHaveLength(0);
  });

  it("save without previousTeamMemberIds skips the diff dispatch entirely", async () => {
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
    expect(assignmentDispatches).toHaveLength(0);
  });
});
