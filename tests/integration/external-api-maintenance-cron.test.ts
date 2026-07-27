import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runMaintenance = vi.fn();
let leaseHeld = false;

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ role: "service" }),
}));

vi.mock("@/lib/external-api/uploads/attachment-runtime", () => ({
  runExternalIntakeMaintenance: (...args: unknown[]) => runMaintenance(...args),
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
  });

  it("rejects unauthorized work before touching storage or the database", async () => {
    const { GET } =
      await import("@/app/api/cron/external-api-maintenance/route");
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it("runs one bounded, leased maintenance slice and returns counts only", async () => {
    const { GET } =
      await import("@/app/api/cron/external-api-maintenance/route");
    const response = await GET(request("Bearer secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: true,
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
    });
    expect(runMaintenance).toHaveBeenCalledWith(
      { role: "service" },
      expect.objectContaining({
        eventLimit: expect.any(Number),
        inspectionLimit: expect.any(Number),
        cleanupLimit: expect.any(Number),
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
