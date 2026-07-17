import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireSupabase: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: mocks.requireSupabase,
}));

import { TaskApprovalMutationService } from "@/lib/api/services/task-approval-mutation-service";

function currentTaskQuery(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSupabase.mockReturnValue({
    rpc: mocks.rpc,
    from: vi.fn(() =>
      currentTaskQuery({
        data: { updated_at: "2026-07-20T11:00:00.000Z" },
        error: null,
      })
    ),
  });
});

describe("TaskApprovalMutationService", () => {
  it("uses the reviewer and approval action as the durable task identity", async () => {
    mocks.rpc.mockResolvedValue({
      data: { task_id: "action-1", created: true },
      error: null,
    });

    await expect(
      TaskApprovalMutationService.createTask({
        actorUserId: "reviewer-1",
        taskId: "action-1",
        projectId: "project-1",
        taskTypeId: "type-1",
        customTitle: "Frame addition",
        teamMemberIds: ["member-1"],
        startDate: "2026-07-21T16:00:00.000Z",
        endDate: "2026-07-22T16:00:00.000Z",
        duration: 2,
      })
    ).resolves.toEqual({ taskId: "action-1", created: true });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_task_with_event_as_system",
      expect.objectContaining({
        p_actor_user_id: "reviewer-1",
        p_task_id: "action-1",
        p_project_id: "project-1",
        p_team_member_ids: ["member-1"],
      })
    );
  });

  it("fails closed when the RPC does not return its idempotency result", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(
      TaskApprovalMutationService.createTask({
        actorUserId: "reviewer-1",
        taskId: "action-1",
        projectId: "project-1",
        taskTypeId: "type-1",
        customTitle: "Frame addition",
      })
    ).rejects.toThrow("invalid result");
  });

  it("updates through the reviewer-attributed guarded RPC with a current-row CAS", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ok: true,
        conflict: false,
        changed: true,
        schedule_changed: true,
        schedule_version: 9,
      },
      error: null,
    });

    await expect(
      TaskApprovalMutationService.updateTask({
        actorUserId: "reviewer-1",
        taskId: "task-1",
        patch: {
          start_date: "2026-07-21T16:00:00.000Z",
          team_member_ids: ["member-1"],
        },
      })
    ).resolves.toEqual({
      changed: true,
      scheduleChanged: true,
      scheduleVersion: 9,
    });

    expect(mocks.rpc).toHaveBeenCalledWith("update_task_with_event_as_system", {
      p_actor_user_id: "reviewer-1",
      p_task_id: "task-1",
      p_expected_updated_at: "2026-07-20T11:00:00.000Z",
      p_patch: {
        start_date: "2026-07-21T16:00:00.000Z",
        team_member_ids: ["member-1"],
      },
    });
  });

  it("fails closed when an approved task changed before execution", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ok: false,
        conflict: true,
        schedule_version: 10,
      },
      error: null,
    });

    await expect(
      TaskApprovalMutationService.updateTask({
        actorUserId: "reviewer-1",
        taskId: "task-1",
        patch: { custom_title: "Stale title" },
      })
    ).rejects.toThrow("changed before execution");
  });
});
