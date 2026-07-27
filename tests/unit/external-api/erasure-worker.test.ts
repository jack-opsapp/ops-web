import { beforeEach, describe, expect, it, vi } from "vitest";

import { processExternalIntakeErasureBatch } from "@/lib/external-api/uploads/erasure-worker";

vi.mock("@/lib/external-api/uploads/s3-client", () => ({
  getExternalIntakeWorkerS3Client: vi.fn(() => ({ send: vi.fn() })),
  readExternalIntakeStorageConfig: vi.fn(() => ({ bucket: "intake-test" })),
}));

const REQUEST = {
  id: "11111111-1111-4111-8111-111111111111",
  submission_id: "22222222-2222-4222-8222-222222222222",
  company_id: "33333333-3333-4333-8333-333333333333",
  opportunity_id: "44444444-4444-4444-8444-444444444444",
  attempt_count: 1,
  lease_generation: 2,
  lease_token: "55555555-5555-4555-8555-555555555555",
  invalidation_reference: null,
  storage_objects: [
    {
      object_key:
        "accepted-original/33333333-3333-4333-8333-333333333333/a/file",
      object_version_id: "version-1",
    },
    {
      object_key:
        "safe-derivative/33333333-3333-4333-8333-333333333333/a/file.webp",
      object_version_id: "version-2",
    },
  ],
  invalidation_paths: [
    "/accepted-original/33333333-3333-4333-8333-333333333333/a/file",
    "/safe-derivative/33333333-3333-4333-8333-333333333333/a/file.webp",
  ],
};

describe("external intake erasure worker", () => {
  const rpc = vi.fn();
  const deleteExactObject = vi.fn();
  const invalidatePaths = vi.fn();
  const verifyDeliveryDenied = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes every exact version, invalidates paths, verifies denial, then tombstones", async () => {
    rpc
      .mockResolvedValueOnce({ data: [REQUEST], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    deleteExactObject.mockResolvedValue(undefined);
    invalidatePaths.mockResolvedValue("INV-1");
    verifyDeliveryDenied.mockResolvedValue(true);

    const result = await processExternalIntakeErasureBatch(
      { rpc } as never,
      { workerId: "erase-1" },
      {
        deleteExactObject,
        invalidatePaths,
        verifyDeliveryDenied,
        now: () => new Date("2026-07-26T22:00:00.000Z"),
      }
    );

    expect(deleteExactObject).toHaveBeenCalledTimes(2);
    expect(invalidatePaths).toHaveBeenCalledWith(REQUEST.invalidation_paths);
    expect(verifyDeliveryDenied).toHaveBeenCalledWith([
      "accepted-original/33333333-3333-4333-8333-333333333333/a/file",
      "safe-derivative/33333333-3333-4333-8333-333333333333/a/file.webp",
    ]);
    expect(rpc).toHaveBeenLastCalledWith(
      "finish_external_intake_erasure_as_system",
      expect.objectContaining({
        p_outcome: "deleted",
        p_invalidation_reference: "INV-1",
      })
    );
    expect(result).toEqual({
      claimed: 1,
      completed: 1,
      requeued: 0,
      stale: 0,
      objectsDeleted: 2,
      invalidationsCreated: 1,
      errors: 0,
    });
  });

  it("requeues without finalizing while a cookieless capability still reads", async () => {
    rpc
      .mockResolvedValueOnce({ data: [REQUEST], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    deleteExactObject.mockResolvedValue(undefined);
    invalidatePaths.mockResolvedValue("INV-2");
    verifyDeliveryDenied.mockResolvedValue(false);

    const result = await processExternalIntakeErasureBatch(
      { rpc } as never,
      { workerId: "erase-2" },
      {
        deleteExactObject,
        invalidatePaths,
        verifyDeliveryDenied,
        now: () => new Date("2026-07-26T22:00:00.000Z"),
      }
    );

    expect(rpc).toHaveBeenLastCalledWith(
      "finish_external_intake_erasure_as_system",
      expect.objectContaining({
        p_outcome: "retry",
        p_invalidation_reference: "INV-2",
        p_safe_code: "erasure_retry",
      })
    );
    expect(result).toMatchObject({
      completed: 0,
      requeued: 1,
      errors: 1,
    });
  });

  it("reuses an existing invalidation reference after a retry", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [{ ...REQUEST, invalidation_reference: "INV-EXISTING" }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    deleteExactObject.mockResolvedValue(undefined);
    verifyDeliveryDenied.mockResolvedValue(true);

    await processExternalIntakeErasureBatch(
      { rpc } as never,
      { workerId: "erase-3" },
      {
        deleteExactObject,
        invalidatePaths,
        verifyDeliveryDenied,
      }
    );

    expect(invalidatePaths).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith(
      "finish_external_intake_erasure_as_system",
      expect.objectContaining({
        p_invalidation_reference: "INV-EXISTING",
      })
    );
  });
});
