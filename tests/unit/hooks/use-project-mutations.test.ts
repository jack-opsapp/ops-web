/**
 * useProjectMutations — workspace-driven project writes.
 *
 * Each mutation:
 *   1. Persists the project change
 *   2. Inserts an `activities` row (system event + optional content)
 *   3. Notifies the relevant audience (assignment dispatch or direct
 *      `notifications` insert depending on the event)
 *   4. Invalidates relevant query keys
 *
 * Drift surfaced (recorded in commit + phase report):
 *   The existing useCreateProject / useUpdateProject / useUpdateProjectStatus
 *   in src/lib/hooks/use-projects.ts dispatch notifications but do NOT
 *   insert an activities row. These new hooks add the activity-insertion
 *   path; the old hooks remain intact for the surfaces that haven't
 *   migrated to the workspace yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock recorders ──────────────────────────────────────────────────────────

interface ActivityInsert {
  type: string;
  subject: string | null;
  content: string | null;
  project_id: string;
  company_id: string;
  created_by: string | null;
  attachment_ids?: string[] | null;
}

interface NotificationInsert {
  user_id: string;
  company_id: string;
  type: string;
  title: string;
  body: string;
  project_id: string | null;
  action_url: string | null;
  action_label: string | null;
}

const projectInserts: Record<string, unknown>[] = [];
const projectUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
const activityInserts: ActivityInsert[] = [];
const notificationInserts: NotificationInsert[] = [];
const dispatchAssignments: Array<{
  projectId: string;
  newMemberIds: string[];
  companyId: string;
  projectTitle: string;
}> = [];

// ─── Mock supabase ────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      if (table === "projects") {
        return {
          insert: (row: Record<string, unknown>) => {
            projectInserts.push(row);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "new-proj-id", ...row },
                    error: null,
                  }),
              }),
            };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              projectUpdates.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "activities") {
        return {
          insert: (row: ActivityInsert) => {
            activityInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "notifications") {
        return {
          insert: (row: NotificationInsert | NotificationInsert[]) => {
            const rows = Array.isArray(row) ? row : [row];
            for (const r of rows) notificationInserts.push(r);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

// ─── Mock notification-dispatch ───────────────────────────────────────────────

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchProjectAssignment: (params: {
    projectId: string;
    newMemberIds: string[];
    companyId: string;
    projectTitle: string;
  }) => {
    dispatchAssignments.push(params);
  },
}));

// ─── Mock auth store ─────────────────────────────────────────────────────────

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    currentUser: { id: "user-123", firstName: "Jack" },
    company: { id: "co-1" },
  }),
}));

// ─── Test harness ────────────────────────────────────────────────────────────

import {
  useCreateProjectWithActivity,
  useUpdateProjectStatusWithActivity,
  usePostProjectNote,
  useUploadProjectPhotoActivity,
} from "@/lib/hooks/use-project-mutations";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  projectInserts.length = 0;
  projectUpdates.length = 0;
  activityInserts.length = 0;
  notificationInserts.length = 0;
  dispatchAssignments.length = 0;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useCreateProjectWithActivity", () => {
  it("creates the project, inserts a system activity, and dispatches assignment", async () => {
    const { result } = renderHook(() => useCreateProjectWithActivity(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        title: "Driveway Sealing — Block 7",
        client_id: null,
        team_member_ids: ["u-pm", "u-crew-1"],
      });
    });

    expect(projectInserts).toHaveLength(1);
    expect(projectInserts[0]).toMatchObject({
      title: "Driveway Sealing — Block 7",
      company_id: "co-1",
    });

    expect(activityInserts).toHaveLength(1);
    expect(activityInserts[0]).toMatchObject({
      type: "system",
      project_id: "new-proj-id",
      company_id: "co-1",
      created_by: "user-123",
    });
    expect(activityInserts[0].subject).toMatch(/created/i);

    expect(dispatchAssignments).toHaveLength(1);
    expect(dispatchAssignments[0]).toMatchObject({
      projectId: "new-proj-id",
      projectTitle: "Driveway Sealing — Block 7",
      newMemberIds: ["u-pm", "u-crew-1"],
      companyId: "co-1",
    });
  });

  it("skips assignment dispatch when there are no team members", async () => {
    const { result } = renderHook(() => useCreateProjectWithActivity(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        title: "Solo project",
        client_id: null,
        team_member_ids: [],
      });
    });

    expect(activityInserts).toHaveLength(1);
    expect(dispatchAssignments).toHaveLength(0);
  });
});

describe("useUpdateProjectStatusWithActivity", () => {
  it("updates status, writes a system activity, notifies assigned crew", async () => {
    const { result } = renderHook(() => useUpdateProjectStatusWithActivity(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        projectTitle: "Driveway Sealing",
        newStatus: "Complete",
        previousStatus: "InProgress",
        notifyUserIds: ["u-pm", "u-crew-1"],
      });
    });

    expect(projectUpdates).toEqual([
      { id: "proj-1", patch: { status: "Complete" } },
    ]);

    expect(activityInserts).toHaveLength(1);
    expect(activityInserts[0]).toMatchObject({
      type: "system",
      project_id: "proj-1",
      company_id: "co-1",
      created_by: "user-123",
    });
    expect(activityInserts[0].subject).toMatch(/Complete/);

    expect(notificationInserts).toHaveLength(2);
    expect(notificationInserts.map((n) => n.user_id).sort()).toEqual([
      "u-crew-1",
      "u-pm",
    ]);
    expect(notificationInserts[0]).toMatchObject({
      type: "project_status_changed",
      project_id: "proj-1",
      action_url: "/projects/proj-1",
    });
  });
});

describe("usePostProjectNote", () => {
  it("inserts a 'note' activity and notifies the audience", async () => {
    const { result } = renderHook(() => usePostProjectNote(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        projectTitle: "Driveway Sealing",
        content: "Crew arrived on site at 7am. All quiet.",
        notifyUserIds: ["u-pm"],
      });
    });

    expect(activityInserts).toHaveLength(1);
    expect(activityInserts[0]).toMatchObject({
      type: "note",
      project_id: "proj-1",
      content: "Crew arrived on site at 7am. All quiet.",
      created_by: "user-123",
    });

    expect(notificationInserts).toHaveLength(1);
    expect(notificationInserts[0]).toMatchObject({
      user_id: "u-pm",
      type: "project_note_posted",
      project_id: "proj-1",
    });
  });
});

describe("useUploadProjectPhotoActivity", () => {
  it("inserts a 'note' activity carrying attachment_ids", async () => {
    const { result } = renderHook(() => useUploadProjectPhotoActivity(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        projectTitle: "Driveway Sealing",
        photoIds: ["photo-A", "photo-B"],
        caption: "After-shot",
        notifyUserIds: ["u-pm"],
      });
    });

    expect(activityInserts).toHaveLength(1);
    expect(activityInserts[0]).toMatchObject({
      type: "note",
      project_id: "proj-1",
      content: "After-shot",
      attachment_ids: ["photo-A", "photo-B"],
    });

    expect(notificationInserts).toHaveLength(1);
    expect(notificationInserts[0]).toMatchObject({
      user_id: "u-pm",
      type: "project_photo_added",
    });
  });
});
