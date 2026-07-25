import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RpcResponse = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

const rpcCalls: Array<{
  functionName: string;
  args: Record<string, unknown>;
}> = [];
const rpcResponses = new Map<string, RpcResponse>();
let skippedWorkload: string | null = null;
let lastWorkError: unknown = null;

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    rpc: async (functionName: string, args: Record<string, unknown>) => {
      rpcCalls.push({ functionName, args });
      return (
        rpcResponses.get(functionName) ?? {
          data: 0,
          error: null,
        }
      );
    },
  }),
}));

vi.mock(
  "@/lib/api/services/cron-workload-control-service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/api/services/cron-workload-control-service")
      >();
    return {
      ...actual,
      runWithCronWorkloadControl: async ({
        workloadKey,
        work,
      }: {
        workloadKey: string;
        work: () => Promise<unknown>;
      }) => {
        if (skippedWorkload === workloadKey) {
          return { status: "skipped", reason: "lease_held" };
        }
        try {
          return { status: "completed", value: await work() };
        } catch (error) {
          lastWorkError = error;
          throw error;
        }
      },
    };
  }
);

const CRON_SECRET = "maintenance-expiry-secret";

function request(path: string, authorized = true): NextRequest {
  return new Request(`http://localhost${path}`, {
    headers: authorized
      ? { authorization: `Bearer ${CRON_SECRET}` }
      : undefined,
  }) as unknown as NextRequest;
}

describe("bounded maintenance expiry crons", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    rpcCalls.length = 0;
    rpcResponses.clear();
    skippedWorkload = null;
    lastWorkError = null;
  });

  it("expires at most 500 agent actions through the controlled RPC", async () => {
    rpcResponses.set("expire_agent_actions_batch_as_system", {
      data: 27,
      error: null,
    });
    const { GET } = await import("@/app/api/cron/expire-actions/route");

    const response = await GET(request("/api/cron/expire-actions"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: true,
      expired: 27,
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      functionName: "expire_agent_actions_batch_as_system",
      args: { p_batch_size: 500 },
    });
  });

  it("expires at most 500 grace-period companies through the controlled RPC", async () => {
    rpcResponses.set("expire_grace_period_companies_batch_as_system", {
      data: 8,
      error: null,
    });
    const { GET } =
      await import("@/app/api/cron/expire-grace-periods/route");

    const response = await GET(request("/api/cron/expire-grace-periods"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: true,
      expired: 8,
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      functionName: "expire_grace_period_companies_batch_as_system",
      args: { p_batch_size: 500 },
    });
    expect(
      Date.parse(rpcCalls[0].args.p_cutoff as string)
    ).not.toBeNaN();
  });

  it("skips an overlapping expiry without launching database work", async () => {
    skippedWorkload = "expire-agent-actions";
    const { GET } = await import("@/app/api/cron/expire-actions/route");

    const response = await GET(request("/api/cron/expire-actions"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it("preserves database origin so a 53300 opens the pressure circuit", async () => {
    rpcResponses.set("expire_agent_actions_batch_as_system", {
      data: null,
      error: {
        code: "53300",
        message: "remaining connection slots are reserved",
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/expire-actions/route");

    const response = await GET(request("/api/cron/expire-actions"));

    expect(response.status).toBe(500);
    const { CronDatabaseOperationError, isDatabasePressureError } =
      await import("@/lib/api/services/cron-workload-control-service");
    expect(lastWorkError).toBeInstanceOf(CronDatabaseOperationError);
    expect(isDatabasePressureError(lastWorkError)).toBe(true);
    errorSpy.mockRestore();
  });

  it("rejects unauthorized requests before acquiring a workload lease", async () => {
    const { GET } = await import("@/app/api/cron/expire-actions/route");

    const response = await GET(
      request("/api/cron/expire-actions", false)
    );

    expect(response.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });
});
