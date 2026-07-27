import { describe, expect, it, vi } from "vitest";

import {
  ExternalApiOperationsUnavailableError,
  runExternalApiOperationsMaintenance,
} from "@/lib/external-api/security/security-alerts";
import type { VersionedHmacKeyRing } from "@/lib/external-api/intake/idempotency";

const keyRing: VersionedHmacKeyRing = {
  activeKid: 3,
  keys: new Map([
    [1, Buffer.alloc(32, 1)],
    [2, Buffer.alloc(32, 2)],
    [3, Buffer.alloc(32, 3)],
  ]),
};

const healthyResult = {
  credentials_retired: 2,
  network_fingerprints_purged: 4,
  security_events_purged: 3,
  projection_versions_pruned: 8,
  alerts_created: 2,
  recipients_notified: 3,
  referenced_idempotency_kids: [1, 2, 3],
  missing_idempotency_kids: [],
  health: {
    active_expired_upload_batches: 0,
    overlap_credentials_due: 0,
    expired_network_fingerprints: 0,
    expired_security_events: 0,
    expired_projection_versions: 0,
    pending_security_alerts: 0,
  },
};

describe("external API security operations", () => {
  it("runs one bounded maintenance command with every retained idempotency kid", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: healthyResult,
      error: null,
    });

    const result = await runExternalApiOperationsMaintenance(
      { rpc },
      {
        idempotencyKeyRing: keyRing,
        limit: 100,
        now: new Date("2026-07-27T18:00:00.000Z"),
      }
    );

    expect(rpc).toHaveBeenCalledWith(
      "maintain_external_api_operations_as_system",
      {
        p_idempotency_kids: [1, 2, 3],
        p_limit: 100,
        p_now: "2026-07-27T18:00:00.000Z",
      }
    );
    expect(result).toEqual({
      credentialsRetired: 2,
      networkFingerprintsPurged: 4,
      securityEventsPurged: 3,
      projectionVersionsPruned: 8,
      alertsCreated: 2,
      recipientsNotified: 3,
      referencedIdempotencyKids: [1, 2, 3],
      health: {
        activeExpiredUploadBatches: 0,
        overlapCredentialsDue: 0,
        expiredNetworkFingerprints: 0,
        expiredSecurityEvents: 0,
        expiredProjectionVersions: 0,
        pendingSecurityAlerts: 0,
      },
    });
  });

  it("fails closed when retained database evidence references a missing key", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...healthyResult,
        referenced_idempotency_kids: [1, 2, 3, 4],
        missing_idempotency_kids: [4],
      },
      error: null,
    });

    await expect(
      runExternalApiOperationsMaintenance(
        { rpc },
        {
          idempotencyKeyRing: keyRing,
          limit: 100,
          now: new Date("2026-07-27T18:00:00.000Z"),
        }
      )
    ).rejects.toBeInstanceOf(ExternalApiOperationsUnavailableError);
  });

  it.each([
    { data: null, error: { message: "private backend detail" } },
    { data: { missing_idempotency_kids: [] }, error: null },
  ])(
    "fails closed for unavailable or malformed maintenance state",
    async (reply) => {
      const rpc = vi.fn().mockResolvedValue(reply);

      await expect(
        runExternalApiOperationsMaintenance(
          { rpc },
          {
            idempotencyKeyRing: keyRing,
            limit: 100,
            now: new Date("2026-07-27T18:00:00.000Z"),
          }
        )
      ).rejects.toBeInstanceOf(ExternalApiOperationsUnavailableError);
    }
  );
});
