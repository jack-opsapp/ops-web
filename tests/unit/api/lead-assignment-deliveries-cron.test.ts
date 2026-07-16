import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const { processBatch, getServiceRoleClient, client } = vi.hoisted(() => ({
  processBatch: vi.fn(),
  getServiceRoleClient: vi.fn(),
  client: { rpc: vi.fn() },
}));

vi.mock("@/lib/api/services/lead-assignment-delivery-service", () => ({
  LeadAssignmentDeliveryService: { processBatch },
}));

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
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ...successResult });
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
