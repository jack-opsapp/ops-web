import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ProviderApiError,
  ProviderAuthError,
  ProviderScopeError,
} from "@/lib/api/services/email-provider";

import {
  AttachmentActivityIdentityError,
  AttachmentIngestionService,
  AttachmentScanRetryableError,
  AttachmentSourceUnavailableError,
  type AttachmentActivityRepository,
  type AttachmentInspectionQueue,
  type CanonicalAttachmentStatusUpdate,
  type CanonicalAttachmentRecord,
  type ExactEmailActivity,
  type ExactMessageAttachmentProvider,
  type PrivateAttachmentStorage,
  type ProviderAttachmentDescriptor,
  type UpsertCanonicalAttachmentInput,
} from "@/lib/api/services/email-attachments/attachment-ingestion-service";
import { buildAttachmentStoragePath } from "@/lib/api/services/email-attachments/attachment-policy";

const NOW = new Date("2026-07-15T08:00:00.000Z");
const MAX_BYTES = 10_000;

const activity: ExactEmailActivity = {
  id: "activity-1",
  companyId: "company-1",
  connectionId: "connection-1",
  messageId: "message-1",
  providerThreadId: "thread-1",
  opportunityId: "lead-1",
  direction: "inbound",
  fromEmail: "Corinne <corinne@example.com>",
  toEmails: ["operator@example.com"],
  matchNeedsReview: false,
  occurredAt: new Date("2026-07-14T18:00:00.000Z"),
};

