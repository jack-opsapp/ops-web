"use client";

import { useQuery } from "@tanstack/react-query";
import { ProjectPhotoService } from "../api/services/project-photo-service";
import type { ProjectPhoto } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";
import { useClientProjects } from "./use-client-projects";

/**
 * Aggregate photos + documents for the inbox right rail's Files tab.
 *
 * Photos come from project_photos joined to every project belonging to the
 * client. Documents are not currently surfaced by a dedicated service in
 * OPS-Web — they're returned as an empty array until that backend lands.
 * The shape lets the UI render the // DOCUMENTS section as soon as the
 * service is added without changing this hook's surface.
 */
export interface ClientFilesResult {
  photos: ProjectPhoto[];
  documents: never[];
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
      if (!clientId || projectIds.length === 0) {
        return { photos: [], documents: [], total: 0 };
      }
      const photoBatches = await Promise.all(
        projectIds.map((id) =>
          ProjectPhotoService.fetchProjectPhotos(id, companyId).catch(() => []),
        ),
      );
      const photos = photoBatches.flat();
      return { photos, documents: [], total: photos.length };
    },
    enabled: !!clientId && !!companyId && !projectsQuery.isLoading,
  });
}
