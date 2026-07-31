import { beforeEach, describe, expect, it } from "vitest";

import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
  type CronWorkloadCursorClient,
} from "@/lib/api/services/cron-workload-cursor-service";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "@/lib/api/services/cron-workload-control-service";

type RpcResponse = { data: unknown; error: unknown };

class FakeCursorClient implements CronWorkloadCursorClient {
  responses: RpcResponse[] = [];
  calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];

  async rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<RpcResponse> {
    this.calls.push({ functionName, args });
    return this.responses.shift() ?? { data: null, error: null };
  }
}

const lease = {
  ownerToken: "00000000-0000-4000-8000-000000000024",
  fenceToken: 7,
  globalFenceToken: 11,
  expiresAt: "2026-07-24T23:59:59.000Z",
  signal: new AbortController().signal,
};

describe("cron workload cursor service", () => {
  let client: FakeCursorClient;

  beforeEach(() => {
    client = new FakeCursorClient();
  });

  it("reads a nullable durable cursor", async () => {
    client.responses.push({ data: "company-7", error: null });

    await expect(
      readCronWorkloadCursor(client, "company-sweep", lease)
    ).resolves.toBe("company-7");
    expect(client.calls).toEqual([
      {
        functionName: "read_cron_workload_cursor_as_system",
        args: {
          p_workload_key: "company-sweep",
          p_owner_token: lease.ownerToken,
          p_fence_token: lease.fenceToken,
          p_global_fence_token: lease.globalFenceToken,
        },
      },
    ]);
  });

  it("advances with an exact compare-and-swap", async () => {
    client.responses.push({ data: true, error: null });

    await advanceCronWorkloadCursor(
      client,
      "company-sweep",
      lease,
      "company-7",
      "company-12"
    );

    expect(client.calls[0]).toEqual({
      functionName: "advance_cron_workload_cursor_as_system",
      args: {
        p_workload_key: "company-sweep",
        p_owner_token: lease.ownerToken,
        p_fence_token: lease.fenceToken,
        p_global_fence_token: lease.globalFenceToken,
        p_expected_cursor: "company-7",
        p_next_cursor: "company-12",
      },
    });
  });

  it("preserves database pressure origin from cursor RPCs", async () => {
    client.responses.push({
      data: null,
      error: {
        code: "53300",
        message: "remaining connection slots are reserved",
      },
    });

    const error = await readCronWorkloadCursor(
      client,
      "company-sweep",
      lease
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(CronDatabaseOperationError);
    expect(isDatabasePressureError(error)).toBe(true);
  });

  it("preserves a thrown transport failure as the database cause", async () => {
    const transportFailure = Object.assign(new Error("connect timeout"), {
      code: "ETIMEDOUT",
    });
    const throwingClient: CronWorkloadCursorClient = {
      rpc: async () => {
        throw transportFailure;
      },
    };

    const error = await readCronWorkloadCursor(
      throwingClient,
      "company-sweep",
      lease
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(CronDatabaseOperationError);
    expect((error as Error & { cause?: unknown }).cause).toBe(
      transportFailure
    );
    expect(isDatabasePressureError(error)).toBe(true);
  });

  it("fails closed when the cursor compare-and-swap is lost", async () => {
    client.responses.push({ data: false, error: null });

    await expect(
      advanceCronWorkloadCursor(
        client,
        "company-sweep",
        lease,
        null,
        "first"
      )
    ).rejects.toBeInstanceOf(CronDatabaseOperationError);
  });
});
