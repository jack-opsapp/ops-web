import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getServiceRoleClientMock,
  runEmailSendReconciliationRecoveryMock,
  runWithCronWorkloadControlMock,
  isDatabasePressureErrorMock,
  runWithSupabaseMock,
  serviceRoleClient,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  runEmailSendReconciliationRecoveryMock: vi.fn(),
  runWithCronWorkloadControlMock: vi.fn(),
  isDatabasePressureErrorMock: vi.fn(),
  runWithSupabaseMock: vi.fn(),
  serviceRoleClient: { kind: "service-role-client" },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: runWithSupabaseMock,
}));

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  runWithCronWorkloadControl: runWithCronWorkloadControlMock,
  isDatabasePressureError: isDatabasePressureErrorMock,
}));

vi.mock(
  "@/lib/api/services/email-send-reconciliation-recovery-service",
  () => ({
    runEmailSendReconciliationRecovery: runEmailSendReconciliationRecoveryMock,
  })
);

import { GET } from "@/app/api/cron/email-send-reconciliation/route";

function request(secret = "cron-test-secret"): NextRequest {
  return new NextRequest(
    "https://ops.test/api/cron/email-send-reconciliation",
    { headers: { authorization: `Bearer ${secret}` } }
  );
}

describe("email send reconciliation cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
    getServiceRoleClientMock.mockReset();
    getServiceRoleClientMock.mockReturnValue(serviceRoleClient);
    runWithSupabaseMock.mockReset();
    runWithSupabaseMock.mockImplementation(
      async (_client: unknown, work: () => Promise<unknown>) => work()
    );
    runWithCronWorkloadControlMock.mockReset();
    runWithCronWorkloadControlMock.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => ({
        status: "completed",
        value: await work(),
      })
    );
    isDatabasePressureErrorMock.mockReset();
    isDatabasePressureErrorMock.mockImplementation((error: unknown) =>
      /PGRST002|57014|connection timeout|SSL handshake failed|web server is down|\b52[125]\b/i.test(
        String(error)
      )
    );
    runEmailSendReconciliationRecoveryMock.mockReset();
    runEmailSendReconciliationRecoveryMock.mockResolvedValue({
      claimed: 0,
      reconciled: 0,
      failed: 0,
      errors: [],
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("fails closed when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "CRON_SECRET not configured",
    });
    expect(getServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("rejects invalid authorization before creating a service client", async () => {
    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Unauthorized",
    });
    expect(getServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("runs the database-only recovery worker in service-role context", async () => {
    runEmailSendReconciliationRecoveryMock.mockResolvedValue({
      claimed: 2,
      reconciled: 2,
      failed: 0,
      errors: [],
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      claimed: 2,
      reconciled: 2,
      failed: 0,
      errors: [],
    });
    expect(runWithSupabaseMock).toHaveBeenCalledWith(
      serviceRoleClient,
      expect.any(Function)
    );
    expect(runWithCronWorkloadControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: serviceRoleClient,
        workloadKey: "send-reconciliation",
        leaseSeconds: 240,
        work: expect.any(Function),
      })
    );
    expect(runEmailSendReconciliationRecoveryMock).toHaveBeenCalledWith(
      serviceRoleClient,
      { limit: 5, failureCooldownSeconds: 60, leaseSeconds: 180 }
    );
  });

  it("opens the circuit when reconciliation reports database pressure", async () => {
    runEmailSendReconciliationRecoveryMock.mockResolvedValue({
      claimed: 1,
      reconciled: 0,
      failed: 1,
      errors: ["intent-1: PGRST002 schema cache unavailable"],
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
  });

  it("launches no reconciliation work while another heavy workload holds the lease", async () => {
    runWithCronWorkloadControlMock.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(runEmailSendReconciliationRecoveryMock).not.toHaveBeenCalled();
  });

  it("contains no provider-send execution path", () => {
    const source = [
      "src/app/api/cron/email-send-reconciliation/route.ts",
      "src/lib/api/services/email-send-reconciliation-recovery-service.ts",
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toContain("EmailSendDeliveryService");
    expect(source).not.toMatch(/\.sendEmail\s*\(/);
  });

  it("uses its isolated offset without changing the Phase C dark-launch cron", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")
    ) as { crons: Array<{ path: string; schedule: string }> };

    expect(config.crons).toContainEqual({
      path: "/api/cron/email-send-reconciliation",
      schedule: "8-59/20 * * * *",
    });
    expect(config.crons).toContainEqual({
      path: "/api/cron/auto-send",
      schedule: "16-59/20 13-23,0-4 * * *",
    });
  });
});
