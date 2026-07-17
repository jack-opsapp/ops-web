import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const {
  processBatch,
  processProjectLifecycle,
  processTaskAutomation,
  processConversionNotifications,
  getServiceRoleClient,
  client,
} = vi.hoisted(() => ({
  processBatch: vi.fn(),
  processProjectLifecycle: vi.fn(),
  processTaskAutomation: vi.fn(),
  processConversionNotifications: vi.fn(),
  getServiceRoleClient: vi.fn(),
  client: { rpc: vi.fn() },
}));

vi.mock("@/lib/api/services/lead-assignment-delivery-service", () => ({
  LeadAssignmentDeliveryService: { processBatch },
}));
vi.mock("@/lib/api/services/project-status-lifecycle-outbox-service", () => ({
  ProjectStatusLifecycleOutboxService: {
    processBatch: processProjectLifecycle,
  },
}));
vi.mock("@/lib/api/services/task-mutation-automation-outbox-service", () => ({
  TaskMutationAutomationOutboxService: {
    processBatch: processTaskAutomation,
  },
}));
vi.mock(
  "@/lib/api/services/opportunity-conversion-notification-delivery-service",
  () => ({
    OpportunityConversionNotificationDeliveryService: {
      processBatch: processConversionNotifications,
    },
  })
);

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient,
}));

import { GET } from "@/app/api/cron/lead-assignment-deliveries/route";

const successResult = {
  claimed: 2,
  consumed: 1,
  delivered: 1,
  pushed: 1,
  pushSuppressed: 0,
  requeued: 0,
  terminalFailed: 0,
  errors: [],
};
const projectLifecycleResult = {
  claimed: 1,
  completed: 1,
  requeued: 0,
  failed: 0,
  terminalFailed: 0,
  errors: [],
};
const taskAutomationResult = {
  claimed: 1,
  completed: 1,
  superseded: 0,
  skipped: 0,
  requeued: 0,
  failed: 0,
  terminalFailed: 0,
  errors: [],
};
const conversionNotificationResult = {
  claimed: 1,
  consumed: 0,
  delivered: 1,
  pushed: 1,
  pushSuppressed: 0,
  requeued: 0,
  terminalFailed: 0,
  errors: [],
};

function request(token?: string): NextRequest {
  return new NextRequest(
    "https://ops.test/api/cron/lead-assignment-deliveries",
    {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }
  );
}

describe("lead assignment deliveries cron", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    getServiceRoleClient.mockReset();
    getServiceRoleClient.mockReturnValue(client);
    processBatch.mockReset();
    processBatch.mockResolvedValue(successResult);
    processProjectLifecycle.mockReset();
    processProjectLifecycle.mockResolvedValue(projectLifecycleResult);
    processTaskAutomation.mockReset();
    processTaskAutomation.mockResolvedValue(taskAutomationResult);
    processConversionNotifications.mockReset();
    processConversionNotifications.mockResolvedValue(
      conversionNotificationResult
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when CRON_SECRET is absent", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "CRON_SECRET not configured",
    });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects a missing or incorrect bearer token", async () => {
    for (const candidate of [request(), request("wrong")]) {
      const response = await GET(candidate);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        ok: false,
        error: "Unauthorized",
      });
    }
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("runs the service-role worker and reports a successful batch", async () => {
    const response = await GET(request("cron-secret"));

    expect(getServiceRoleClient).toHaveBeenCalledOnce();
    expect(processBatch).toHaveBeenCalledWith(client, {
      limit: 50,
      leaseSeconds: 360,
    });
    expect(processProjectLifecycle).toHaveBeenCalledWith(client, {
      limit: 25,
      leaseSeconds: 360,
    });
    expect(processTaskAutomation).toHaveBeenCalledWith(client, {
      limit: 25,
      leaseSeconds: 360,
    });
    expect(processConversionNotifications).toHaveBeenCalledWith(client, {
      limit: 25,
      leaseSeconds: 360,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ...successResult,
      projectLifecycle: projectLifecycleResult,
      taskAutomation: taskAutomationResult,
      conversionNotifications: conversionNotificationResult,
    });
  });

  it("returns 503 when any claimed delivery was requeued or terminalized", async () => {
    processBatch.mockResolvedValue({
      ...successResult,
      delivered: 0,
      pushed: 0,
      requeued: 1,
      errors: [{ deliveryId: "delivery-1", message: "provider unavailable" }],
    });

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, requeued: 1 });
  });

  it("returns 503 when task automation terminalizes an exhausted event", async () => {
    processTaskAutomation.mockResolvedValue({
      ...taskAutomationResult,
      terminalFailed: 1,
    });

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      taskAutomation: { terminalFailed: 1 },
    });
  });

  it("returns 503 when conversion notification delivery must retry", async () => {
    processConversionNotifications.mockResolvedValue({
      ...conversionNotificationResult,
      delivered: 0,
      pushed: 0,
      requeued: 1,
      errors: [
        {
          deliveryId: "conversion-delivery-1",
          message: "provider unavailable",
        },
      ],
    });

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      conversionNotifications: { requeued: 1 },
    });
  });

  it("returns 500 without leaking internals when the worker throws", async () => {
    processBatch.mockRejectedValue(new Error("claim denied"));

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "claim denied" });
  });

  it("runs every minute so responsibility handoffs reach the assignee promptly", () => {
    const config = JSON.parse(
      readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")
    ) as { crons: Array<{ path: string; schedule: string }> };

    expect(config.crons).toContainEqual({
      path: "/api/cron/lead-assignment-deliveries",
      schedule: "* * * * *",
    });
  });
});
