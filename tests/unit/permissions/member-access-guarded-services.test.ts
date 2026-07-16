import { beforeEach, describe, expect, it, vi } from "vitest";

const { getIdTokenMock } = vi.hoisted(() => ({
  getIdTokenMock: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: () => getIdTokenMock(),
}));
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
  parseDateRequired: (value: string) => value,
}));

import {
  MemberAccessUpdateError,
  PermissionOverridesService,
  type SaveOverridesInput,
} from "@/lib/api/services/permission-overrides-service";
import {
  RolesService,
  UserRoleUpdateError,
  type ReplaceUserRoleInput,
} from "@/lib/api/services/roles-service";

const userId = "11111111-1111-4111-8111-111111111111";
const overrideInput: SaveOverridesInput = {
  expectedOverrides: [
    { permission: "pipeline.view", scope: "assigned", granted: true },
  ],
  set: [{ permission: "pipeline.edit", scope: "assigned", granted: true }],
  clear: [],
  assignmentResolutions: [],
};
const roleInput: ReplaceUserRoleInput = {
  expectedRoleId: null,
  newRoleId: "22222222-2222-4222-8222-222222222222",
  assignmentResolutions: [],
};

beforeEach(() => {
  getIdTokenMock.mockReset();
  getIdTokenMock.mockResolvedValue("firebase-token");
  vi.unstubAllGlobals();
});

describe("guarded member access services", () => {
  it("sends override snapshots through the strict bearer contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          userId,
          overrides: overrideInput.expectedOverrides,
          resolvedAssignments: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      PermissionOverridesService.saveMemberOverrides(userId, overrideInput)
    ).resolves.toMatchObject({ ok: true, userId });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/users/${userId}/permission-overrides`,
      expect.objectContaining({
        method: "PUT",
        headers: {
          Authorization: "Bearer firebase-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(overrideInput),
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty(
      "idToken"
    );
  });

  it("preserves override resolution failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "assignment_resolution_required",
            strandedCount: 1,
            stranded: [{ opportunity_id: "lead-1" }],
            eligibleAssignees: [],
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(
      PermissionOverridesService.saveMemberOverrides(userId, overrideInput)
    ).rejects.toMatchObject({
      status: 409,
      payload: { code: "assignment_resolution_required", strandedCount: 1 },
    } satisfies Partial<MemberAccessUpdateError>);
  });

  it("sends nullable role snapshots through the same bearer contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          userId,
          roleId: roleInput.newRoleId,
          legacyRole: "operator",
          resolvedAssignments: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      RolesService.replaceUserRole(userId, roleInput)
    ).resolves.toMatchObject({
      ok: true,
      roleId: roleInput.newRoleId,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/users/${userId}/role`,
      expect.objectContaining({
        method: "PUT",
        headers: {
          Authorization: "Bearer firebase-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(roleInput),
      })
    );
  });

  it("preserves current role snapshot conflicts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "permission_snapshot_mismatch",
            currentRoleId: roleInput.newRoleId,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(
      RolesService.replaceUserRole(userId, roleInput)
    ).rejects.toMatchObject({
      status: 409,
      payload: {
        code: "permission_snapshot_mismatch",
        currentRoleId: roleInput.newRoleId,
      },
    } satisfies Partial<UserRoleUpdateError>);
  });
});
