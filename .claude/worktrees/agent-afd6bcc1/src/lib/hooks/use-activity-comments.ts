/**
 * OPS Web - Activity Comment Hooks
 *
 * TanStack Query hooks for threaded comments on activity entries.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ActivityCommentService } from "../api/services/activity-comment-service";
import type { CreateActivityComment } from "../types/pipeline";

export function useActivityComments(activityId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.activityComments.byActivity(activityId ?? ""),
    queryFn: () => ActivityCommentService.fetchComments(activityId!),
    enabled: !!activityId,
  });
}

export function useCreateActivityComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateActivityComment) =>
      ActivityCommentService.createComment(data),
    onSuccess: (_result, data) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.activityComments.byActivity(data.activityId),
      });
    },
  });
}

export function useUpdateActivityComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string; activityId: string }) =>
      ActivityCommentService.updateComment(id, content),
    onSuccess: (_result, { activityId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.activityComments.byActivity(activityId),
      });
    },
  });
}

export function useDeleteActivityComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; activityId: string }) =>
      ActivityCommentService.deleteComment(id),
    onSuccess: (_result, { activityId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.activityComments.byActivity(activityId),
      });
    },
  });
}
