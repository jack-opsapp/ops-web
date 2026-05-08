/**
 * Integration tests for `useProjectMutations.createProject` (Phase 11.2).
 *
 * Asserts the full create-flow side effects:
 *   1. ProjectService.createProject inserts the project row.
 *   2. ProjectNoteService.createSystemEvent writes a project_created entry
 *      to the unified workspace timeline.
 *   3. dispatchProjectAssignment fires once with all initial team members.
 *
 * Strategy: stub the two services + dispatch helper + auth store, then
 * mount the hook and run mutateAsync. We inspect the captured calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock state ────────────────────────────────────────────────────────────

const createProjectMock = vi.fn(() => Promise.resolve("p-new"));
const createSystemEventMock = vi.fn(() =>
  Promise.resolve({ id: "note-1" }),
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
    createProject: (...args: unknown[]) => createProjectMock(...args),
  },
}));

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createSystemEvent: (...args: unknown[]) => createSystemEventMock(...args),
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
  assignmentDispatches.length = 0;
});

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("useProjectMutations.createProject", () => {
  it("inserts project row, writes project_created timeline event, dispatches assignment to initial team", async () => {
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
    const createArgs = createProjectMock.mock.calls[0][0] as Record<string, unknown>;
    expect(createArgs.title).toBe("Re-roof, 410 Birch");
    expect(createArgs.teamMemberIds).toEqual(["u-1", "u-2", "u-3"]);
    expect(createArgs.companyId).toBe("co-1");

    // (b) timeline event written with project_created kind
    expect(createSystemEventMock).toHaveBeenCalledOnce();
    const ev = createSystemEventMock.mock.calls[0][0] as Record<string, unknown>;
    expect(ev.eventKind).toBe("project_created");
    expect(ev.projectId).toBe("p-new");
    expect(ev.companyId).toBe("co-1");
    expect(ev.authorId).toBe("u-1");

    // (c) assignment dispatch fired once with full initial team
    expect(assignmentDispatches).toHaveLength(1);
    expect(assignmentDispatches[0].projectId).toBe("p-new");
    expect(assignmentDispatches[0].newMemberIds.sort()).toEqual([
      "u-1",
      "u-2",
      "u-3",
    ]);
    expect(assignmentDispatches[0].companyId).toBe("co-1");
  });

  it("skips assignment dispatch when no team members provided", async () => {
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
    expect(assignmentDispatches).toHaveLength(0);
  });
});
