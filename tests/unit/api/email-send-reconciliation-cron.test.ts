import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getServiceRoleClientMock,
  runEmailSendReconciliationRecoveryMock,
  runWithSupabaseMock,
  serviceRoleClient,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  runEmailSendReconciliationRecoveryMock: vi.fn(),
  runWithSupabaseMock: vi.fn(),
  serviceRoleClient: { kind: "service-role-client" },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: runWithSupabaseMock,
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
    expect(runEmailSendReconciliationRecoveryMock).toHaveBeenCalledWith(
      serviceRoleClient,
      { limit: 25, failureCooldownSeconds: 60, leaseSeconds: 300 }
    );
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

  it("is scheduled every five minutes without changing the Phase C dark-launch cron", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")
    ) as { crons: Array<{ path: string; schedule: string }> };

    expect(config.crons).toContainEqual({
      path: "/api/cron/email-send-reconciliation",
      schedule: "*/5 * * * *",
    });
    expect(config.crons).toContainEqual({
      path: "/api/cron/auto-send",
      schedule: "*/5 13-23,0-4 * * *",
    });
  });
});
