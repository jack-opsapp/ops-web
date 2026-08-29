import { describe, expect, it, vi } from "vitest";

import {
  AttachmentIngestionService,
  type AttachmentActivityRepository,
  type AttachmentInspectionQueue,
  type CanonicalAttachmentRecord,
  type CanonicalAttachmentStatusUpdate,
  type ExactEmailActivity,
  type ExactMessageAttachmentProvider,
  type PrivateAttachmentStorage,
  type ProviderAttachmentDescriptor,
  type UpsertCanonicalAttachmentInput,
} from "@/lib/api/services/email-attachments/attachment-ingestion-service";

/**
 * Bug 288f2607. The sync engine writes a provisional `attachment_count` of 1|0
 * because the provider gives no exact count at ingest. Every client that shows
 * an attachment icon — or an expand affordance on the correspondence row —
 * reads that number, so ingestion has to correct it once it knows the truth.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");
const MAX_BYTES = 10_000;

const activity: ExactEmailActivity = {
  id: "activity-1",
  companyId: "company-1",
  connectionId: "connection-1",
  messageId: "message-1",
  providerThreadId: "thread-1",
  opportunityId: "opportunity-1",
  direction: "inbound",
  fromEmail: "corinne@example.com",
  toEmails: ["owner@canpro.ca"],
  matchNeedsReview: false,
  occurredAt: NOW,
};

function descriptor(
  overrides: Partial<ProviderAttachmentDescriptor> = {}
): ProviderAttachmentDescriptor {
  return {
    messageId: "message-1",
    attachmentId: "attachment-1",
    filename: "deck-photo.jpg",
    providerMimeType: "image/jpeg",
    sizeBytes: 5,
    providerKind: "file",
    providerPartId: null,
    contentId: null,
    isInline: false,
    downloadable: true,
    externalUrl: null,
    ...overrides,
  };
}

class Repository implements AttachmentActivityRepository {
  rollups: Array<{
    companyId: string;
    activityId: string;
    attachmentCount: number;
  }> = [];
  projections: string[][] = [];
  rollupError: Error | null = null;
  private records = new Map<string, CanonicalAttachmentRecord>();

  async resolveExactActivity(): Promise<ExactEmailActivity | null> {
    return activity;
  }

  async listKnownOpportunityContactEmails(): Promise<string[]> {
    return ["corinne@example.com"];
  }

  async upsertCanonicalAttachment(
    input: UpsertCanonicalAttachmentInput
  ): Promise<CanonicalAttachmentRecord> {
    const existing = this.records.get(input.attachmentId);
    if (existing) return existing;
    const record: CanonicalAttachmentRecord = {
      id: `canonical-${input.attachmentId}`,
      ingestStatus: "discovered",
      ingestAttempts: 0,
      storagePath: null,
    };
    this.records.set(input.attachmentId, record);
    return record;
  }

  async markCanonicalAttachmentStatus(
    input: CanonicalAttachmentStatusUpdate
  ): Promise<void> {
    const entry = [...this.records.entries()].find(
      ([, row]) => row.id === input.canonicalAttachmentId
    );
    if (!entry) return;
    this.records.set(entry[0], {
      ...entry[1],
      ingestStatus:
        input.ingestStatus as CanonicalAttachmentRecord["ingestStatus"],
    });
  }

  async appendCanonicalAttachmentUrls(input: {
    companyId: string;
    activityId: string;
    canonicalUrls: string[];
  }): Promise<void> {
    this.projections.push(input.canonicalUrls);
  }

  async updateActivityAttachmentRollup(input: {
    companyId: string;
    activityId: string;
    attachmentCount: number;
  }): Promise<void> {
    this.rollups.push(input);
    if (this.rollupError) throw this.rollupError;
  }
}

class Provider implements ExactMessageAttachmentProvider {
  attachments: ProviderAttachmentDescriptor[] = [descriptor()];

  async enumerateExactMessage(): Promise<ProviderAttachmentDescriptor[]> {
    return this.attachments;
  }

  async downloadExactAttachment(): Promise<Buffer> {
    return Buffer.from("photo");
  }
}

class Storage implements PrivateAttachmentStorage {
  async putVerifiedPrivateObject(input: {
    bucket: string;
    key: string;
    bytes: Buffer;
    mimeType: string;
    contentSha256: string;
  }) {
    return {
      verifiedSizeBytes: input.bytes.byteLength,
      contentSha256: input.contentSha256,
    };
  }
}

class InspectionQueue implements AttachmentInspectionQueue {
  async enqueueCanonicalAttachment(): Promise<void> {}
}

function harness() {
  const repository = new Repository();
  const provider = new Provider();
  const service = new AttachmentIngestionService({
    repository,
    provider,
    storage: new Storage(),
    inspectionQueue: new InspectionQueue(),
    maxAttachmentBytes: MAX_BYTES,
    now: () => NOW,
  });
  return { service, repository, provider };
}

const request = {
  companyId: "company-1",
  connectionId: "connection-1",
  activityId: "activity-1",
  messageId: "message-1",
};

describe("attachment rollup on the correspondence row", () => {
  it("writes the real count exactly once per ingest", async () => {
    const { service, repository, provider } = harness();
    provider.attachments = [
      descriptor(),
      descriptor({ attachmentId: "attachment-2", filename: "plan.pdf" }),
    ];

    await service.ingestExactMessage(request);

    expect(repository.rollups).toEqual([
      {
        companyId: "company-1",
        activityId: "activity-1",
        attachmentCount: 2,
      },
    ]);
  });

  it("writes zero for a message that turns out to carry nothing", async () => {
    const { service, repository, provider } = harness();
    provider.attachments = [];

    await service.ingestExactMessage(request);

    expect(repository.rollups).toEqual([
      {
        companyId: "company-1",
        activityId: "activity-1",
        attachmentCount: 0,
      },
    ]);
    expect(repository.projections).toEqual([]);
  });

  it("counts an external reference the run never downloaded", async () => {
    const { service, repository, provider } = harness();
    provider.attachments = [
      descriptor(),
      descriptor({
        attachmentId: "attachment-link",
        providerKind: "reference",
        downloadable: false,
        externalUrl: "https://drive.example.com/file",
      }),
    ];

    await service.ingestExactMessage(request);

    expect(repository.rollups[0].attachmentCount).toBe(2);
  });

  it("never fails an otherwise good ingest because the rollup could not be written", async () => {
    const { service, repository } = harness();
    repository.rollupError = new Error("permission denied");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await service.ingestExactMessage(request);

    expect(result.stored).toBe(1);
    expect(repository.rollups).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
