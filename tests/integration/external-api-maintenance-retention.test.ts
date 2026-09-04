import { describe, expect, it, vi } from "vitest";

import {
  ExternalApiOperationsUnavailableError,
  runExternalApiOperationsMaintenance,
} from "@/lib/external-api/security/security-alerts";
import type { VersionedHmacKeyRing } from "@/lib/external-api/intake/idempotency";

const keyRing: VersionedHmacKeyRing = {
  activeKid: 2,
  keys: new Map([
    [1, Buffer.alloc(32, 1)],
    [2, Buffer.alloc(32, 2)],
  ]),
};

describe("external API maintenance retention", () => {
  it("does not report a successful slice when key health cannot be proven", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        credentials_retired: 0,
        network_fingerprints_purged: 0,
        security_events_purged: 0,
        projection_versions_pruned: 0,
        alerts_created: 0,
        recipients_notified: 0,
        referenced_idempotency_kids: [1, 2, 3],
        missing_idempotency_kids: [3],
        health: {
          active_expired_upload_batches: 0,
          overlap_credentials_due: 0,
          expired_network_fingerprints: 0,
          expired_security_events: 0,
          expired_projection_versions: 0,
          pending_security_alerts: 0,
        },
      },
      error: null,
    });

    await expect(
      runExternalApiOperationsMaintenance(
        { rpc },
        {
          idempotencyKeyRing: keyRing,
          limit: 50,
          now: new Date("2026-07-27T18:00:00.000Z"),
        }
      )
    ).rejects.toBeInstanceOf(ExternalApiOperationsUnavailableError);
  });
});
