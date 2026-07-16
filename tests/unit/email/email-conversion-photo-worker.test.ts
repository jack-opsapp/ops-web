import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildEmailConversionProjectPhotoPath,
  runEmailConversionPhotoWorker,
  type ClaimedEmailConversionPhotoCleanup,
  type ClaimedEmailConversionPhotoJob,
  type EmailConversionPhotoWorkerDependencies,
} from "@/lib/api/services/email-conversion-photo-worker";

const sourceBytes = Buffer.from("private-source");
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");

const job: ClaimedEmailConversionPhotoJob = {
  id: "job-1",
  companyId: "company-1",
  conversionEventId: "conversion-1",
  emailAttachmentId: "attachment-1",
  opportunityId: "opportunity-1",
  projectId: "project-1",
  sourceContentSha256: sourceHash,
  sourceVerifiedSizeBytes: sourceBytes.byteLength,
  operation: "materialize",
  generation: 2,
  attempts: 1,
  leaseToken: "lease-1",
};

const cleanup: ClaimedEmailConversionPhotoCleanup = {
  id: "object-1",
  jobId: job.id,
  companyId: job.companyId,
  conversionEventId: job.conversionEventId,
  emailAttachmentId: job.emailAttachmentId,
  projectId: job.projectId,
  generation: job.generation,
  objectPath: "company-1/project-1/email/conversion-1/old-g1.jpg",
  attempts: 3,
  leaseToken: "cleanup-lease-1",
};

function dependencies(
  overrides: Partial<EmailConversionPhotoWorkerDependencies> = {}
): EmailConversionPhotoWorkerDependencies {
  const normalized = Buffer.from("normalized-project-photo");
  return {
    claim: vi.fn(async () => [job]),
    claimCleanups: vi.fn(async () => []),
    loadSource: vi.fn(async () => ({
      storagePath: "company-1/mailbox-1/source.jpg",
      detectedMimeType: "image/jpeg",
      filename: "job-site.jpg",
      isInline: false,
      occurredAt: "2026-07-15T12:00:00.000Z",
      verifiedSizeBytes: sourceBytes.byteLength,
    })),
    downloadPrivate: vi.fn(async () => sourceBytes),
    normalizeImage: vi.fn(async () => ({
      bytes: normalized,
      mimeType: "image/jpeg" as const,
    })),
    stageObject: vi.fn(async () => true),
    uploadProjectPhoto: vi.fn(async ({ objectPath, bytes }) => ({
      objectPath,
      publicUrl: `https://storage.test/project-photos/${objectPath}`,
      verifiedSizeBytes: bytes.byteLength,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
    })),
    markObjectCleanup: vi.fn(async () => true),
    deleteProjectPhoto: vi.fn(async () => undefined),
    finishObjectCleanup: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    completeRevocation: vi.fn(async () => true),
    finish: vi.fn(async () => true),
    now: () => new Date("2026-07-15T12:30:00.000Z"),
    workerId: () => "worker-1",
    ...overrides,
  };
}

