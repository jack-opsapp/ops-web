import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runMaintenance = vi.fn();
const runOperations = vi.fn();
const processOutbox = vi.fn();
let leaseHeld = false;

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ role: "service" }),
}));

vi.mock("@/lib/external-api/uploads/attachment-runtime", () => ({
  runExternalIntakeMaintenance: (...args: unknown[]) => runMaintenance(...args),
}));

vi.mock("@/lib/external-api/intake/outbox-worker", () => ({
  processExternalIntakeOutboxBatch: (...args: unknown[]) =>
    processOutbox(...args),
}));

vi.mock("@/lib/external-api/security/security-alerts", () => ({
  runExternalApiOperationsMaintenance: (...args: unknown[]) =>
    runOperations(...args),
}));

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  runWithCronWorkloadControl: async ({
    work,
  }: {
    work: () => Promise<unknown>;
  }) =>
    leaseHeld
      ? { status: "skipped", reason: "lease_held" }
      : { status: "completed", value: await work() },
}));

function request(authorization?: string): NextRequest {
  return new Request("http://localhost/api/cron/external-api-maintenance", {
    headers: authorization ? { authorization } : undefined,
  }) as unknown as NextRequest;
}

describe("external API maintenance cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "secret";
    leaseHeld = false;
    runMaintenance.mockReset();
    runOperations.mockReset();
    processOutbox.mockReset();
    runOperations.mockResolvedValue({
      credentialsRetired: 2,
      networkFingerprintsPurged: 4,
      securityEventsPurged: 3,
      projectionVersionsPruned: 8,
      alertsCreated: 2,
      recipientsNotified: 3,
      referencedIdempotencyKids: [1, 2],
      health: {
        activeExpiredUploadBatches: 0,
        overlapCredentialsDue: 0,
        expiredNetworkFingerprints: 0,
        expiredSecurityEvents: 0,
        expiredProjectionVersions: 0,
        pendingSecurityAlerts: 0,
      },
    });
    runMaintenance.mockResolvedValue({
      eventsRecorded: 2,
      inspectionsClaimed: 1,
      accepted: 1,
      rejected: 0,
      retrying: 0,
      cleanupsClaimed: 1,
      cleanupsCompleted: 1,
      cleanupRetrying: 0,
      expired: 0,
      credentialsRetired: 1,
      errors: [],
    });
    processOutbox.mockResolvedValue({
      claimed: 2,
      completed: 2,
      requeued: 0,
      errors: [],
    });
  });

  it("rejects unauthorized work before touching storage or the database", async () => {
    const { GET } =
      await import("@/app/api/cron/external-api-maintenance/route");
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runMaintenance).not.toHaveBeenCalled();
    expect(runOperations).not.toHaveBeenCalled();
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it("runs one bounded, leased maintenance slice and returns counts only", async () => {
    const { GET } =
      await import("@/app/api/cron/external-api-maintenance/route");
    const response = await GET(request("Bearer secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: true,
      operationsCredentialsRetired: 2,
      networkFingerprintsPurged: 4,
      securityEventsPurged: 3,
      projectionVersionsPruned: 8,
      securityAlertsCreated: 2,
      securityRecipientsNotified: 3,
      operationsHealth: {
        activeExpiredUploadBatches: 0,
        overlapCredentialsDue: 0,
        expiredNetworkFingerprints: 0,
        expiredSecurityEvents: 0,
        expiredProjectionVersions: 0,
        pendingSecurityAlerts: 0,
      },
      eventsRecorded: 2,
      inspectionsClaimed: 1,
      accepted: 1,
      rejected: 0,
      retrying: 0,
      cleanupsClaimed: 1,
      cleanupsCompleted: 1,
      cleanupRetrying: 0,
      expired: 0,
      credentialsRetired: 1,
      outboxClaimed: 2,
      outboxCompleted: 2,
      outboxRetrying: 0,
    });
    expect(runOperations).toHaveBeenCalledWith(
      { role: "service" },
      expect.objectContaining({ limit: expect.any(Number) })
    );
    expect(runOperations.mock.invocationCallOrder[0]).toBeLessThan(
      runMaintenance.mock.invocationCallOrder[0]
    );
    expect(runMaintenance).toHaveBeenCalledWith(
      { role: "service" },
      expect.objectContaining({
        eventLimit: expect.any(Number),
        inspectionLimit: expect.any(Number),
        cleanupLimit: expect.any(Number),
      })
    );
    expect(processOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: expect.any(Number),
        leaseSeconds: expect.any(Number),
        workerId: "external-api-maintenance",
      })
    );
  });

  it("does not overlap an already-running maintenance slice", async () => {
    leaseHeld = true;
    const { GET } =
      await import("@/app/api/cron/external-api-maintenance/route");
    const response = await GET(request("Bearer secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(runMaintenance).not.toHaveBeenCalled();
    expect(runOperations).not.toHaveBeenCalled();
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it("does not return object keys, filenames, or provider detail", async () => {
    runMaintenance.mockResolvedValueOnce({
      eventsRecorded: 0,
      inspectionsClaimed: 0,
      accepted: 0,
      rejected: 0,
      retrying: 0,
      cleanupsClaimed: 0,
      cleanupsCompleted: 0,
      cleanupRetrying: 0,
      expired: 0,
      credentialsRetired: 0,
      errors: [{ error: "private detail", objectKey: "quarantine/secret" }],
    });
    const { GET } =
      await import("@/app/api/cron/external-api-maintenance/route");
    const response = await GET(request("Bearer secret"));
    const body = JSON.stringify(await response.json());

    expect(body).not.toContain("quarantine/");
    expect(body).not.toContain("private detail");
  });
});
