/**
 * useProjectMutations — workspace-driven project writes.
 *
 * Thin coordinator over existing services:
 *   - ProjectService for project CRUD
 *   - ProjectNoteService.createSystemEvent for the unified timeline rows
 *     (event_kind = project_created / project_archived / photo_uploaded)
 *   - dispatchProjectAssignment for new-member push notifications
 *   - NotificationService.create for archive notifications to existing team
 *   - useCreateProjectNote (re-exported as `postNote`) for user notes
 *
 * What this hook deliberately does NOT do:
 *   - Status changes (those are owned by useUpdateProjectStatus, which
 *     fires ProjectLifecycleService.onProjectStageChange — that service
 *     writes the status_change project_notes row, not this hook)
 *   - Task-level dispatches (taskAssigned, scheduleChange, etc.)
 *   - Insert into the legacy `activities` table
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock recorders ──────────────────────────────────────────────────────────

const projectServiceCreateCalls: Array<Record<string, unknown>> = [];
const projectServiceUpdateCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];
const projectServiceDeleteCalls: string[] = [];
const systemEventCalls: Array<Record<string, unknown>> = [];
const userNoteCalls: Array<Record<string, unknown>> = [];
const dispatchAssignmentCalls: Array<Record<string, unknown>> = [];
const dispatchArchivedCalls: Array<Record<string, unknown>> = [];
const notificationCreateCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/api/services/project-service", () => ({
  ProjectService: {
    createProject: vi.fn(async (data: Record<string, unknown>) => {
      projectServiceCreateCalls.push(data);
      return "new-proj-id";
    }),
    updateProject: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      projectServiceUpdateCalls.push({ id, patch });
    }),
    deleteProject: vi.fn(async (id: string) => {
      projectServiceDeleteCalls.push(id);
    }),
  },
}));

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createSystemEvent: vi.fn(async (input: Record<string, unknown>) => {
      systemEventCalls.push(input);
      return { id: "evt-1", ...input };
    }),
    createNote: vi.fn(async (input: Record<string, unknown>) => {
      userNoteCalls.push(input);
      return { id: "note-1", ...input };
    }),
  },
}));

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchProjectAssignment: vi.fn((params: Record<string, unknown>) => {
    dispatchAssignmentCalls.push(params);
  }),
  dispatchProjectArchived: vi.fn((params: Record<string, unknown>) => {
    dispatchArchivedCalls.push(params);
  }),
}));

vi.mock("@/lib/api/services/notification-service", () => ({
  NotificationService: {
    create: vi.fn(async (params: Record<string, unknown>) => {
      notificationCreateCalls.push(params);
    }),
  },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    currentUser: { id: "user-123", firstName: "Jack" },
    company: { id: "co-1" },
  }),
}));

// ─── Test harness ────────────────────────────────────────────────────────────

import { useProjectMutations } from "@/lib/hooks/use-project-mutations";
import { ProjectStatus } from "@/lib/types/models";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  projectServiceCreateCalls.length = 0;
  projectServiceUpdateCalls.length = 0;
  projectServiceDeleteCalls.length = 0;
  systemEventCalls.length = 0;
  userNoteCalls.length = 0;
  dispatchAssignmentCalls.length = 0;
  dispatchArchivedCalls.length = 0;
  notificationCreateCalls.length = 0;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useProjectMutations", () => {
  it("exposes the documented mutation set", () => {
    const { result } = renderHook(() => useProjectMutations("proj-1"), {
      wrapper: makeWrapper(),
    });
    expect(result.current.saveProject).toBeDefined();
    expect(result.current.createProject).toBeDefined();
    expect(result.current.archiveProject).toBeDefined();
    expect(result.current.deleteProject).toBeDefined();
    expect(result.current.postNote).toBeDefined();
    expect(result.current.uploadPhoto).toBeDefined();
  });

  describe("createProject", () => {
    it("delegates to ProjectService.createProject + writes project_created event_kind + dispatches assignment", async () => {
      const { result } = renderHook(() => useProjectMutations(null), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.createProject.mutateAsync({
          title: "Driveway Sealing — Block 7",
          clientId: "client-1",
          teamMemberIds: ["u-pm", "u-crew-1"],
        });
      });

      // ProjectService called with mapped fields
      expect(projectServiceCreateCalls).toHaveLength(1);
      expect(projectServiceCreateCalls[0]).toMatchObject({
        title: "Driveway Sealing — Block 7",
        companyId: "co-1",
        clientId: "client-1",
        teamMemberIds: ["u-pm", "u-crew-1"],
      });

      // Timeline row written via createSystemEvent (NOT createNote — that's
      // for user-authored notes; this is a system event)
      expect(systemEventCalls).toHaveLength(1);
      expect(systemEventCalls[0]).toMatchObject({
        projectId: "new-proj-id",
        companyId: "co-1",
        authorId: "user-123",
        eventKind: "project_created",
      });

      // Push notification dispatched to the new team members
      expect(dispatchAssignmentCalls).toHaveLength(1);
      expect(dispatchAssignmentCalls[0]).toMatchObject({
        projectId: "new-proj-id",
        projectTitle: "Driveway Sealing — Block 7",
        newMemberIds: ["u-pm", "u-crew-1"],
        companyId: "co-1",
      });
    });

    it("skips assignment dispatch when no team members are added", async () => {
      const { result } = renderHook(() => useProjectMutations(null), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.createProject.mutateAsync({
          title: "Solo project",
          teamMemberIds: [],
        });
      });

      expect(systemEventCalls).toHaveLength(1);
      expect(dispatchAssignmentCalls).toHaveLength(0);
    });

    it("does NOT call createNote (system events go through createSystemEvent)", async () => {
      const { result } = renderHook(() => useProjectMutations(null), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.createProject.mutateAsync({ title: "Test" });
      });

      expect(userNoteCalls).toHaveLength(0);
    });
  });

  describe("saveProject", () => {
    it("delegates to ProjectService.updateProject", async () => {
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.saveProject.mutateAsync({
          projectId: "proj-1",
          patch: { title: "Updated title" },
        });
      });

      expect(projectServiceUpdateCalls).toEqual([
        { id: "proj-1", patch: { title: "Updated title" } },
      ]);
    });

    it("dispatches assignment notification only for newly added team members", async () => {
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.saveProject.mutateAsync({
          projectId: "proj-1",
          patch: {
            title: "Driveway Sealing",
            teamMemberIds: ["u-existing", "u-new-1", "u-new-2"],
          },
          previousTeamMemberIds: ["u-existing"],
        });
      });

      expect(dispatchAssignmentCalls).toHaveLength(1);
      expect(dispatchAssignmentCalls[0]).toMatchObject({
        projectId: "proj-1",
        newMemberIds: ["u-new-1", "u-new-2"], // only the delta
        companyId: "co-1",
      });
    });

    it("does NOT dispatch assignment when the team is unchanged", async () => {
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.saveProject.mutateAsync({
          projectId: "proj-1",
          patch: { teamMemberIds: ["u-1", "u-2"] },
          previousTeamMemberIds: ["u-1", "u-2"],
        });
      });

      expect(dispatchAssignmentCalls).toHaveLength(0);
    });

    it("does NOT dispatch when previousTeamMemberIds is omitted (trivial save)", async () => {
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.saveProject.mutateAsync({
          projectId: "proj-1",
          patch: { title: "Renamed" },
        });
      });

      expect(dispatchAssignmentCalls).toHaveLength(0);
      expect(systemEventCalls).toHaveLength(0);
    });
  });

  describe("archiveProject", () => {
    it("updates status to Archived, writes project_archived event, and notifies team", async () => {
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.archiveProject.mutateAsync({
          projectId: "proj-1",
          projectTitle: "Driveway Sealing",
          notifyUserIds: ["u-pm", "u-crew-1"],
        });
      });

      expect(projectServiceUpdateCalls).toEqual([
        { id: "proj-1", patch: { status: ProjectStatus.Archived } },
      ]);

      expect(systemEventCalls).toHaveLength(1);
      expect(systemEventCalls[0]).toMatchObject({
        projectId: "proj-1",
        eventKind: "project_archived",
        authorId: "user-123",
      });

      // Archive notifications now go through dispatchProjectArchived
      // (Phase 11: centralized push + in-app dispatch). The dispatch route
      // filters out the acting user server-side.
      expect(dispatchArchivedCalls).toHaveLength(1);
      expect(dispatchArchivedCalls[0]).toMatchObject({
        projectId: "proj-1",
        projectTitle: "Driveway Sealing",
        recipientUserIds: ["u-pm", "u-crew-1"],
        companyId: "co-1",
      });
      // archivedByName is composed from currentUser; "Jack" since lastName is omitted
      expect(dispatchArchivedCalls[0].archivedByName).toBe("Jack");
      // The hook no longer calls NotificationService.create directly for archive
      expect(notificationCreateCalls).toHaveLength(0);
    });
  });

  describe("deleteProject", () => {
    it("delegates to ProjectService.deleteProject", async () => {
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.deleteProject.mutateAsync("proj-1");
      });

      expect(projectServiceDeleteCalls).toEqual(["proj-1"]);
      // Soft delete writes no timeline event by design
      expect(systemEventCalls).toHaveLength(0);
    });
  });

  describe("uploadPhoto", () => {
    it("writes photo_uploaded event with attachments", async () => {
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });

      const attachments = [
        { url: "https://cdn.test/a.jpg", caption: null, markedUpUrl: null },
        { url: "https://cdn.test/b.jpg", caption: "After", markedUpUrl: null },
      ];

      await act(async () => {
        await result.current.uploadPhoto.mutateAsync({
          projectId: "proj-1",
          attachments,
          caption: "Final shots",
        });
      });

      expect(systemEventCalls).toHaveLength(1);
      expect(systemEventCalls[0]).toMatchObject({
        projectId: "proj-1",
        eventKind: "photo_uploaded",
        authorId: "user-123",
        content: "Final shots",
        attachments,
      });
      expect(systemEventCalls[0].contentMetadata).toMatchObject({
        photoCount: 2,
        urls: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"],
      });
    });

    it("falls back to '<n> photos added' when no caption is provided", async () => {
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.uploadPhoto.mutateAsync({
          projectId: "proj-1",
          attachments: [
            { url: "https://cdn.test/a.jpg", caption: null, markedUpUrl: null },
          ],
        });
      });

      expect(systemEventCalls[0]).toMatchObject({
        eventKind: "photo_uploaded",
        content: "1 photo added",
      });
    });

    it("does NOT dispatch task-level events (taskCompleted, scheduleChange)", async () => {
      // Sanity: this hook owns project events only. Task events are out of scope.
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });
      // No surface for it — we just confirm the public API doesn't include them.
      expect((result.current as Record<string, unknown>).completeTask).toBeUndefined();
      expect((result.current as Record<string, unknown>).changeSchedule).toBeUndefined();
    });
  });

  describe("postNote (delegated to useCreateProjectNote)", () => {
    it("calls ProjectNoteService.createNote (NOT createSystemEvent)", async () => {
      const { result } = renderHook(() => useProjectMutations("proj-1"), {
        wrapper: makeWrapper(),
      });

      await act(async () => {
        await result.current.postNote.mutateAsync({
          projectId: "proj-1",
          companyId: "co-1",
          authorId: "user-123",
          content: "Crew arrived on site at 7am.",
        });
      });

      expect(userNoteCalls).toHaveLength(1);
      expect(userNoteCalls[0]).toMatchObject({
        projectId: "proj-1",
        content: "Crew arrived on site at 7am.",
      });
      // This is a user note — should NOT carry an event_kind
      expect(systemEventCalls).toHaveLength(0);
    });
  });
});
