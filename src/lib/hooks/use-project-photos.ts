/**
 * OPS Web - Project Photo Hooks
 *
 * TanStack Query hooks for project photo gallery management.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ProjectPhotoService } from "../api/services/project-photo-service";
import { ProjectNoteService } from "../api/services/project-note-service";
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
    mutationFn: async (data: CreateProjectPhoto) => {
      const photo = await ProjectPhotoService.createProjectPhoto(data);

      // Mirror the upload onto the unified workspace timeline so the
      // Activity tab shows a photo_uploaded entry alongside notes and
      // status changes. Best-effort — the gallery is the source of truth,
      // so a failed timeline write logs and continues.
      try {
        await ProjectNoteService.createSystemEvent({
          projectId: data.projectId,
          companyId: data.companyId,
          authorId: data.uploadedBy,
          eventKind: "photo_uploaded",
          content: data.caption ?? "",
          contentMetadata: {
            photoId: photo.id,
            url: photo.url,
            thumbnailUrl: photo.thumbnailUrl,
            caption: data.caption ?? null,
          },
        });
      } catch (err) {
        console.error(
          "[use-project-photos] Timeline write failed:",
          err,
        );
      }

      return photo;
    },
    onSuccess: (_result, data) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectPhotos.byProject(data.projectId),
      });
      // Invalidate the workspace activity cache too so the new timeline
      // row shows up without a manual refresh.
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectWorkspace.all,
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
