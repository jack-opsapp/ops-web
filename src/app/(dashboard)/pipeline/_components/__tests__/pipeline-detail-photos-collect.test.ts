import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hooks", () => ({
  useOpportunityActivities: () => ({ data: [] }),
  useSiteVisits: () => ({ data: [] }),
  useAddOpportunityImages: () => ({}),
  useRemoveOpportunityImage: () => ({}),
}));

vi.mock("@/lib/api/services/lead-photo-upload", () => ({
  uploadLeadPhotos: vi.fn(),
}));

import { collectPhotos } from "../pipeline-detail-photos-tab";
import { ActivityType, type Activity } from "@/lib/types/pipeline";
import type { OpportunityAssignedContextIntakeAttachment } from "@/lib/api/services/opportunity-assigned-context-service";

/**
 * Bug 288f2607. The lead photo grid merged EVERY email activity's attachments
 * with no direction filter, so images the company sent out — crew photos,
 * marked-up plans — showed up in the customer's own photo gallery. Inbound
 * photos also arrived unattributed, with no hint of who sent them.
 */

const LEAD_CONTACT = { email: "elaine@example.com", name: "Elaine Beattie" };

function t(key: string, fallbackOrParams?: string | Record<string, unknown>) {
  if (fallbackOrParams && typeof fallbackOrParams === "object") {
    if (key === "detail.photoEmailSourceFrom") {
      return `Email · ${String(fallbackOrParams.name)}`;
    }
    return key;
  }
  const fallbacks: Record<string, string> = {
    "detail.photoEmailSource": "Email",
    "detail.photoSiteVisitSource": "Site visit",
    "detail.photoLeadSource": "Photo",
  };
  return fallbacks[key] ?? fallbackOrParams ?? key;
}

function emailActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "activity-1",
    type: ActivityType.Email,
    direction: "inbound",
    fromEmail: "elaine@example.com",
    attachments: ["https://cdn.example.com/deck.jpg"],
    createdAt: new Date("2026-09-03T12:00:00.000Z"),
    ...overrides,
  } as Activity;
}

function collect(
  activities: Activity[],
  leadImages: string[] = [],
  intakeAttachments: OpportunityAssignedContextIntakeAttachment[] = []
) {
  return collectPhotos(
    leadImages,
    activities,
    [],
    "en",
    t,
    LEAD_CONTACT,
    intakeAttachments
  );
}

describe("collectPhotos — outbound company images", () => {
  it("keeps company-sent photos out of the customer's gallery", () => {
    const photos = collect([
      emailActivity({
        id: "outbound-1",
        direction: "outbound",
        fromEmail: "owner@canpro.ca",
        attachments: ["https://cdn.example.com/crew-photo.jpg"],
      }),
    ]);

    expect(photos).toEqual([]);
  });

  it("keeps inbound photos from the same thread", () => {
    const photos = collect([
      emailActivity({ id: "inbound-1" }),
      emailActivity({
        id: "outbound-1",
        direction: "outbound",
        attachments: ["https://cdn.example.com/crew-photo.jpg"],
      }),
    ]);

    expect(photos.map((photo) => photo.url)).toEqual([
      "https://cdn.example.com/deck.jpg",
    ]);
  });

  it("keeps a photo whose direction was never recorded", () => {
    const photos = collect([emailActivity({ direction: null })]);
    expect(photos).toHaveLength(1);
  });
});

describe("collectPhotos — sender attribution", () => {
  it("names the customer when the sender is the lead's own contact", () => {
    const photos = collect([emailActivity()]);
    expect(photos[0].source).toBe("Email · Elaine · Sep 3");
  });

  it("falls back to the bare address for anyone else", () => {
    const photos = collect([
      emailActivity({ fromEmail: "spouse@example.com" }),
    ]);
    expect(photos[0].source).toBe("Email · spouse@example.com · Sep 3");
  });

  it("keeps the unattributed label when there is no sender at all", () => {
    const photos = collect([emailActivity({ fromEmail: null })]);
    expect(photos[0].source).toBe("Email — Sep 3");
  });
});

describe("collectPhotos — ordering and non-email sources", () => {
  it("puts lead photos first and keeps them removable", () => {
    const photos = collect(
      [emailActivity()],
      ["https://cdn.example.com/lead.jpg"]
    );

    expect(photos[0]).toMatchObject({
      url: "https://cdn.example.com/lead.jpg",
      source: "Photo",
      removable: true,
    });
    expect(photos[1].removable).toBe(false);
  });

  it("sorts dated photos newest first", () => {
    const photos = collect([
      emailActivity({
        id: "older",
        attachments: ["https://cdn.example.com/older.jpg"],
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
      }),
      emailActivity({
        id: "newer",
        attachments: ["https://cdn.example.com/newer.jpg"],
        createdAt: new Date("2026-09-05T12:00:00.000Z"),
      }),
    ]);

    expect(photos.map((photo) => photo.url)).toEqual([
      "https://cdn.example.com/newer.jpg",
      "https://cdn.example.com/older.jpg",
    ]);
  });

  it("includes accepted website intake images without disturbing current-main callers", () => {
    const attachment: OpportunityAssignedContextIntakeAttachment = {
      id: "11111111-1111-4111-8111-111111111111",
      filename: "roof.jpg",
      kind: "image",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      occurredAt: new Date("2026-09-04T12:00:00.000Z"),
      previewUrl: "/api/opportunities/opp-1/intake-files/upl-1/preview",
      downloadUrl: "/api/opportunities/opp-1/intake-files/upl-1/download",
    };

    const photos = collect([], [], [attachment]);

    expect(photos).toEqual([
      expect.objectContaining({
        url: attachment.previewUrl,
        source: "Website — Sep 4",
        removable: false,
      }),
    ]);
  });

  it("ignores non-image attachments and non-email activities", () => {
    const photos = collect([
      emailActivity({ attachments: ["https://cdn.example.com/quote.pdf"] }),
      emailActivity({
        id: "note-1",
        type: ActivityType.Note,
        attachments: ["https://cdn.example.com/note.jpg"],
      }),
    ]);

    expect(photos).toEqual([]);
  });
});
