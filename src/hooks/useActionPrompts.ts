"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { queryKeys } from "@/lib/api/query-client";
import { authedFetch } from "@/lib/utils/authed-fetch";

/**
 * Reconciles the current operator's setup prompts at a narrow authenticated
 * server boundary. The browser supplies no identity, company, recipient, copy,
 * navigation, permissions, or setup-state fields.
 */
export function useActionPrompts() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;

    void (async () => {
      const response = await authedFetch("/api/notifications/setup-prompts", {
        method: "POST",
      });

      if (active && response.ok) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.all,
        });
      }
    })().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [queryClient]);
}
