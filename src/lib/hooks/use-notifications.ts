import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { queryKeys } from "../api/query-client";
import {
  NotificationService,
  type AppNotification,
  type NotificationType,
  type CreateNotificationParams,
} from "../api/services/notification-service";
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
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

/**
 * Create a notification and invalidate the cache so it appears in the rail immediately.
 * Returns a stable `notify` function that can be called from effects and callbacks.
 */
export function useCreateNotification() {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();
  const queryKey = queryKeys.notifications.unread(userId, companyId);

  const mutation = useMutation({
    mutationFn: (params: Omit<CreateNotificationParams, "userId" | "companyId">) =>
      NotificationService.create({ ...params, userId, companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    retry: 0,
  });

  // Use a ref so `notify` is referentially stable across renders.
  // Without this, mutation state changes (idle→pending→success) create a new
  // mutation object, which recreates `notify`, which re-triggers any useEffect
  // that lists `notify` as a dependency — causing an infinite loop.
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const notify = useCallback(
    (params: Omit<CreateNotificationParams, "userId" | "companyId">) => {
      if (!userId || !companyId) return;
      mutateRef.current(params);
    },
    [userId, companyId]
  );

  return notify;
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
