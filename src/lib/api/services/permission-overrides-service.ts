/**
 * Guarded per-member permission override client shared by the Team editor.
 */

import { getIdToken } from "@/lib/firebase/auth";
import type { OverrideInput, OverrideWrite } from "@/lib/permissions/resolve";
import type {
  EligibleRoleAssignmentTarget,
  RoleAssignmentResolution,
  StrandedRoleAssignment,
} from "@/lib/api/services/guarded-permission-types";

export interface SaveOverridesInput {
  expectedOverrides: OverrideInput[];
  set: OverrideWrite[];
  clear: string[];
  assignmentResolutions: RoleAssignmentResolution[];
}

export interface SaveOverridesResult {
  ok: true;
  userId: string;
  overrides: OverrideInput[];
  resolvedAssignments: number;
}

export interface MemberAccessFailurePayload {
  code: string;
  currentOverrides?: OverrideInput[];
  strandedCount?: number;
  stranded?: StrandedRoleAssignment[];
  eligibleAssignees?: EligibleRoleAssignmentTarget[];
  opportunity_id?: string;
  assigned_to?: string | null;
  assignment_version?: number | null;
}

export class MemberAccessUpdateError extends Error {
  readonly payload: MemberAccessFailurePayload;
  readonly status: number;

  constructor(status: number, payload: MemberAccessFailurePayload) {
    super(payload.code || `HTTP ${status}`);
    this.name = "MemberAccessUpdateError";
    this.status = status;
    this.payload = payload;
  }
}

export const PermissionOverridesService = {
  async saveMemberOverrides(
    userId: string,
    input: SaveOverridesInput
  ): Promise<SaveOverridesResult> {
    const idToken = await getIdToken();
    if (!idToken) throw new Error("Not authenticated");

    const response = await fetch(
      `/api/users/${encodeURIComponent(userId)}/permission-overrides`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      }
    );
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      throw new MemberAccessUpdateError(response.status, {
        ...(payload as unknown as MemberAccessFailurePayload),
        code:
          typeof payload.code === "string"
            ? payload.code
            : "permission_update_failed",
      });
    }
    if (
      payload.ok !== true ||
      payload.userId !== userId ||
      !Array.isArray(payload.overrides) ||
      typeof payload.resolvedAssignments !== "number"
    ) {
      throw new MemberAccessUpdateError(500, {
        code: "permission_update_failed",
      });
    }
    return payload as unknown as SaveOverridesResult;
  },
};
