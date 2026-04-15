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

export function useAssignUserRole() {
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
