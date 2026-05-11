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
 *
 * `threadOnlyPhotos` is reserved for image attachments on `activities`
 * rows tied to the current thread but NOT associated with any project.
 * The data source (`activities.attachments`) is declared in the schema
 * but unpopulated today — every sampled row returned `[]` despite
 * `has_attachments=true` (see comment in `project-file-service.ts`).
 * Until the sync engine fills that column, this hook returns an empty
 * array. The shape stays in place so the FILES tab v3 (D4) can render
 * the THIS THREAD bucket the moment the upstream gap closes — no
 * downstream callsite changes required.
 */
export interface ClientFilesResult {
  photos: ProjectPhoto[];
  documents: ProjectDocument[];
  /**
   * Photos attached to the current thread's activities rows that aren't
   * assigned to any project. Empty today — see hook docstring.
   */
  threadOnlyPhotos: ProjectPhoto[];
  /** Convenience: total count surfaced to the tab strip badge. */
  total: number;
}

export function useClientFiles(
  clientId: string | null | undefined,
  threadId?: string | null,
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const projectsQuery = useClientProjects(clientId);
  const projectIds = (projectsQuery.data ?? []).map((p) => p.id);

  return useQuery<ClientFilesResult>({
    queryKey: [
      "client",
      clientId ?? null,
      "files",
      { projectIds, threadId: threadId ?? null },
    ],
    queryFn: async () => {
      if (!clientId) {
        return { photos: [], documents: [], threadOnlyPhotos: [], total: 0 };
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

      // Thread-only image attachments: data source not yet populated by
      // the email sync engine (`activities.attachments` returns [] even
      // when has_attachments=true — see project-file-service.ts comment).
      // Returning [] here keeps the FILES tab v3's THIS THREAD section
      // structurally inert but ready to light up the moment the sync
      // engine starts filling that column. Wiring this through a real
      // query today would emit empty results and add a wasted round-trip.
      const threadOnlyPhotos: ProjectPhoto[] = [];

      return {
        photos,
        documents,
        threadOnlyPhotos,
        total: photos.length + documents.length + threadOnlyPhotos.length,
      };
    },
    enabled: !!clientId && !!companyId && !projectsQuery.isLoading,
  });
}
