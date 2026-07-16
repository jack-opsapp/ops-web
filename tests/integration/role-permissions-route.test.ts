import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { PERMISSION_EDITOR_REGISTRY } from "@/lib/types/permissions";

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

import { PUT } from "@/app/api/roles/[id]/permissions/route";

const ROLE_ID = "44444444-4444-4444-8444-444444444444";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";

function makeReq(body: unknown, token: string | null = "token-1"): NextRequest {
  return {
    json: async () => body,
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
  } as unknown as NextRequest;
}

const ctx = { params: Promise.resolve({ id: ROLE_ID }) };

const newPermissions = PERMISSION_EDITOR_REGISTRY.map((action) => ({
  permission: action.id,
  scope:
    action.id === "pipeline.view"
      ? ("assigned" as const)
      : action.id === "pipeline.edit"
        ? ("assigned" as const)
        : null,
}));

const validBody = {
  expectedPermissions: [
    { permission: "pipeline.edit", scope: "all" },
    { permission: "pipeline.manage", scope: "all" },
    { permission: "pipeline.view", scope: "all" },
  ],
  newPermissions,
  assignmentResolutions: [],
};

beforeEach(() => {
  verifyAuthMock.mockReset();
  findUserMock.mockReset();
  rpcMock.mockReset();
  verifyAuthMock.mockResolvedValue({ uid: "firebase-1", email: "boss@ops.co" });
  findUserMock.mockResolvedValue({ id: CALLER_ID });
  rpcMock.mockResolvedValue({
    data: {
      ok: true,
      role_id: ROLE_ID,
      permissions: validBody.expectedPermissions,
      resolved_assignments: 0,
    },
    error: null,
  });
});

describe("PUT /api/roles/[id]/permissions", () => {
  it("requires a Firebase bearer token and never accepts a body token", async () => {
    const res = await PUT(
      makeReq({ ...validBody, idToken: "body-token" }, null),
      ctx
    );
    expect(res.status).toBe(401);
    expect(verifyAuthMock).not.toHaveBeenCalled();
  });

  it("requires exactly the three guarded body fields", async () => {
    const { assignmentResolutions: _omitted, ...missing } = validBody;
    const missingResponse = await PUT(makeReq(missing), ctx);
    expect(missingResponse.status).toBe(400);

    const extraResponse = await PUT(
      makeReq({ ...validBody, permissions: [] }),
      ctx
    );
    expect(extraResponse.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-canonical expected snapshot", async () => {
    const res = await PUT(
      makeReq({
        ...validBody,
        expectedPermissions: [...validBody.expectedPermissions].reverse(),
      }),
      ctx
    );
    expect(res.status).toBe(400);
  });

  it("rejects sparse, reordered, hidden, or unsupported new permission payloads", async () => {
    const sparse = await PUT(
      makeReq({ ...validBody, newPermissions: newPermissions.slice(1) }),
      ctx
    );
    expect(sparse.status).toBe(400);

    const reordered = await PUT(
      makeReq({ ...validBody, newPermissions: [...newPermissions].reverse() }),
      ctx
    );
    expect(reordered.status).toBe(400);

    const unsupported = newPermissions.map((entry) =>
      entry.permission === "pipeline.create"
        ? { ...entry, scope: "assigned" }
        : entry
    );
    const unsupportedResponse = await PUT(
      makeReq({ ...validBody, newPermissions: unsupported }),
      ctx
    );
    expect(unsupportedResponse.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("validates exact snake-case assignment snapshots", async () => {
    const res = await PUT(
      makeReq({
        ...validBody,
        assignmentResolutions: [
          {
            opportunityId: ROLE_ID,
            expectedAssignedTo: CALLER_ID,
            expectedAssignmentVersion: 1,
            newAssignedTo: null,
          },
        ],
      }),
      ctx
    );
    expect(res.status).toBe(400);
  });

  it("calls the service-only guarded RPC with the authenticated OPS actor", async () => {
    const resolution = {
      opportunity_id: "55555555-5555-4555-8555-555555555555",
      expected_assigned_to: "66666666-6666-4666-8666-666666666666",
      expected_assignment_version: 7,
      new_assigned_to: null,
    };

    const res = await PUT(
      makeReq({ ...validBody, assignmentResolutions: [resolution] }),
      ctx
    );

    expect(res.status).toBe(200);
    expect(verifyAuthMock).toHaveBeenCalledWith("token-1");
    expect(findUserMock).toHaveBeenCalledWith(
      "firebase-1",
      "boss@ops.co",
      "id"
    );
    expect(rpcMock).toHaveBeenCalledWith("replace_role_permissions_as_system", {
      p_actor_user_id: CALLER_ID,
      p_role_id: ROLE_ID,
      p_expected_permissions: validBody.expectedPermissions,
      p_new_permissions: newPermissions,
      p_assignment_resolutions: [resolution],
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      roleId: ROLE_ID,
      permissions: validBody.expectedPermissions,
      resolvedAssignments: 0,
    });
  });

  it("returns the authoritative assignment-resolution payload as a 409", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "40001",
        message: "assignment_resolution_required",
        details: JSON.stringify({
          code: "assignment_resolution_required",
          stranded_count: 1,
          stranded: [
            {
              opportunity_id: "55555555-5555-4555-8555-555555555555",
              title: "Framing inquiry",
              assigned_to: "66666666-6666-4666-8666-666666666666",
              assignment_version: 7,
            },
          ],
          eligible_assignees: [],
        }),
      },
    });

    const res = await PUT(makeReq(validBody), ctx);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      code: "assignment_resolution_required",
      strandedCount: 1,
      eligibleAssignees: [],
    });
  });

  it("returns the current permission snapshot on optimistic conflict", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "40001",
        message: "permission_snapshot_mismatch",
        details: JSON.stringify({
          current_permissions: [
            { permission: "pipeline.view", scope: "assigned" },
          ],
        }),
      },
    });

    const res = await PUT(makeReq(validBody), ctx);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      code: "permission_snapshot_mismatch",
      currentPermissions: [{ permission: "pipeline.view", scope: "assigned" }],
    });
  });

  it.each([
    ["42501", "access_denied", 403],
    ["P0002", "role_not_found", 404],
    ["22023", "invalid_permission_payload", 400],
  ])("maps SQL %s %s to HTTP %i", async (code, message, status) => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code, message, details: null },
    });
    const res = await PUT(makeReq(validBody), ctx);
    expect(res.status).toBe(status);
  });

  it("fails closed when the token is invalid or has no canonical OPS user", async () => {
    verifyAuthMock.mockRejectedValueOnce(new Error("Token expired"));
    expect((await PUT(makeReq(validBody), ctx)).status).toBe(401);

    verifyAuthMock.mockResolvedValueOnce({ uid: "firebase-1", email: null });
    findUserMock.mockResolvedValueOnce(null);
    expect((await PUT(makeReq(validBody), ctx)).status).toBe(403);
  });
});