function attachment(
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

class FakeRepository implements AttachmentActivityRepository {
  resolvedActivity: ExactEmailActivity | null = activity;
  knownContactEmails = ["corinne@example.com"];
  upserts: UpsertCanonicalAttachmentInput[] = [];
  statusUpdates: CanonicalAttachmentStatusUpdate[] = [];
  projections: Array<{
    companyId: string;
    activityId: string;
    canonicalUrls: string[];
  }> = [];
  records = new Map<string, CanonicalAttachmentRecord>();

  async resolveExactActivity(): Promise<ExactEmailActivity | null> {
    return this.resolvedActivity;
  }

  async listKnownOpportunityContactEmails(): Promise<string[]> {
    return this.knownContactEmails;
  }

  async upsertCanonicalAttachment(
    input: UpsertCanonicalAttachmentInput
  ): Promise<CanonicalAttachmentRecord> {
    this.upserts.push(input);
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
    this.statusUpdates.push(input);
    const id = input.canonicalAttachmentId;
    const entry = [...this.records.entries()].find(([, row]) => row.id === id);
    if (entry) {
      this.records.set(entry[0], {
        ...entry[1],
        ingestStatus:
          input.ingestStatus as CanonicalAttachmentRecord["ingestStatus"],
        ingestAttempts:
          (input.ingestAttempts as number | undefined) ??
          entry[1].ingestAttempts,
        storagePath:
          (input.storagePath as string | undefined) ?? entry[1].storagePath,
      });
    }
  }

  async appendCanonicalAttachmentUrls(input: {
    companyId: string;
    activityId: string;
    canonicalUrls: string[];
  }): Promise<void> {
    this.projections.push(input);
  }
}

class FakeProvider implements ExactMessageAttachmentProvider {
  attachments: ProviderAttachmentDescriptor[] = [attachment()];
  bytes = Buffer.from("photo");
  enumerateCalls: Array<Record<string, unknown>> = [];
  downloadCalls: Array<Record<string, unknown>> = [];
  enumerateError: Error | null = null;
  downloadError: Error | null = null;

  async enumerateExactMessage(input: Record<string, unknown>) {
    this.enumerateCalls.push(input);
    if (this.enumerateError) throw this.enumerateError;
    return this.attachments;
  }

  async downloadExactAttachment(input: Record<string, unknown>) {
    this.downloadCalls.push(input);
    if (this.downloadError) throw this.downloadError;
    return this.bytes;
  }
}

class FakeStorage implements PrivateAttachmentStorage {
  writes: Array<{
    bucket: string;
    key: string;
    bytes: Buffer;
    mimeType: string;
    contentSha256: string;
  }> = [];
  error: Error | null = null;
  verificationOverride: {
    verifiedSizeBytes: number;
    contentSha256: string;
  } | null = null;

  async putVerifiedPrivateObject(input: {
    bucket: string;
    key: string;
    bytes: Buffer;
    mimeType: string;
    contentSha256: string;
  }) {
    this.writes.push(input);
    if (this.error) throw this.error;
    return (
      this.verificationOverride ?? {
        verifiedSizeBytes: input.bytes.byteLength,
        contentSha256: input.contentSha256,
      }
    );
  }
}

class FakeInspectionQueue implements AttachmentInspectionQueue {
  enqueued: string[] = [];

  async enqueueCanonicalAttachment(input: { canonicalAttachmentId: string }) {
    this.enqueued.push(input.canonicalAttachmentId);
  }
}

function harness(
  limits: {
    maxDownloadsPerRun?: number;
    maxAggregateBytesPerRun?: number;
  } = {}
) {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  const storage = new FakeStorage();
  const inspectionQueue = new FakeInspectionQueue();
  const service = new AttachmentIngestionService({
    repository,
    provider,
    storage,
    inspectionQueue,
    maxAttachmentBytes: MAX_BYTES,
    ...limits,
    now: () => NOW,
  });

  return { service, repository, provider, storage, inspectionQueue };
}

const request = {
  companyId: "company-1",
  connectionId: "connection-1",
  activityId: "activity-1",
  messageId: "message-1",
};

describe("AttachmentIngestionService exact activity ownership", () => {
  it("fails closed before provider access when exact activity identity is absent", async () => {
    const { service, repository, provider } = harness();
    repository.resolvedActivity = null;

    await expect(service.ingestExactMessage(request)).rejects.toBeInstanceOf(
      AttachmentActivityIdentityError
    );
    expect(provider.enumerateCalls).toEqual([]);
  });

  it("rejects a repository row that does not match company, connection, activity, and message", async () => {
    const { service, repository, provider } = harness();
    repository.resolvedActivity = { ...activity, messageId: "wrong-message" };

    await expect(service.ingestExactMessage(request)).rejects.toBeInstanceOf(
      AttachmentActivityIdentityError
    );
    expect(provider.enumerateCalls).toEqual([]);
  });

  it("quarantines a participant mismatch rather than trusting thread ownership", async () => {
    const { service, repository } = harness();
    repository.knownContactEmails = ["sandra@example.com"];

    await service.ingestExactMessage(request);

    expect(repository.upserts[0]).toEqual(
      expect.objectContaining({
        opportunityId: null,
        attributionStatus: "needs_review",
        activityId: "activity-1",
        messageId: "message-1",
      })
    );
  });
});

describe("AttachmentIngestionService durable storage", () => {
  it("stores exact bytes privately, verifies hash and size, projects a canonical URL, and queues inspection", async () => {
    const { service, repository, provider, storage, inspectionQueue } =
      harness();

    const result = await service.ingestExactMessage(request);

    const expectedHash = createHash("sha256")
      .update(Buffer.from("photo"))
      .digest("hex");
    const expectedKey = buildAttachmentStoragePath({
      companyId: "company-1",
      connectionId: "connection-1",
      messageId: "message-1",
      attachmentId: "attachment-1",
    });

    expect(provider.enumerateCalls).toEqual([
      {
        connectionId: "connection-1",
        messageId: "message-1",
        providerThreadId: "thread-1",
      },
    ]);
    expect(provider.downloadCalls).toEqual([
      expect.objectContaining({
        connectionId: "connection-1",
        messageId: "message-1",
        attachmentId: "attachment-1",
        maxBytes: MAX_BYTES,
      }),
    ]);
    expect(storage.writes).toEqual([
      {
        bucket: "email-attachments",
        key: expectedKey,
        bytes: Buffer.from("photo"),
        mimeType: "image/jpeg",
        contentSha256: expectedHash,
      },
    ]);
    expect(repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-attachment-1",
        ingestStatus: "stored",
        storageBackend: "supabase",
        storagePath: expectedKey,
        contentSha256: expectedHash,
        verifiedSizeBytes: 5,
        storedAt: NOW,
      })
    );
    expect(repository.projections).toEqual([
      {
        companyId: "company-1",
        activityId: "activity-1",
        canonicalUrls: [
          "/api/integrations/email/attachment?id=canonical-attachment-1",
        ],
      },
    ]);
    expect(inspectionQueue.enqueued).toEqual(["canonical-attachment-1"]);
    expect(result).toEqual(
      expect.objectContaining({ stored: 1, requiresRetry: false })
    );
  });

  it("uses detected file bytes rather than a forged provider MIME", async () => {
    const { service, repository, provider, storage } = harness();
    provider.attachments = [
      attachment({
        filename: "payload.html",
        providerMimeType: "text/html",
      }),
    ];
    provider.bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

    await service.ingestExactMessage(request);

    expect(storage.writes[0].mimeType).toBe("image/jpeg");
    expect(repository.statusUpdates).toContainEqual(
      expect.objectContaining({ detectedMimeType: "image/jpeg" })
    );
  });

  it("does not redownload a canonical row that is already stored", async () => {
    const { service, repository, provider, storage, inspectionQueue } =
      harness();
    repository.records.set("attachment-1", {
      id: "canonical-attachment-1",
      ingestStatus: "stored",
      ingestAttempts: 1,
      storagePath: "existing/content",
    });

    await service.ingestExactMessage(request);

    expect(provider.downloadCalls).toEqual([]);
    expect(storage.writes).toEqual([]);
    expect(repository.projections[0].canonicalUrls).toEqual([
      "/api/integrations/email/attachment?id=canonical-attachment-1",
    ]);
    expect(inspectionQueue.enqueued).toEqual(["canonical-attachment-1"]);
  });

  it("records reference attachments without pretending bytes were stored", async () => {
    const { service, repository, provider, storage, inspectionQueue } =
      harness();
    provider.attachments = [
      attachment({
        attachmentId: "reference-1",
        providerKind: "reference",
        downloadable: false,
        externalUrl: "https://sharepoint.example/reference",
      }),
    ];

    const result = await service.ingestExactMessage(request);

    expect(repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-reference-1",
        ingestStatus: "external",
      })
    );
    expect(provider.downloadCalls).toEqual([]);
    expect(storage.writes).toEqual([]);
    expect(repository.projections).toEqual([]);
    expect(inspectionQueue.enqueued).toEqual([]);
    expect(result.externalReferences).toBe(1);
  });

  it("records reported and verified oversize files without projection", async () => {
    const reported = harness();
    reported.provider.attachments = [
      attachment({ attachmentId: "too-big-reported", sizeBytes: 10_001 }),
    ];

    await reported.service.ingestExactMessage(request);

    expect(reported.provider.downloadCalls).toEqual([]);
    expect(reported.repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-too-big-reported",
        ingestStatus: "oversized",
        verifiedSizeBytes: null,
      })
    );

    const verified = harness();
    verified.provider.attachments = [
      attachment({ attachmentId: "too-big-verified", sizeBytes: 0 }),
    ];
    verified.provider.bytes = Buffer.alloc(10_001);

    await verified.service.ingestExactMessage(request);

    expect(verified.storage.writes).toEqual([]);
    expect(verified.repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-too-big-verified",
        ingestStatus: "oversized",
        verifiedSizeBytes: 10_001,
      })
    );
    expect(verified.repository.projections).toEqual([]);
  });

  it("marks transient failures retryable with deterministic backoff and does not project them", async () => {
    const { service, repository, provider, storage } = harness();
    provider.downloadError = new Error("provider timeout");

    const result = await service.ingestExactMessage(request);

    expect(repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-attachment-1",
        ingestStatus: "retrying",
        ingestAttempts: 1,
        lastError: "provider timeout",
        nextRetryAt: new Date("2026-07-15T08:01:00.000Z"),
      })
    );
    expect(storage.writes).toEqual([]);
    expect(repository.projections).toEqual([]);
    expect(result.requiresRetry).toBe(true);
  });

  it.each([404, 410])(
    "records permanent provider HTTP %i download failures as unavailable",
    async (providerStatus) => {
      const { service, repository, provider } = harness();
      provider.downloadError = new ProviderApiError(
        `provider rejected attachment with ${providerStatus}`,
        providerStatus
      );

      const result = await service.ingestExactMessage(request);

      expect(repository.statusUpdates).toContainEqual(
        expect.objectContaining({
          canonicalAttachmentId: "canonical-attachment-1",
          ingestStatus: "unavailable",
          ingestAttempts: 1,
          lastError: `provider rejected attachment with ${providerStatus}`,
          nextRetryAt: null,
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          unavailable: 1,
          retryPending: 0,
          requiresRetry: false,
        })
      );
    }
  );

  it("records provider HTTP 413 download failures as oversized", async () => {
    const { service, repository, provider } = harness();
    provider.downloadError = new ProviderApiError(
      "provider rejected attachment with 413",
      413
    );

    const result = await service.ingestExactMessage(request);

    expect(repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-attachment-1",
        ingestStatus: "oversized",
        lastError: "provider rejected attachment with 413",
      })
    );
    expect(result).toMatchObject({ oversized: 1, requiresRetry: false });
  });

  it.each([400, 422])(
    "keeps systemic provider HTTP %i download failures retryable",
    async (providerStatus) => {
      const { service, repository, provider } = harness();
      provider.downloadError = new ProviderApiError(
        `provider rejected attachment with ${providerStatus}`,
        providerStatus
      );

      const result = await service.ingestExactMessage(request);

      expect(repository.statusUpdates).toContainEqual(
        expect.objectContaining({ ingestStatus: "retrying" })
      );
      expect(result).toMatchObject({ retryPending: 1, requiresRetry: true });
    }
  );

  it.each([404, 410])(
    "converges permanent provider HTTP %i enumeration failures without retrying",
    async (providerStatus) => {
      const { service, repository, provider } = harness();
      provider.enumerateError = new ProviderApiError(
        `provider rejected message with ${providerStatus}`,
        providerStatus
      );

      await expect(service.ingestExactMessage(request)).resolves.toEqual(
        expect.objectContaining({
          unavailable: 1,
          retryPending: 0,
          requiresRetry: false,
        })
      );
      expect(repository.upserts).toEqual([]);
    }
  );

  it("classifies provider HTTP 413 enumeration failure as oversized", async () => {
    const { service, provider } = harness();
    provider.enumerateError = new ProviderApiError(
      "provider rejected message with 413",
      413
    );

    await expect(service.ingestExactMessage(request)).resolves.toMatchObject({
      oversized: 1,
      requiresRetry: false,
    });
  });

  it.each([400, 422])(
    "keeps systemic provider HTTP %i enumeration failures observable and retryable",
    async (providerStatus) => {
      const { service, provider } = harness();
      provider.enumerateError = new ProviderApiError(
        `provider rejected message with ${providerStatus}`,
        providerStatus
      );

      await expect(service.ingestExactMessage(request)).rejects.toBeInstanceOf(
        AttachmentScanRetryableError
      );
    }
  );

  it("defers excess downloads without consuming per-file attempts and converges on the next run", async () => {
    const { service, provider, repository } = harness({
      maxDownloadsPerRun: 1,
      maxAggregateBytesPerRun: MAX_BYTES,
    });
    provider.attachments = [
      attachment({ attachmentId: "first" }),
      attachment({ attachmentId: "second" }),
    ];

    const firstRun = await service.ingestExactMessage(request);

    expect(provider.downloadCalls).toHaveLength(1);
    expect(repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-second",
        ingestStatus: "retrying",
        ingestAttempts: 0,
      })
    );
    expect(firstRun).toMatchObject({ stored: 1, retryPending: 1 });

    provider.downloadCalls.length = 0;
    const secondRun = await service.ingestExactMessage(request);

    expect(provider.downloadCalls).toHaveLength(1);
    expect(secondRun).toMatchObject({ stored: 2, requiresRetry: false });
  });

  it("records invalid and cross-message descriptors as unavailable without retrying the scan", async () => {
    const { service, repository, provider } = harness();
    provider.attachments = [
      attachment({ attachmentId: "cross-message", messageId: "message-2" }),
      attachment({ attachmentId: "   " }),
      attachment({ attachmentId: null as never }),
    ];

    const result = await service.ingestExactMessage(request);

    expect(repository.upserts).toEqual([]);
    expect(provider.downloadCalls).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        discovered: 0,
        unavailable: 3,
        retryPending: 0,
        requiresRetry: false,
      })
    );
  });

  it("marks a transient canonical failure terminal at the bounded attempt ceiling", async () => {
    const { service, repository, provider } = harness();
    repository.records.set("attachment-1", {
      id: "canonical-attachment-1",
      ingestStatus: "retrying",
      ingestAttempts: 7,
      storagePath: null,
    });
    provider.downloadError = new Error("provider timeout");

    const result = await service.ingestExactMessage(request);

    expect(repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-attachment-1",
        ingestStatus: "failed",
        ingestAttempts: 8,
        lastError: "provider timeout",
        nextRetryAt: null,
        storageBackend: null,
        storagePath: null,
        contentSha256: null,
        verifiedSizeBytes: null,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        failed: 1,
        retryPending: 0,
        requiresRetry: false,
      })
    );
  });

  it("surfaces an existing canonical failed row without redownloading it", async () => {
    const { service, repository, provider, storage } = harness();
    repository.records.set("attachment-1", {
      id: "canonical-attachment-1",
      ingestStatus: "failed",
      ingestAttempts: 8,
      storagePath: null,
    });

    const result = await service.ingestExactMessage(request);

    expect(provider.downloadCalls).toEqual([]);
    expect(storage.writes).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        failed: 1,
        retryPending: 0,
        requiresRetry: false,
      })
    );
  });

  it("records terminal source deletion as unavailable rather than retrying forever", async () => {
    const { service, repository, provider } = harness();
    provider.downloadError = new AttachmentSourceUnavailableError(
      "provider object deleted"
    );

    const result = await service.ingestExactMessage(request);

    expect(repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-attachment-1",
        ingestStatus: "unavailable",
        lastError: "provider object deleted",
        nextRetryAt: null,
      })
    );
    expect(result.requiresRetry).toBe(false);
    expect(result.unavailable).toBe(1);
  });

  it.each([
    new ProviderAuthError("mailbox token revoked"),
    new ProviderScopeError("attachment read scope missing"),
  ])(
    "preserves provider credential errors from enumeration so the worker pauses the mailbox",
    async (providerError) => {
      const { service, provider } = harness();
      provider.enumerateError = providerError;

      await expect(service.ingestExactMessage(request)).rejects.toBe(
        providerError
      );
    }
  );

  it.each([
    new ProviderAuthError("mailbox token revoked"),
    new ProviderScopeError("attachment read scope missing"),
  ])(
    "preserves provider credential errors from download after recording retry metadata",
    async (providerError) => {
      const { service, repository, provider } = harness();
      provider.downloadError = providerError;

      await expect(service.ingestExactMessage(request)).rejects.toBe(
        providerError
      );
      expect(repository.statusUpdates).toContainEqual(
        expect.objectContaining({
          canonicalAttachmentId: "canonical-attachment-1",
          ingestStatus: "retrying",
          lastError: providerError.message,
        })
      );
    }
  );

  it("fails storage verification closed and schedules an idempotent retry", async () => {
    const { service, repository, storage } = harness();
    storage.verificationOverride = {
      verifiedSizeBytes: 4,
      contentSha256: "wrong-hash",
    };

    const result = await service.ingestExactMessage(request);

    expect(repository.statusUpdates).toContainEqual(
      expect.objectContaining({
        canonicalAttachmentId: "canonical-attachment-1",
        ingestStatus: "retrying",
        ingestAttempts: 1,
        lastError: expect.stringContaining("verification mismatch"),
      })
    );
    expect(repository.projections).toEqual([]);
    expect(result.requiresRetry).toBe(true);
  });
});
