/**
 * Integration test for the workspace archive flow (Phase 11.5).
 *
 * Drives the mutation under test (`useProjectMutations.archiveProject`)
 * and asserts the three side effects:
 *   1. ProjectService.updateProject sets status to Archived.
 *   2. ProjectNoteService.createSystemEvent writes a project_archived
 *      timeline row.
 *   3. dispatchProjectArchived fires once with the project's team and
 *      the actor's display name (the dispatch route filters out the
 *      acting user server-side, so we pass the full team here).
 *
 * Container-level coverage of "footer click → ConfirmModal → mutation"
 * lives in tests/unit/components/projects-workspace/project-workspace-container.test.tsx.
 * This test pins the post-confirm side-effect contract so backend wiring
 * cannot regress without us noticing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectStatus } from "@/lib/types/models";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const updateProjectMock = vi.fn<(id: unknown, data: unknown) => Promise<void>>(
  () => Promise.resolve(),
);
const createSystemEventMock = vi.fn<(input: unknown) => Promise<{ id: string }>>(
  () => Promise.resolve({ id: "note-archive" }),
);

interface ArchivedDispatchCall {
  projectId: string;
  projectTitle: string;
  archivedByName: string;
  recipientUserIds: string[];
  companyId: string;
}
const archivedDispatches: ArchivedDispatchCall[] = [];

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
  dispatchProjectAssignment: () => {},
  dispatchProjectArchived: (params: ArchivedDispatchCall) => {
    archivedDispatches.push(params);
  },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    company: { id: "co-1" },
    currentUser: { id: "u-1", firstName: "Alex", lastName: "Operator" },
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
  archivedDispatches.length = 0;
});

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useProjectMutations.archiveProject — full side-effect contract", () => {
  it("flips status to Archived, writes the timeline event, dispatches to the team", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useProjectMutations("p-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.archiveProject.mutateAsync({
        projectId: "p-1",
        projectTitle: "Roof Replacement",
        notifyUserIds: ["u-1", "u-2", "u-3"],
      });
    });

    // (a) status patched to Archived
    expect(updateProjectMock).toHaveBeenCalledOnce();
    expect(updateProjectMock.mock.calls[0]![0]).toBe("p-1");
    expect(updateProjectMock.mock.calls[0]![1]).toEqual({
      status: ProjectStatus.Archived,
    });

    // (b) project_archived timeline row written
    expect(createSystemEventMock).toHaveBeenCalledOnce();
    const ev = createSystemEventMock.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(ev.eventKind).toBe("project_archived");
    expect(ev.projectId).toBe("p-1");
    expect(ev.companyId).toBe("co-1");
    expect(ev.authorId).toBe("u-1");

    // (c) team notification dispatched once with the full team — the
    // dispatch route filters the actor server-side, so we pass everyone.
    expect(archivedDispatches).toHaveLength(1);
    expect(archivedDispatches[0].projectId).toBe("p-1");
    expect(archivedDispatches[0].projectTitle).toBe("Roof Replacement");
    expect(archivedDispatches[0].archivedByName).toBe("Alex Operator");
    expect(archivedDispatches[0].recipientUserIds).toEqual([
      "u-1",
      "u-2",
      "u-3",
    ]);
    expect(archivedDispatches[0].companyId).toBe("co-1");
  });

  it("still dispatches even when notifyUserIds is empty (the route no-ops gracefully)", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useProjectMutations("p-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.archiveProject.mutateAsync({
        projectId: "p-1",
        projectTitle: "Solo Project",
        notifyUserIds: [],
      });
    });

    expect(updateProjectMock).toHaveBeenCalledOnce();
    expect(createSystemEventMock).toHaveBeenCalledOnce();
    expect(archivedDispatches).toHaveLength(1);
    expect(archivedDispatches[0].recipientUserIds).toEqual([]);
  });
});
