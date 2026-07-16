import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { verifyAuthMock, findUserMock, rpcMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  findUserMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: rpcMock }),
}));
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: (token: string) => verifyAuthMock(token),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: (...args: unknown[]) => findUserMock(...args),
}));

import { PUT } from "@/app/api/users/[id]/permission-overrides/route";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "33333333-3333-4333-8333-333333333333";

const validBody = {
  expectedOverrides: [
    { permission: "pipeline.edit", scope: "assigned", granted: true },
    { permission: "pipeline.manage", scope: null, granted: false },
  ],
  set: [{ permission: "pipeline.edit", scope: null, granted: false }],
  clear: ["pipeline.view"],
  assignmentResolutions: [],
};

function request(
  body: unknown,
  token: string | null = "firebase-token"
): NextRequest {
  return {
    json: async () => body,
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
  } as unknown as NextRequest;
}

const context = { params: Promise.resolve({ id: TARGET_ID }) };

beforeEach(() => {
  verifyAuthMock.mockReset();
  findUserMock.mockReset();
  rpcMock.mockReset();
  verifyAuthMock.mockResolvedValue({ uid: "firebase-1", email: "boss@ops.co" });
  findUserMock.mockResolvedValue({ id: CALLER_ID });
  rpcMock.mockResolvedValue({
    data: {
      ok: true,
      user_id: TARGET_ID,
      overrides: validBody.expectedOverrides,
      resolved_assignments: 0,
    },
    error: null,
  });
});

describe("PUT /api/users/[id]/permission-overrides", () => {
  it("requires bearer authentication and rejects a body token", async () => {
    const response = await PUT(
      request({ ...validBody, idToken: "body-token" }, null),
      context
    );
    expect(response.status).toBe(401);
    expect(verifyAuthMock).not.toHaveBeenCalled();
  });

  it("requires the exact four-field shared body", async () => {
    const missing = { ...validBody } as Record<string, unknown>;
    delete missing.assignmentResolutions;
    expect((await PUT(request(missing), context)).status).toBe(400);
    expect(
      (await PUT(request({ ...validBody, extra: true }), context)).status
    ).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("requires canonical expected, set, and clear ordering", async () => {
    expect(
      (
        await PUT(
          request({
            ...validBody,
            expectedOverrides: [...validBody.expectedOverrides].reverse(),
          }),
          context
        )
      ).status
    ).toBe(400);
    expect(
      (
        await PUT(
          request({ ...validBody, clear: ["pipeline.view", "pipeline.edit"] }),
          context
        )
      ).status
    ).toBe(400);
  });

  it("rejects hidden set entries, unsupported scopes, and set-clear overlap", async () => {
    const hidden = await PUT(
      request({
        ...validBody,
        set: [{ permission: "pipeline.manage", scope: "all", granted: true }],
      }),
      context
    );
    expect(hidden.status).toBe(400);

    const unsupported = await PUT(
      request({
        ...validBody,
        set: [
          { permission: "pipeline.create", scope: "assigned", granted: true },
        ],
      }),
      context
    );
    expect(unsupported.status).toBe(400);

    const overlap = await PUT(
      request({
        ...validBody,
        set: [{ permission: "pipeline.view", scope: "all", granted: true }],
      }),
      context
    );
    expect(overlap.status).toBe(400);
  });

  it("requires exact snake-case assignment snapshots", async () => {
    const response = await PUT(
      request({
        ...validBody,
        assignmentResolutions: [
          {
            opportunityId: LEAD_ID,
            expectedAssignedTo: TARGET_ID,
            expectedAssignmentVersion: 4,
            newAssignedTo: null,
          },
        ],
      }),
      context
    );
    expect(response.status).toBe(400);
  });

  it("calls the guarded RPC with the authenticated OPS actor", async () => {
    const resolution = {
      opportunity_id: LEAD_ID,
      expected_assigned_to: TARGET_ID,
      expected_assignment_version: 4,
      new_assigned_to: CALLER_ID,
    };
    const response = await PUT(
      request({ ...validBody, assignmentResolutions: [resolution] }),
      context
    );

    expect(response.status).toBe(200);
    expect(findUserMock).toHaveBeenCalledWith(
      "firebase-1",
      "boss@ops.co",
      "id"
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "apply_user_permission_overrides_as_system",
      {
        p_actor_user_id: CALLER_ID,
        p_target_user_id: TARGET_ID,
        p_expected_overrides: validBody.expectedOverrides,
        p_set: validBody.set,
        p_clear: validBody.clear,
        p_assignment_resolutions: [resolution],
      }
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      userId: TARGET_ID,
      overrides: validBody.expectedOverrides,
      resolvedAssignments: 0,
    });
  });

  it("returns structured assignment and snapshot conflicts", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "40001",
        message: "assignment_resolution_required",
        details: JSON.stringify({
          stranded_count: 1,
          stranded: [{ opportunity_id: LEAD_ID }],
          eligible_assignees: [],
        }),
      },
    });
    const assignment = await PUT(request(validBody), context);
    expect(assignment.status).toBe(409);
    await expect(assignment.json()).resolves.toMatchObject({
      code: "assignment_resolution_required",
      strandedCount: 1,
      eligibleAssignees: [],
    });

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "40001",
        message: "permission_snapshot_mismatch",
        details: JSON.stringify({ current_overrides: [] }),
      },
    });
    const snapshot = await PUT(request(validBody), context);
    expect(snapshot.status).toBe(409);
    await expect(snapshot.json()).resolves.toEqual({
      code: "permission_snapshot_mismatch",
      currentOverrides: [],
    });
  });
});
