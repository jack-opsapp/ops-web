"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuth } from "firebase/auth";
import { queryKeys } from "@/lib/api/query-client";

interface AssignRoleParams {
  userId: string;
  roleId: string;
}

interface AssignRoleResponse {
  success: boolean;
  userId: string;
  roleId: string;
  roleName: string;
}

/**
 * Assign an RBAC role to a member via the PATCH /api/users/:id/role endpoint.
 * The route also marks related `role_needed` notifications as read, so the
 * rail notification disappears immediately after the admin acts.
 *
 * Distinct from `useAssignUserRole` in `use-roles.ts` — that hook is used
 * inside the roles settings page and writes directly to Supabase without
 * touching notifications. This hook is for the admin → member assignment
 * flow triggered by a rail-notification click or the team-tab deep-link.
 */
export function useAssignMemberRole() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, roleId }: AssignRoleParams): Promise<AssignRoleResponse> => {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not authenticated");
      const idToken = await user.getIdToken();

      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, roleId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.all });
      qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
      qc.invalidateQueries({ queryKey: queryKeys.invitations.all });
    },
  });
}
