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
  RolesService,
  RolePermissionUpdateError,
  type ReplaceRolePermissionsInput,
} from "@/lib/api/services/roles-service";

const input: ReplaceRolePermissionsInput = {
  expectedPermissions: [{ permission: "pipeline.view", scope: "assigned" }],
  newPermissions: [{ permission: "pipeline.view", scope: "assigned" }],
  assignmentResolutions: [],
};

beforeEach(() => {
  getIdTokenMock.mockReset();
  getIdTokenMock.mockResolvedValue("firebase-token");
  vi.unstubAllGlobals();
});

describe("RolesService.updateRolePermissions", () => {
  it("sends the strict shared body with bearer authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          roleId: "role-1",
          permissions: input.expectedPermissions,
          resolvedAssignments: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      RolesService.updateRolePermissions("role-1", input)
    ).resolves.toMatchObject({ ok: true, roleId: "role-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/roles/role-1/permissions",
      expect.objectContaining({
        method: "PUT",
        headers: {
          Authorization: "Bearer firebase-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty(
      "idToken"
    );
  });

  it("preserves structured resolution failures for the editor", async () => {
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
      RolesService.updateRolePermissions("role-1", input)
    ).rejects.toMatchObject({
      status: 409,
      payload: {
        code: "assignment_resolution_required",
        strandedCount: 1,
      },
    } satisfies Partial<RolePermissionUpdateError>);
  });
});
