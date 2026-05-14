import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { analyticsService } from "@/lib/analytics/analytics-service";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectNoteService } from "@/lib/api/services/project-note-service";
import { ProjectTablePhotoService } from "@/lib/api/services/project-table-photo-service";
import { ProjectTableMutationError } from "@/lib/api/services/project-table-service";
import { useAuthStore } from "@/lib/store/auth-store";
import type { ProjectTableRow } from "@/lib/types/project-table";

type InfiniteProjectTableRowsData = {
  pages: Array<{ rows?: ProjectTableRow[] }>;
};

function isProjectTableRowsQuery(queryKey: readonly unknown[]) {
  return queryKey[0] === "projects" && queryKey[1] === "tableRows";
}

function updatePhotoCount(
  queryClient: QueryClient,
  projectId: string,
  updater: (photoCount: number) => number,
) {
  queryClient.setQueriesData<unknown>(
    {
      queryKey: queryKeys.projects.all,
      exact: false,
      predicate: (query) =>
        Array.isArray(query.queryKey) && isProjectTableRowsQuery(query.queryKey),
    },
    (oldData: unknown) => {
      if (!oldData || typeof oldData !== "object" || !("pages" in oldData)) return oldData;
      const data = oldData as InfiniteProjectTableRowsData;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          rows: page.rows?.map((row) =>
            row.id === projectId ? { ...row, photoCount: updater(row.photoCount) } : row,
          ),
        })),
      };
    },
  );
}

function invalidatePhotoCaches(queryClient: QueryClient, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projectPhotos.byProject(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.tablePhotos(projectId) });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.projects.all,
    exact: false,
    predicate: (query) =>
      Array.isArray(query.queryKey) && isProjectTableRowsQuery(query.queryKey),
  });
}

function requirePhotoUploadIdentity(companyId: string, userId: string) {
  if (!companyId) {
    throw new ProjectTableMutationError("Company is required to upload project photos", "22023");
  }
  if (!userId) {
    throw new ProjectTableMutationError("User is required to upload project photos", "22023");
  }
}

function trackPhotoUpload(args: {
  projectId: string;
  fileCount: number;
  successCount: number;
  failedCount: number;
}) {
  analyticsService?.track?.("action", "project_table_photo_uploaded", {
    project_id: args.projectId,
    file_count: args.fileCount,
    success_count: args.successCount,
    failed_count: args.failedCount,
  });
}

export function useCellPhotoUpload({
  row,
  enabled = true,
}: {
  row: ProjectTableRow;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  const currentUserId = useAuthStore((state) => state.currentUser?.id ?? "");

  const photosQuery = useQuery({
    queryKey: queryKeys.projectPhotos.byProject(row.id),
    queryFn: () => ProjectTablePhotoService.fetchProjectPhotos(row.id, companyId),
    enabled: Boolean(enabled && row.id && companyId),
    staleTime: 30_000,
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      requirePhotoUploadIdentity(companyId, currentUserId);
      try {
        const result = await ProjectTablePhotoService.uploadProjectPhoto({
          companyId,
          projectId: row.id,
          uploadedBy: currentUserId,
          file,
        });

        try {
          await ProjectNoteService.createSystemEvent({
            projectId: row.id,
            companyId,
            authorId: currentUserId,
            eventKind: "photo_uploaded",
            content: "",
            contentMetadata: {
              photoId: result.photo.id,
              url: result.photo.url,
              thumbnailUrl: result.photo.thumbnailUrl,
              caption: null,
            },
          });
        } catch (error) {
          console.error("[use-cell-photo-upload] Timeline write failed:", error);
        }

        trackPhotoUpload({
          projectId: row.id,
          fileCount: 1,
          successCount: 1,
          failedCount: 0,
        });
        return result;
      } catch (error) {
        trackPhotoUpload({
          projectId: row.id,
          fileCount: 1,
          successCount: 0,
          failedCount: 1,
        });
        throw error;
      }
    },
    onSuccess: () => {
      updatePhotoCount(queryClient, row.id, (count) => count + 1);
      invalidatePhotoCaches(queryClient, row.id);
    },
  });

  const deletePhoto = useMutation({
    mutationFn: (photoId: string) => ProjectTablePhotoService.deleteProjectPhoto(photoId),
    onSuccess: () => {
      updatePhotoCount(queryClient, row.id, (count) => Math.max(0, count - 1));
      invalidatePhotoCaches(queryClient, row.id);
    },
  });

  return {
    photosQuery,
    photos: photosQuery.data ?? [],
    uploadPhoto,
    deletePhoto,
  };
}
