/**
 * OPS Web - Project Photo Hooks
 *
 * TanStack Query hooks for project photo gallery management.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ProjectPhotoService } from "../api/services/project-photo-service";
import type { CreateProjectPhoto } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

export function useProjectPhotos(projectId: string | undefined) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.projectPhotos.byProject(projectId ?? ""),
    queryFn: () => ProjectPhotoService.fetchProjectPhotos(projectId!, companyId),
    enabled: !!projectId && !!companyId,
  });
}

export function useCreateProjectPhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProjectPhoto) =>
      ProjectPhotoService.createProjectPhoto(data),
    onSuccess: (_result, data) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectPhotos.byProject(data.projectId),
      });
    },
  });
}

export function useDeleteProjectPhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) =>
      ProjectPhotoService.deleteProjectPhoto(id),
    onSuccess: (_result, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectPhotos.byProject(projectId),
      });
    },
  });
}
