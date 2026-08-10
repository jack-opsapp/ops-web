import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

import {
  acquireEmailConnectionSyncLock,
  completeGmailImportJobUnderSyncLock,
  persistEmailConnectionRecoveryCheckpoint,
  persistEmailConnectionSyncCheckpoint,
  persistEmailConnectionSyncCompletion,
  releaseEmailConnectionSyncLock,
  renewEmailConnectionSyncLock,
} from "@/lib/api/services/email-connection-sync-lock";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "@/lib/api/services/cron-workload-control-service";

type PressureResponse = ReturnType<
  typeof outer503Response | typeof outerEnotfoundResponse
>;

function outer503Response(status = 503) {
  return {
    data: { private_row: "must-not-enter-the-error-chain" },
    error: {
      code: "",
      details: "",
      hint: "",
      message: status === 504 ? "Gateway Timeout" : "Service Unavailable",
    },
    count: null,
    status,
    statusText: status === 504 ? "Gateway Timeout" : "Service Unavailable",
  };
}

function outerEnotfoundResponse() {
  return {
    data: { private_row: "must-not-enter-the-error-chain" },
    error: {
      code: "",
      details:
        "TypeError: fetch failed\n\nCaused by: Error: getaddrinfo ENOTFOUND example.supabase.co (ENOTFOUND)",
      hint: "",
      message: "TypeError: fetch failed",
    },
    count: null,
    status: 0,
    statusText: "",
  };
}

function clientReturning(response: PressureResponse): SupabaseClient {
  return {
    rpc: vi.fn().mockResolvedValue(response),
  } as unknown as SupabaseClient;
}

function expectPressureEnvelope(
  failure: unknown,
  response: PressureResponse
): void {
  expect(failure).toBeInstanceOf(CronDatabaseOperationError);
  expect(failure).toMatchObject({
    cause: {
      error: response.error,
      status: response.status,
      statusText: response.statusText,
    },
  });
  expect((failure as Error & { cause: object }).cause).not.toHaveProperty(
    "data"
  );
  expect(isDatabasePressureError(failure)).toBe(true);
}

describe("email connection sync lock database pressure", () => {
  it.each([
    {
      boundary: "mailbox lease acquisition",
      run: (client: SupabaseClient) =>
        acquireEmailConnectionSyncLock("connection-1", "recovery", client),
    },
    {
      boundary: "mailbox lease renewal",
      run: (client: SupabaseClient) =>
        renewEmailConnectionSyncLock(
          "connection-1",
          "owner-1",
          "recovery",
          client
        ),
    },
  ])(
    "preserves the realistic ENOTFOUND envelope for $boundary",
    async ({ run }) => {
      const response = outerEnotfoundResponse();

      const failure = await run(clientReturning(response)).catch(
        (error: unknown) => error
      );

      expectPressureEnvelope(failure, response);
    }
  );

  it.each([
    {
      boundary: "recovery checkpoint",
      run: (client: SupabaseClient) =>
        persistEmailConnectionRecoveryCheckpoint({
          connectionId: "connection-1",
          ownerId: "owner-1",
          anchor: new Date("2026-08-09T18:00:00.000Z"),
          pageToken: "page-1",
          targetToken: "history-2",
          context: "recovery",
          client,
        }),
    },
    {
      boundary: "sync completion",
      run: (client: SupabaseClient) =>
        persistEmailConnectionSyncCompletion({
          connectionId: "connection-1",
          ownerId: "owner-1",
          lastSyncedAt: new Date("2026-08-09T18:00:00.000Z"),
          historyId: "history-2",
          clearRecovery: true,
          context: "recovery",
          client,
        }),
    },
    {
      boundary: "sync checkpoint",
      run: (client: SupabaseClient) =>
        persistEmailConnectionSyncCheckpoint({
          connectionId: "connection-1",
          ownerId: "owner-1",
          historyId: "history-2",
          providerSnapshotComplete: true,
          clearRecovery: false,
          context: "recovery",
          client,
        }),
    },
  ])("preserves the outer 503 envelope for $boundary", async ({ run }) => {
    const response = outer503Response();

    const failure = await run(clientReturning(response)).catch(
      (error: unknown) => error
    );

    expectPressureEnvelope(failure, response);
  });

  it("preserves the second outer response when import completion retry fails", async () => {
    const firstResponse = outer503Response();
    const retryResponse = outer503Response(504);
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(retryResponse);
    const client = { rpc } as unknown as SupabaseClient;

    const failure = await completeGmailImportJobUnderSyncLock({
      connectionId: "connection-1",
      ownerId: "owner-1",
      jobId: "job-1",
      historyId: "history-2",
      processed: 8,
      matched: 5,
      unmatched: 3,
      needsReview: 1,
      clientsCreated: 2,
      leadsCreated: 2,
      completedAt: new Date("2026-08-09T18:00:00.000Z"),
      context: "recovery",
      client,
    }).catch((error: unknown) => error);

    expect(rpc).toHaveBeenCalledTimes(2);
    expectPressureEnvelope(failure, retryResponse);
  });

  it("preserves the outer 503 envelope for strict recovery release", async () => {
    const response = outer503Response();

    const failure = await releaseEmailConnectionSyncLock(
      "connection-1",
      "owner-1",
      "recovery",
      clientReturning(response),
      true
    ).catch((error: unknown) => error);

    expectPressureEnvelope(failure, response);
  });

  it("keeps normal-delivery release fail-soft for a realistic outer 503", async () => {
    const response = outer503Response();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      releaseEmailConnectionSyncLock(
        "connection-1",
        "owner-1",
        "normal-delivery",
        clientReturning(response)
      )
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[normal-delivery] email connection lock release failed (non-fatal):",
      "Service Unavailable"
    );
  });
});
