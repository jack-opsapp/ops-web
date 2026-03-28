/**
 * OPS Web - Notification Preferences Hooks
 *
 * TanStack Query hooks for per-user notification preferences.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { NotificationPreferencesService } from "../api/services/notification-preferences-service";
import type { UpdateNotificationPreferences } from "../api/services/notification-preferences-service";
import { useAuthStore } from "../store/auth-store";

export function useNotificationPreferences() {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.notificationPreferences.detail(userId, companyId),
    queryFn: () => NotificationPreferencesService.getPreferences(userId, companyId),
    enabled: !!userId && !!companyId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  const { currentUser, company } = useAuthStore();

  return useMutation({
    mutationFn: (updates: UpdateNotificationPreferences) =>
      NotificationPreferencesService.updatePreferences(
        currentUser?.id ?? "",
        company?.id ?? "",
        updates
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });
}
