/**
 * OPS Web - Permission Overrides Service
 *
 * The write path for per-member permission exceptions. All writes go through
 * PUT /api/users/:id/permission-overrides (service role + full guard chain);
 * anon has no direct write path that bypasses company/admin checks beyond the
 * RLS policies, and the route additionally validates against the shared
 * registry so unregistered strings (spec.admin) can never transit.
 */

import { getIdToken } from "@/lib/firebase/auth";
import type { OverrideDiff } from "@/lib/permissions/resolve";

export interface SaveOverridesResult {
  applied: number;
  cleared: number;
}

export const PermissionOverridesService = {
  /** Apply a batch of exception changes (set + clear) for one member. */
  async saveMemberOverrides(
    userId: string,
    diff: OverrideDiff
  ): Promise<SaveOverridesResult> {
    const idToken = await getIdToken();
    if (!idToken) throw new Error("Not authenticated");

    const res = await fetch(
      `/api/users/${encodeURIComponent(userId)}/permission-overrides`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, set: diff.set, clear: diff.clear }),
      }
    );

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const body = (await res.json()) as { applied: number; cleared: number };
    return { applied: body.applied, cleared: body.cleared };
  },
};
