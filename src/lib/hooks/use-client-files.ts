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
import {
  partitionThreadAttachments,
  type ThreadAttachmentDto,
} from "@/lib/inbox/adapt-thread-attachment";

/**
 * Aggregate photos + documents for the inbox right rail's Files tab.
 *
 * Three independent sources fan in:
 *
 *   1. project_photos — per-project image gallery for every project belonging
 *      to the client. Surfaced under `photos`.
 *   2. estimates + invoices — `ProjectFileService.listClientDocuments` keyed
 *      off `client_id`. Surfaced under `documents` with `sourceType` of
 *      `"estimate"` or `"invoice"`.
 *   3. provider thread attachments — when `threadId` is passed, the new
 *      `/api/inbox/threads/{id}/attachments` route is consulted. Email
 *      attachments are NOT persisted to Postgres or OPS storage: the sync
 *      engine sets `activities.has_attachments=true` and `attachment_count`
 *      but never fills `attachments`/`attachment_ids` (verified empty on all
 *      46 flagged rows as of 2026-05-12). The provider exposes the live
 *      metadata via `getAttachmentsFromThread()`. Image attachments are
 *      adapted into `ProjectPhoto`-shaped rows and surfaced under
 *      `threadOnlyPhotos`; everything else (PDFs, CSVs, Word docs, etc.) is
 *      adapted into `ProjectDocument`-shaped rows with `sourceType:
 *      "email_attachment"` and merged into `documents`.
 */
export interface ClientFilesResult {
  photos: ProjectPhoto[];
  documents: ProjectDocument[];
  /**
   * Image attachments on the current thread that are NOT assigned to any
   * project — rendered as the trailing "// THIS THREAD" bucket inside the
   * PHOTOS sub-view.
   */
  threadOnlyPhotos: ProjectPhoto[];
  /** Convenience: total count surfaced to the tab strip badge. */
  total: number;
}

async function fetchThreadAttachments(
  threadId: string,
): Promise<ThreadAttachmentDto[]> {
  // Mirror the auth pattern used by every other inbox hook (Bearer header
  // pulled from the firebase id-token cache). Same-origin cookie auth on
  // the proxy is what powers the `<img src>` flow later — this fetch is
  // separate and needs the explicit token.
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  if (!token) return [];
  const res = await fetch(`/api/inbox/threads/${threadId}/attachments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // Don't throw — a 5xx on the proxy walk shouldn't blank the rest of
    // the FILES tab. Return empty so project photos + documents still
    // render. The API route logs its own failure.
    return [];
  }
  const body = (await res.json()) as { attachments?: ThreadAttachmentDto[] };
  return body.attachments ?? [];
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
      // Three independent fan-outs. None block on the others — even on
      // clients with many projects the photo batch dominates wall time.
      const [photoBatches, clientDocuments, threadAttachments] = await Promise.all([
        clientId && projectIds.length > 0
          ? Promise.all(
              projectIds.map((id) =>
                ProjectPhotoService.fetchProjectPhotos(id, companyId).catch(
                  () => [],
                ),
              ),
            )
          : Promise.resolve([] as ProjectPhoto[][]),
        clientId
          ? ProjectFileService.listClientDocuments(clientId, companyId).catch(
              () => [] as ProjectDocument[],
            )
          : Promise.resolve([] as ProjectDocument[]),
        threadId
          ? fetchThreadAttachments(threadId).catch(
              () => [] as ThreadAttachmentDto[],
            )
          : Promise.resolve([] as ThreadAttachmentDto[]),
      ]);

      const photos = photoBatches.flat();

      // Split thread attachments by MIME type. Anything image/* lights up
      // the // THIS THREAD bucket in the PHOTOS sub-view; everything else
      // (PDFs, CSVs, .docx, etc.) joins the documents list as
      // `sourceType: "email_attachment"` so the FILES sub-view's CONTRACTS
      // section can render them alongside any future non-financial docs.
      const { threadOnlyPhotos, documents: threadDocuments } =
        partitionThreadAttachments(threadAttachments, threadId ?? "", companyId);

      // Email-attachment documents go on top of the existing client docs
      // and the merged list re-sorts newest-first so threads with fresh
      // attachments don't get buried under stale invoices.
      const documents = [...clientDocuments, ...threadDocuments].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );

      return {
        photos,
        documents,
        threadOnlyPhotos,
        total: photos.length + documents.length + threadOnlyPhotos.length,
      };
    },
    // The hook is useful even when the thread has no linked client — a
    // thread-only attachment list still has value. Gate only on the company
    // id (needed for project photo lookups) and on the projects query
    // settling so we don't double-fetch right after the dashboard mounts.
    enabled:
      !!companyId &&
      !projectsQuery.isLoading &&
      (!!clientId || !!threadId),
  });
}
