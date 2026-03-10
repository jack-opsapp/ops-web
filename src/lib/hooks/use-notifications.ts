import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { NotificationService, type AppNotification } from "../api/services/notification-service";
import { useAuthStore } from "../store/auth-store";

/**
 * Fetch unread notifications for the current user.
 * Auto-refetches on window focus, stale after 30s.
 */
export function useNotifications() {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.notifications.unread(userId, companyId),
    queryFn: () => NotificationService.fetchUnread(userId, companyId),
    enabled: !!userId && !!companyId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Dismiss (mark as read) a single notification with optimistic update.
 */
export function useDismissNotification() {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();
  const queryKey = queryKeys.notifications.unread(userId, companyId);

  return useMutation({
    mutationFn: (notificationId: string) =>
      NotificationService.markAsRead(notificationId),
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AppNotification[]>(queryKey);
      queryClient.setQueryData<AppNotification[]>(queryKey, (old) =>
        old?.filter((n) => n.id !== notificationId) ?? []
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Dismiss all non-persistent notifications with optimistic update.
 */
export function useDismissAllNotifications() {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();
  const queryKey = queryKeys.notifications.unread(userId, companyId);

  return useMutation({
    mutationFn: () =>
      NotificationService.dismissAllDismissible(userId, companyId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AppNotification[]>(queryKey);
      queryClient.setQueryData<AppNotification[]>(queryKey, (old) =>
        old?.filter((n) => n.persistent) ?? []
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