describe("email conversion photo worker", () => {
  it("uses a deterministic event-and-generation-specific storage identity", () => {
    expect(buildEmailConversionProjectPhotoPath(job)).toBe(
      `company-1/project-1/email/conversion-1/attachment-1-${sourceHash.slice(0, 32)}-g2.jpg`
    );
  });

  it("durably stages the exact object before upload and completes atomically", async () => {
    const callOrder: string[] = [];
    const deps = dependencies({
      stageObject: vi.fn(async () => {
        callOrder.push("stage");
        return true;
      }),
      uploadProjectPhoto: vi.fn(async ({ objectPath, bytes }) => {
        callOrder.push("upload");
        return {
          objectPath,
          publicUrl: `https://storage.test/project-photos/${objectPath}`,
          verifiedSizeBytes: bytes.byteLength,
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }),
      complete: vi.fn(async () => {
        callOrder.push("complete");
        return true;
      }),
    });

    const result = await runEmailConversionPhotoWorker(deps, {
      limit: 5,
      leaseSeconds: 360,
    });

    expect(result).toEqual({
      claimed: 1,
      completed: 1,
      retrying: 0,
      skipped: 0,
      failed: 0,
      staleCompletions: 0,
      cleanupClaimed: 0,
      cleanupCompleted: 0,
      cleanupRetrying: 0,
      errors: [],
    });
    expect(callOrder).toEqual(["stage", "upload", "complete"]);
    const objectPath = buildEmailConversionProjectPhotoPath(job);
    expect(deps.stageObject).toHaveBeenCalledWith({ job, objectPath });
    expect(deps.uploadProjectPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ objectPath, contentType: "image/jpeg" })
    );
    expect(deps.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        job,
        filename: "job-site.jpg",
        occurredAt: "2026-07-15T12:00:00.000Z",
        projectObjectPath: objectPath,
      })
    );
    expect(deps.markObjectCleanup).not.toHaveBeenCalled();
    expect(deps.finish).not.toHaveBeenCalled();
  });

  it("refuses a stale lease before touching public storage", async () => {
    const deps = dependencies({ stageObject: vi.fn(async () => false) });

    const result = await runEmailConversionPhotoWorker(deps);

    expect(result.staleCompletions).toBe(1);
    expect(deps.uploadProjectPhoto).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("verifies the private byte hash and size before normalization or upload", async () => {
    const deps = dependencies({
      downloadPrivate: vi.fn(async () => Buffer.from("different-private-source")),
    });

    const result = await runEmailConversionPhotoWorker(deps);

    expect(result.retrying).toBe(1);
    expect(deps.normalizeImage).not.toHaveBeenCalled();
    expect(deps.stageObject).not.toHaveBeenCalled();
    expect(deps.uploadProjectPhoto).not.toHaveBeenCalled();
    expect(deps.finish).toHaveBeenCalledWith(
      expect.objectContaining({ error: "SOURCE_BYTES_IDENTITY_MISMATCH" })
    );
  });

  it("marks an uploaded stale completion for fenced cleanup without deleting directly", async () => {
    const deps = dependencies({ complete: vi.fn(async () => false) });

    const result = await runEmailConversionPhotoWorker(deps);

    expect(result.staleCompletions).toBe(1);
    expect(deps.markObjectCleanup).toHaveBeenCalledWith({
      job,
      objectPath: buildEmailConversionProjectPhotoPath(job),
      reason: "STALE_MATERIALIZATION_COMPLETION",
    });
    expect(deps.deleteProjectPhoto).not.toHaveBeenCalled();
  });

  it("marks an uncertain staged upload for cleanup before retrying the job", async () => {
    const deps = dependencies({
      uploadProjectPhoto: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    });

    const result = await runEmailConversionPhotoWorker(deps);

    expect(result.retrying).toBe(1);
    expect(deps.markObjectCleanup).toHaveBeenCalledWith({
      job,
      objectPath: buildEmailConversionProjectPhotoPath(job),
      reason: "MATERIALIZATION_ERROR: storage unavailable",
    });
    expect(deps.finish).toHaveBeenCalledWith({
      job,
      outcome: "retrying",
      error: "storage unavailable",
      availableAt: new Date("2026-07-15T12:32:00.000Z"),
    });
  });

  it("claims and completes a fenced object cleanup before revocation", async () => {
    const revoked = { ...job, operation: "revoke" as const };
    const deps = dependencies({
      claim: vi.fn(async () => [revoked]),
      claimCleanups: vi.fn(async ({ jobId }) => (jobId ? [cleanup] : [])),
    });

    const result = await runEmailConversionPhotoWorker(deps);

    expect(result.completed).toBe(1);
    expect(result.cleanupClaimed).toBe(1);
    expect(result.cleanupCompleted).toBe(1);
    expect(deps.deleteProjectPhoto).toHaveBeenCalledWith(cleanup.objectPath);
    expect(deps.finishObjectCleanup).toHaveBeenCalledWith({
      cleanup,
      outcome: "deleted",
      error: null,
      availableAt: null,
    });
    expect(deps.completeRevocation).toHaveBeenCalledWith({ job: revoked });
    expect(deps.loadSource).not.toHaveBeenCalled();
  });

  it("keeps cleanup retryable indefinitely when the public delete fails", async () => {
    const maxedCleanup = { ...cleanup, attempts: 500 };
    const deps = dependencies({
      claim: vi.fn(async () => []),
      claimCleanups: vi.fn(async () => [maxedCleanup]),
      deleteProjectPhoto: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    });

    const result = await runEmailConversionPhotoWorker(deps);

    expect(result.cleanupRetrying).toBe(1);
    expect(result.failed).toBe(0);
    expect(deps.finishObjectCleanup).toHaveBeenCalledWith({
      cleanup: maxedCleanup,
      outcome: "retrying",
      error: "storage unavailable",
      availableAt: new Date("2026-07-16T12:30:00.000Z"),
    });
  });

  it("skips a source that is no longer an eligible attributed image", async () => {
    const deps = dependencies({ loadSource: vi.fn(async () => null) });

    const result = await runEmailConversionPhotoWorker(deps);

    expect(result.skipped).toBe(1);
    expect(deps.finish).toHaveBeenCalledWith({
      job,
      outcome: "skipped",
      error: "SOURCE_NOT_ELIGIBLE",
      availableAt: null,
    });
    expect(deps.downloadPrivate).not.toHaveBeenCalled();
  });

  it("skips undecodable image bytes without touching public storage", async () => {
    const deps = dependencies({ normalizeImage: vi.fn(async () => null) });

    const result = await runEmailConversionPhotoWorker(deps);

    expect(result.skipped).toBe(1);
    expect(deps.finish).toHaveBeenCalledWith({
      job,
      outcome: "skipped",
      error: "IMAGE_DECODE_UNSUPPORTED",
      availableAt: null,
    });
    expect(deps.stageObject).not.toHaveBeenCalled();
  });

  it("reports queue-update errors so cron monitoring fails closed", async () => {
    const deps = dependencies({
      downloadPrivate: vi.fn(async () => {
        throw new Error("private object missing");
      }),
      finish: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    const result = await runEmailConversionPhotoWorker(deps);

    expect(result.errors).toEqual([
      {
        jobId: job.id,
        error:
          "private object missing; queue update failed: database unavailable",
      },
    ]);
  });
});
