"use client";

import { useQuery } from "@tanstack/react-query";
import { ProjectPhotoService } from "../api/services/project-photo-service";
import {
  ProjectFileService,
  type ProjectDocument,
} from "../api/services/project-file-service";
import type { ProjectPhoto } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";
import { useClientProjects } from "./use-client-projects";

/**
 * Aggregate photos + documents for the inbox right rail's Files tab.
 *
 * Photos come from project_photos joined to every project belonging to the
 * client. Documents come from `ProjectFileService.listClientDocuments` —
 * estimates and invoices keyed off `client_id`. Both are merged into one
 * total count for the tab badge.
 */
export interface ClientFilesResult {
  photos: ProjectPhoto[];
  documents: ProjectDocument[];
  /** Convenience: total count surfaced to the tab strip badge. */
  total: number;
}

export function useClientFiles(clientId: string | null | undefined) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const projectsQuery = useClientProjects(clientId);
  const projectIds = (projectsQuery.data ?? []).map((p) => p.id);

  return useQuery<ClientFilesResult>({
    queryKey: ["client", clientId ?? null, "files", { projectIds }],
    queryFn: async () => {
      if (!clientId) {
        return { photos: [], documents: [], total: 0 };
      }

      // Photos depend on per-project fetches; documents are client-scoped
      // (estimates/invoices live at the client level). Fanning the photo
      // calls in parallel with the documents fetch keeps total wall time
      // close to the slowest single request even on clients with many
      // projects.
      const [photoBatches, documents] = await Promise.all([
        projectIds.length > 0
          ? Promise.all(
              projectIds.map((id) =>
                ProjectPhotoService.fetchProjectPhotos(id, companyId).catch(
                  () => [],
                ),
              ),
            )
          : Promise.resolve([] as ProjectPhoto[][]),
        ProjectFileService.listClientDocuments(clientId, companyId).catch(
          () => [] as ProjectDocument[],
        ),
      ]);

      const photos = photoBatches.flat();
      return {
        photos,
        documents,
        total: photos.length + documents.length,
      };
    },
    enabled: !!clientId && !!companyId && !projectsQuery.isLoading,
  });
}
