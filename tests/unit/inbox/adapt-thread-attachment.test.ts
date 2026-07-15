/**
 * Coverage for the thread-attachment adapters that bridge the wire shape
 * returned by `/api/inbox/threads/[id]/attachments` and the existing
 * `ProjectPhoto` / `ProjectDocument` shapes the FILES tab consumes.
 *
 * These adapters are the single transformation point that decides what
 * lights up the // THIS THREAD photo bucket vs. the FILES tab's flat
 * non-financial documents list, so they're worth proving piece-by-piece.
 */

import { describe, expect, it } from "vitest";
import {
  adaptImageAttachmentToPhoto,
  adaptNonImageAttachmentToDocument,
  partitionThreadAttachments,
  type ThreadAttachmentDto,
} from "@/lib/inbox/adapt-thread-attachment";

const ISO_MAY_07 = "2026-05-07T12:00:00.000Z";
const ISO_MAY_06 = "2026-05-06T09:30:00.000Z";

function makeDto(
  overrides: Partial<ThreadAttachmentDto> = {}
): ThreadAttachmentDto {
  return {
    id: "msg-1:att-1",
    messageId: "msg-1",
    attachmentId: "att-1",
    filename: "site-photo.jpg",
    mimeType: "image/jpeg",
    size: 250_000,
    fromEmail: "client@example.com",
    date: ISO_MAY_07,
    availability: "stored",
    url: "/api/integrations/email/attachment?companyId=co&messageId=msg-1&attachmentId=att-1&mimeType=image%2Fjpeg",
    ...overrides,
  };
}

describe("adaptImageAttachmentToPhoto", () => {
  it("maps the wire row onto the ProjectPhoto shape", () => {
    const photo = adaptImageAttachmentToPhoto(
      makeDto(),
      "thread-uuid",
      "co-uuid"
    );
    expect(photo).toEqual({
      id: "thread-att:msg-1:att-1",
      projectId: "thread:thread-uuid",
      companyId: "co-uuid",
      url: expect.stringContaining("/api/integrations/email/attachment"),
      thumbnailUrl: expect.stringContaining(
        "/api/integrations/email/attachment"
      ),
      source: "other",
      siteVisitId: null,
      uploadedBy: "client@example.com",
      takenAt: new Date(ISO_MAY_07),
      caption: "site-photo.jpg",
      deletedAt: null,
      createdAt: new Date(ISO_MAY_07),
      isClientVisible: true,
    });
  });

  it("uses the same url for thumbnail and full image", () => {
    // The provider proxy doesn't render thumbnails — pointing both at the
    // same URL keeps the lightbox click path straightforward.
    const photo = adaptImageAttachmentToPhoto(makeDto(), "t", "c");
    expect(photo.thumbnailUrl).toBe(photo.url);
  });
});

describe("adaptNonImageAttachmentToDocument", () => {
  it("maps a PDF onto the ProjectDocument shape with email_attachment sourceType", () => {
    const doc = adaptNonImageAttachmentToDocument(
      makeDto({
        id: "msg-2:att-2",
        messageId: "msg-2",
        attachmentId: "att-2",
        filename: "Site-Survey.pdf",
        mimeType: "application/pdf",
        size: 1_400_000,
        date: ISO_MAY_06,
      })
    );
    expect(doc).toEqual({
      id: "email-att:msg-2:att-2",
      filename: "Site-Survey.pdf",
      sourceType: "email_attachment",
      sourceId: "msg-2:att-2",
      status: "stored",
      pdfStoragePath: expect.stringContaining(
        "/api/integrations/email/attachment"
      ),
      mimeType: "application/pdf",
      sizeBytes: 1_400_000,
      sourceLabel: "email",
      updatedAt: ISO_MAY_06,
      value: null,
    });
  });

  it("keeps unavailable files visible without inventing a download URL", () => {
    const doc = adaptNonImageAttachmentToDocument(
      makeDto({
        availability: "oversized",
        url: null,
        filename: "full-site-scan.mov",
        mimeType: "video/quicktime",
      })
    );

    expect(doc.status).toBe("oversized");
    expect(doc.pdfStoragePath).toBeNull();
  });
});

describe("partitionThreadAttachments", () => {
  it("routes images to threadOnlyPhotos and everything else to documents", () => {
    const result = partitionThreadAttachments(
      [
        makeDto({
          id: "m1:a1",
          mimeType: "image/jpeg",
          filename: "deck.jpg",
        }),
        makeDto({
          id: "m1:a2",
          mimeType: "application/pdf",
          filename: "Estimate.pdf",
        }),
        makeDto({
          id: "m2:a1",
          mimeType: "image/png",
          filename: "railings.png",
        }),
        makeDto({
          id: "m2:a2",
          mimeType: "text/csv",
          filename: "materials.csv",
        }),
      ],
      "thread-uuid",
      "co-uuid"
    );
    expect(result.threadOnlyPhotos).toHaveLength(2);
    expect(result.documents).toHaveLength(2);
    expect(result.threadOnlyPhotos.map((p) => p.caption)).toEqual([
      "deck.jpg",
      "railings.png",
    ]);
    expect(result.documents.map((d) => d.filename)).toEqual([
      "Estimate.pdf",
      "materials.csv",
    ]);
  });

  it("preserves caller ordering inside each bucket", () => {
    // The hook hands us provider-sorted data (newest first). The adapter
    // must NOT re-sort — the merge with client documents happens upstream
    // and re-applies a single newest-first sort across both pools.
    const result = partitionThreadAttachments(
      [
        makeDto({ id: "newest", date: ISO_MAY_07, mimeType: "image/jpeg" }),
        makeDto({ id: "older", date: ISO_MAY_06, mimeType: "image/jpeg" }),
      ],
      "t",
      "c"
    );
    expect(result.threadOnlyPhotos.map((p) => p.id)).toEqual([
      "thread-att:newest",
      "thread-att:older",
    ]);
  });

  it("returns empty buckets when input is empty", () => {
    const result = partitionThreadAttachments([], "t", "c");
    expect(result.threadOnlyPhotos).toEqual([]);
    expect(result.documents).toEqual([]);
  });

  it("routes an unavailable image to FILES instead of rendering a broken photo", () => {
    const result = partitionThreadAttachments(
      [
        makeDto({
          id: "unavailable-image",
          availability: "unavailable",
          url: null,
          mimeType: "image/jpeg",
          filename: "jobsite.jpg",
        }),
      ],
      "t",
      "c"
    );

    expect(result.threadOnlyPhotos).toEqual([]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      filename: "jobsite.jpg",
      status: "unavailable",
      pdfStoragePath: null,
    });
  });

  it("treats unknown MIME types as documents (defensive default)", () => {
    // Provider-side MIME normalization isn't guaranteed — Gmail returns
    // lowercased types, M365 sometimes ships back-quoted strings. Anything
    // that doesn't *start with* "image/" lands in documents, never lost.
    const result = partitionThreadAttachments(
      [
        makeDto({ id: "weird", mimeType: "application/octet-stream" }),
        makeDto({ id: "uppercase", mimeType: "IMAGE/JPEG" }),
      ],
      "t",
      "c"
    );
    expect(result.documents.map((d) => d.id)).toEqual([
      "email-att:weird",
      "email-att:uppercase", // uppercase fails the lowercase startsWith check
    ]);
    expect(result.threadOnlyPhotos).toEqual([]);
  });
});
