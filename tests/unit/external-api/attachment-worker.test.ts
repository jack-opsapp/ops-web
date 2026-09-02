import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  runExternalIntakeAttachmentWorker,
  type ClaimedExternalIntakeInspection,
  type ExternalIntakeAttachmentWorkerDependencies,
} from "@/lib/external-api/uploads/attachment-worker";

const NOW = new Date("2026-07-26T20:00:00.000Z");

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function job(
  overrides: Partial<ClaimedExternalIntakeInspection> = {}
): ClaimedExternalIntakeInspection {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    intentId: "22222222-2222-4222-8222-222222222222",
    companyId: "33333333-3333-4333-8333-333333333333",
    objectKey:
      "quarantine/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666",
    objectVersionId: "v1",
    filename: "photo.png",
    declaredContentType: "image/png",
    expectedSizeBytes: 0,
    expectedChecksumSha256: null,
    observedSizeBytes: 0,
    observedChecksumSha256: null,
    guardDutyStatus: "NO_THREATS_FOUND",
    firstQueuedAt: "2026-07-26T19:00:00.000Z",
    deadlineAt: "2026-07-27T19:00:00.000Z",
    deleteNotBefore: "2026-07-26T20:02:00.000Z",
    attempts: 1,
    generation: 1,
    leaseToken: "77777777-7777-4777-8777-777777777777",
    ...overrides,
  };
}

function dependencies(input: {
  jobs: ClaimedExternalIntakeInspection[];
  bytes: Buffer;
}): ExternalIntakeAttachmentWorkerDependencies & {
  accept: ReturnType<typeof vi.fn>;
  reject: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
  tagAccepted: ReturnType<typeof vi.fn>;
} {
  const accept = vi.fn(async () => true);
  const reject = vi.fn(async () => true);
  const retry = vi.fn(async () => true);
  const cleanup = vi.fn(async () => true);
  const tagAccepted = vi.fn(async () => undefined);
  return {
    claim: vi.fn(async () => input.jobs),
    readExactObject: vi.fn(async () => ({
      bytes: input.bytes,
      versionId: "v1",
      contentLength: input.bytes.length,
      checksumSha256: hash(input.bytes),
    })),
    tagAccepted,
    accept,
    reject,
    retry,
    cleanup,
    now: () => NOW,
    workerId: () => "worker-1",
  };
}

describe("external intake attachment worker", () => {
  it("requires malware success and structural success before accepting an image", async () => {
    const bytes = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "#406078",
      },
    })
      .png()
      .toBuffer();
    const deps = dependencies({
      jobs: [
        job({
          expectedSizeBytes: bytes.length,
          observedSizeBytes: bytes.length,
          expectedChecksumSha256: hash(bytes),
          observedChecksumSha256: hash(bytes),
        }),
      ],
      bytes,
    });

    const result = await runExternalIntakeAttachmentWorker(deps);

    expect(result).toMatchObject({
      claimed: 1,
      accepted: 1,
      rejected: 0,
      retrying: 0,
    });
    expect(deps.tagAccepted).toHaveBeenCalledOnce();
    expect(deps.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        detectedContentType: "image/png",
        sanitizedImage: expect.objectContaining({
          contentType: "image/png",
        }),
      })
    );
  });

  it("rejects threats and schedules cleanup without reading the object", async () => {
    const bytes = Buffer.from("unused");
    const deps = dependencies({
      jobs: [job({ guardDutyStatus: "THREATS_FOUND" })],
      bytes,
    });

    const result = await runExternalIntakeAttachmentWorker(deps);

    expect(result.rejected).toBe(1);
    expect(deps.readExactObject).not.toHaveBeenCalled();
    expect(deps.reject).toHaveBeenCalledWith(
      expect.objectContaining({ safeCode: "malware_detected" })
    );
    expect(deps.cleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        deleteNotBefore: expect.any(Date),
        reason: "malware_detected",
      })
    );
  });

  it("retries missing scans and terminalizes unavailable inspection at 24 hours", async () => {
    const retryDeps = dependencies({
      jobs: [job({ guardDutyStatus: null })],
      bytes: Buffer.from("unused"),
    });
    const retryResult = await runExternalIntakeAttachmentWorker(retryDeps);
    expect(retryResult.retrying).toBe(1);
    expect(retryDeps.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        safeCode: "malware_scan_pending",
        availableAt: expect.any(Date),
      })
    );

    const terminalDeps = dependencies({
      jobs: [
        job({
          guardDutyStatus: null,
          deadlineAt: "2026-07-26T19:59:59.000Z",
        }),
      ],
      bytes: Buffer.from("unused"),
    });
    const terminalResult =
      await runExternalIntakeAttachmentWorker(terminalDeps);
    expect(terminalResult.rejected).toBe(1);
    expect(terminalDeps.reject).toHaveBeenCalledWith(
      expect.objectContaining({ safeCode: "inspection_unavailable" })
    );
    expect(terminalDeps.cleanup).toHaveBeenCalledOnce();
  });

  it("never accepts a clean result that arrives after the inspection deadline", async () => {
    const bytes = Buffer.from("deck dimensions");
    const deps = dependencies({
      jobs: [
        job({
          filename: "notes.txt",
          declaredContentType: "text/plain",
          expectedSizeBytes: bytes.length,
          observedSizeBytes: bytes.length,
          expectedChecksumSha256: hash(bytes),
          observedChecksumSha256: hash(bytes),
          guardDutyStatus: "NO_THREATS_FOUND",
          deadlineAt: "2026-07-26T19:59:59.000Z",
        }),
      ],
      bytes,
    });

    const result = await runExternalIntakeAttachmentWorker(deps);

    expect(result.rejected).toBe(1);
    expect(deps.readExactObject).not.toHaveBeenCalled();
    expect(deps.reject).toHaveBeenCalledWith(
      expect.objectContaining({ safeCode: "inspection_unavailable" })
    );
  });

  it("rejects exact-object evidence changes and never accepts a replacement version", async () => {
    const bytes = Buffer.from("deck dimensions");
    const expected = job({
      filename: "notes.txt",
      declaredContentType: "text/plain",
      expectedSizeBytes: bytes.length,
      observedSizeBytes: bytes.length,
      expectedChecksumSha256: hash(bytes),
      observedChecksumSha256: hash(bytes),
    });
    const deps = dependencies({ jobs: [expected], bytes });
    deps.readExactObject = vi.fn(async () => ({
      bytes,
      versionId: "replacement-v2",
      contentLength: bytes.length,
      checksumSha256: hash(bytes),
    }));

    const result = await runExternalIntakeAttachmentWorker(deps);

    expect(result.rejected).toBe(1);
    expect(deps.tagAccepted).not.toHaveBeenCalled();
    expect(deps.accept).not.toHaveBeenCalled();
    expect(deps.reject).toHaveBeenCalledWith(
      expect.objectContaining({ safeCode: "object_evidence_mismatch" })
    );
  });

  it("treats stale generation completions as fenced work", async () => {
    const bytes = Buffer.from("deck dimensions");
    const deps = dependencies({
      jobs: [
        job({
          filename: "notes.txt",
          declaredContentType: "text/plain",
          expectedSizeBytes: bytes.length,
          observedSizeBytes: bytes.length,
          expectedChecksumSha256: hash(bytes),
          observedChecksumSha256: hash(bytes),
        }),
      ],
      bytes,
    });
    deps.accept.mockResolvedValueOnce(false);

    const result = await runExternalIntakeAttachmentWorker(deps);

    expect(result.staleCompletions).toBe(1);
    expect(result.accepted).toBe(0);
  });
});
