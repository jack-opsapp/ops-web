import { describe, expect, it } from "vitest";

import {
  buildAttachmentStoragePath,
  decideAttachmentAttribution,
  detectAttachmentMimeFromBytes,
  detectAttachmentMimeType,
  safeAttachmentFilename,
} from "@/lib/api/services/email-attachments/attachment-policy";

describe("email attachment storage policy", () => {
  it("builds a deterministic mailbox-scoped private object path", () => {
    const first = buildAttachmentStoragePath({
      companyId: "company-1",
      connectionId: "connection-1",
      messageId: "message-1",
      attachmentId: "attachment-1",
    });

    expect(first).toBe(
      buildAttachmentStoragePath({
        companyId: "company-1",
        connectionId: "connection-1",
        messageId: "message-1",
        attachmentId: "attachment-1",
      })
    );
    expect(first).toMatch(
      /^company-1\/connection-1\/[a-f0-9]{64}\/[a-f0-9]{64}\/content$/
    );
    expect(
      buildAttachmentStoragePath({
        companyId: "company-1",
        connectionId: "connection-2",
        messageId: "message-1",
        attachmentId: "attachment-1",
      })
    ).not.toBe(first);
  });

  it("uses a safe display filename without trusting it as a storage path", () => {
    expect(safeAttachmentFilename("../../deck photo\u0000.jpg")).toBe(
      "deck_photo.jpg"
    );
    expect(safeAttachmentFilename("   ")).toBe("attachment");
  });

  it("recovers document MIME from the filename when providers use octet-stream", () => {
    expect(
      detectAttachmentMimeType("application/octet-stream", "estimate.PDF")
    ).toBe("application/pdf");
    expect(detectAttachmentMimeType("", "photo.jpeg")).toBe("image/jpeg");
    expect(detectAttachmentMimeType("text/csv", "export.bin")).toBe("text/csv");
  });

  it("uses file signatures as the final MIME authority", () => {
    expect(
      detectAttachmentMimeFromBytes(
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
        "text/html",
        "payload.html"
      )
    ).toBe("image/jpeg");
    expect(
      detectAttachmentMimeFromBytes(
        Buffer.from("%PDF-1.7\n"),
        "application/octet-stream",
        "upload.bin"
      )
    ).toBe("application/pdf");
  });
});

describe("email attachment lead attribution policy", () => {
  const known = new Set(["corinne@example.com", "billing@example.com"]);

  it("attributes an inbound file only when the exact activity sender is known", () => {
    expect(
      decideAttachmentAttribution({
        opportunityId: "lead-corinne",
        direction: "inbound",
        fromEmail: "Corinne <CORINNE@example.com>",
        toEmails: ["operator@example.com"],
        knownContactEmails: known,
        matchNeedsReview: false,
      })
    ).toEqual({ status: "attributed", opportunityId: "lead-corinne" });
  });

  it("quarantines a stale thread relationship instead of using its lead", () => {
    expect(
      decideAttachmentAttribution({
        opportunityId: "lead-sandra",
        direction: "inbound",
        fromEmail: "corinne@example.com",
        toEmails: ["operator@example.com"],
        knownContactEmails: new Set(["sandra@example.com"]),
        matchNeedsReview: false,
      })
    ).toEqual({ status: "needs_review", opportunityId: null });
  });

  it("requires a known external recipient for outbound files", () => {
    expect(
      decideAttachmentAttribution({
        opportunityId: "lead-corinne",
        direction: "outbound",
        fromEmail: "operator@example.com",
        toEmails: ["alias@example.com", "billing@example.com"],
        knownContactEmails: known,
        matchNeedsReview: false,
      })
    ).toEqual({ status: "attributed", opportunityId: "lead-corinne" });
  });

  it("fails closed for review-held or unlinked activities", () => {
    expect(
      decideAttachmentAttribution({
        opportunityId: "lead-corinne",
        direction: "inbound",
        fromEmail: "corinne@example.com",
        toEmails: [],
        knownContactEmails: known,
        matchNeedsReview: true,
      })
    ).toEqual({ status: "needs_review", opportunityId: null });

    expect(
      decideAttachmentAttribution({
        opportunityId: null,
        direction: "inbound",
        fromEmail: "corinne@example.com",
        toEmails: [],
        knownContactEmails: known,
        matchNeedsReview: false,
      })
    ).toEqual({ status: "pending", opportunityId: null });
  });
});
