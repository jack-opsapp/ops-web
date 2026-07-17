/**
 * Integration test for the workspace archive flow (Phase 11.5).
 *
 * Drives the mutation under test (`useProjectMutations.archiveProject`)
 * and asserts archive goes through the guarded server lifecycle boundary.
 * The database transaction owns the status write + durable lifecycle outbox;
 * the worker owns the timeline and notification side effects.
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
const lifecycleStatusMock = vi.fn<
  (id: string, status: ProjectStatus) => Promise<void>
>(() => Promise.resolve());

vi.mock("@/lib/api/services/lifecycle-mutation-service", () => ({
  LifecycleMutationService: {
    updateProjectStatus: (id: string, status: ProjectStatus) =>
      lifecycleStatusMock(id, status),
  },
}));

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
  lifecycleStatusMock.mockClear();
});

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useProjectMutations.archiveProject — durable boundary", () => {
  it("routes archive through the guarded lifecycle mutation", async () => {
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

    expect(lifecycleStatusMock).toHaveBeenCalledWith(
      "p-1",
      ProjectStatus.Archived
    );
    expect(updateProjectMock).not.toHaveBeenCalled();
    expect(createSystemEventMock).not.toHaveBeenCalled();
    expect(archivedDispatches).toHaveLength(0);
  });

  it("does not depend on a client-supplied notification list", async () => {
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

    expect(lifecycleStatusMock).toHaveBeenCalledWith(
      "p-1",
      ProjectStatus.Archived
    );
    expect(archivedDispatches).toHaveLength(0);
  });
});
