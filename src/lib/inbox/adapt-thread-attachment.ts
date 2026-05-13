/**
 * Pure adapters that reshape `ThreadAttachmentDto` wire rows into the
 * `ProjectPhoto` / `ProjectDocument` shapes consumed by the inbox right-rail
 * FILES tab. Extracted from `useClientFiles` so the transformation can be
 * unit-tested without the TanStack-Query / fetch / auth scaffolding around
 * the hook itself.
 */

import type { ProjectDocument } from "@/lib/api/services/project-file-service";
import type { ProjectPhoto } from "@/lib/types/pipeline";

/**
 * Wire shape of one item from `GET /api/inbox/threads/[id]/attachments`.
 * Kept in this module (rather than imported from the route handler) so the
 * client bundle never pulls in `NextRequest`/`NextResponse`. The route
 * declares an identical interface; drift between the two would surface
 * immediately in the typecheck because the hook + tests both pin against
 * this declaration.
 */
export interface ThreadAttachmentDto {
  id: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  fromEmail: string;
  /** ISO-8601 send/receive time of the parent message. */
  date: string;
  /** Same-origin proxy URL that streams the live bytes. */
  url: string;
}

/**
 * Adapt an image attachment into the `ProjectPhoto` shape used by the
 * PHOTOS sub-view. Thread-only photos flow through the `threadOnlyPhotos`
 * prop and are rendered under a synthetic "// THIS THREAD" group — the
 * `projectId` we emit is only used as a React key, never as a foreign key
 * back into the projects list.
 */
export function adaptImageAttachmentToPhoto(
  att: ThreadAttachmentDto,
  threadId: string,
  companyId: string,
): ProjectPhoto {
  return {
    id: `thread-att:${att.id}`,
    projectId: `thread:${threadId}`,
    companyId,
    url: att.url,
    thumbnailUrl: att.url,
    source: "other",
    siteVisitId: null,
    uploadedBy: att.fromEmail,
    takenAt: new Date(att.date),
    caption: att.filename,
    deletedAt: null,
    createdAt: new Date(att.date),
    isClientVisible: true,
  };
}

/**
 * Adapt a non-image attachment (PDF, CSV, Word doc, etc.) into the
 * `ProjectDocument` shape used by the FILES sub-view. `pdfStoragePath`
 * holds the proxy URL that streams the live bytes; cookie auth on that
 * route is what powers the click-to-open flow without exposing the
 * provider's OAuth scope to the browser.
 */
export function adaptNonImageAttachmentToDocument(
  att: ThreadAttachmentDto,
): ProjectDocument {
  return {
    id: `email-att:${att.id}`,
    filename: att.filename,
    sourceType: "email_attachment",
    sourceId: att.id,
    status: null,
    pdfStoragePath: att.url,
    updatedAt: att.date,
    value: null,
  };
}

/**
 * Split a list of thread attachments by MIME type. Images go to
 * `threadOnlyPhotos`; everything else lands in `documents`. Both lists are
 * already in newest-first order if the input was — this function preserves
 * the caller's ordering for each side of the split.
 */
export function partitionThreadAttachments(
  attachments: ThreadAttachmentDto[],
  threadId: string,
  companyId: string,
): { threadOnlyPhotos: ProjectPhoto[]; documents: ProjectDocument[] } {
  const threadOnlyPhotos: ProjectPhoto[] = [];
  const documents: ProjectDocument[] = [];
  for (const att of attachments) {
    if (att.mimeType.startsWith("image/")) {
      threadOnlyPhotos.push(
        adaptImageAttachmentToPhoto(att, threadId, companyId),
      );
    } else {
      documents.push(adaptNonImageAttachmentToDocument(att));
    }
  }
  return { threadOnlyPhotos, documents };
}
