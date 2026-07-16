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

import { PUT } from "@/app/api/users/[id]/role/route";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const OLD_ROLE_ID = "33333333-3333-4333-8333-333333333333";
const NEW_ROLE_ID = "00000000-0000-0000-0000-000000000004";
const LEAD_ID = "55555555-5555-4555-8555-555555555555";

const validBody = {
  expectedRoleId: OLD_ROLE_ID,
  newRoleId: NEW_ROLE_ID,
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
      role_id: NEW_ROLE_ID,
      legacy_role: "operator",
      resolved_assignments: 0,
    },
    error: null,
  });
});

describe("PUT /api/users/[id]/role", () => {
  it("requires bearer authentication and never accepts a body token", async () => {
    const response = await PUT(
      request({ ...validBody, idToken: "body-token" }, null),
      context
    );
    expect(response.status).toBe(401);
    expect(verifyAuthMock).not.toHaveBeenCalled();
  });

  it("requires exactly the three shared fields", async () => {
    const missing = { ...validBody } as Record<string, unknown>;
    delete missing.assignmentResolutions;
    expect((await PUT(request(missing), context)).status).toBe(400);
    expect(
      (await PUT(request({ ...validBody, roleId: NEW_ROLE_ID }), context))
        .status
    ).toBe(400);
  });

  it("accepts explicit null snapshots for assignment and removal", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        user_id: TARGET_ID,
        role_id: null,
        legacy_role: "unassigned",
        resolved_assignments: 0,
      },
      error: null,
    });
    const response = await PUT(
      request({
        expectedRoleId: null,
        newRoleId: null,
        assignmentResolutions: [],
      }),
      context
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ roleId: null });
  });

  it("requires exact snake-case assignment snapshots", async () => {
    const response = await PUT(
      request({
        ...validBody,
        assignmentResolutions: [
          {
            opportunityId: LEAD_ID,
            expectedAssignedTo: TARGET_ID,
            expectedAssignmentVersion: 8,
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
      expected_assignment_version: 8,
      new_assigned_to: null,
    };
    const response = await PUT(
      request({ ...validBody, assignmentResolutions: [resolution] }),
      context
    );

    expect(response.status).toBe(200);
    expect(findUserMock).toHaveBeenCalledWith(
      "firebase-1",
      "boss@ops.co",
      "id, company_id"
    );
    expect(rpcMock).toHaveBeenCalledWith("replace_user_role_as_system", {
      p_actor_user_id: CALLER_ID,
      p_target_user_id: TARGET_ID,
      p_expected_role_id: OLD_ROLE_ID,
      p_new_role_id: NEW_ROLE_ID,
      p_assignment_resolutions: [resolution],
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      userId: TARGET_ID,
      roleId: NEW_ROLE_ID,
      legacyRole: "operator",
      resolvedAssignments: 0,
    });
  });

  it("returns structured assignment and role snapshot conflicts", async () => {
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
        details: JSON.stringify({ current_role_id: OLD_ROLE_ID }),
      },
    });
    const snapshot = await PUT(request(validBody), context);
    expect(snapshot.status).toBe(409);
    await expect(snapshot.json()).resolves.toEqual({
      code: "permission_snapshot_mismatch",
      currentRoleId: OLD_ROLE_ID,
    });
  });
});
