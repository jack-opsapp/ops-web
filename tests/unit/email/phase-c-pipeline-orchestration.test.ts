import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildWritingProfiles: vi.fn(),
  fetch: vi.fn(),
  jobReadError: null as { message: string } | null,
  jobStatus: "analyzing_threads",
  jobRequestedBy: "user-1",
  jobCompanyId: "company-1",
  jobResult: {
    leads: [{ id: "lead-1" }],
    totalScanned: 12,
  } as Record<string, unknown>,
  jobWriteError: null as { message: string } | null,
  notificationError: null as { message: string } | null,
  notifications: [] as Array<Record<string, unknown>>,
  rpcError: null as { message: string } | null,
  rpcCommitsBeforeError: false,
  rpcCommittedFinalizationIdOverride: null as string | null,
  rpcThrownError: null as Error | null,
  rpcCalls: [] as Array<{ name: string; params: Record<string, unknown> }>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api/services/memory-service", () => ({
  MemoryService: {
    buildWritingProfiles: (...args: unknown[]) =>
      mocks.buildWritingProfiles(...args),
  },
}));

vi.mock("@/lib/utils/app-url", () => ({
  getAppUrl: () => "https://ops.test",
}));

vi.mock("@/lib/notifications/server-notification-service", () => ({
  createTrustedNotifications: (payload: Record<string, unknown>) => {
    mocks.notifications.push(payload);
    return Promise.resolve({
      created: mocks.notificationError ? 0 : 1,
      errors: mocks.notificationError ? 1 : 0,
    });
  },
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  emailPipelineAuthorizationHeaders: () => ({
    authorization: "Bearer internal-secret",
    "content-type": "application/json",
  }),
}));

import {
  acceptPhaseBDispatch,
  acceptPhaseCContinuationDispatch,
  acceptPhaseCDispatch,
  buildPersistStateFn,
  dispatchPhaseBContinuation,
  dispatchPhaseCEntry,
  dispatchPhaseCContinuation,
  finalizePhaseC,
  preparePhaseBDispatch,
  preparePhaseCContinuationDispatch,
  preparePhaseCDispatch,
  skipPhaseCDispatch,
  writePhaseCError,
} from "@/lib/api/services/phase-c-pipeline-helpers";
import type { PhaseCPipelineState } from "@/lib/api/services/memory-service";

function makePipelineState(): PhaseCPipelineState {
  return {
    userId: "user-1",
    ownerEmail: "operator@example.com",
    employeeEmails: [],
    classifiedThreads: [],
    startIndex: 0,
    stats: {
      factsExtracted: 2,
      entitiesCreated: 1,
      edgesCreated: 1,
    },
    emailsByProfileType: {},
    entityResolutionDone: false,
    startedAt: "2026-07-21T00:00:00.000Z",
  } satisfies PhaseCPipelineState;
}

function makeSupabaseDouble() {
  return {
    from(table: string) {
      if (table === "gmail_scan_jobs") {
        return {
          select: (_columns: string) => ({
            eq: (_column: string, _value: string) => ({
              single: async () => ({
                data: mocks.jobReadError
                  ? null
                  : {
                      result: mocks.jobResult,
                      status: mocks.jobStatus,
                      requested_by_user_id: mocks.jobRequestedBy,
                      company_id: mocks.jobCompanyId,
                    },
                error: mocks.jobReadError,
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: async (_column: string, _value: string) => {
              mocks.updates.push(payload);
              if (!mocks.jobWriteError && payload.result) {
                mocks.jobResult = payload.result as Record<string, unknown>;
              }
              return { error: mocks.jobWriteError };
            },
          }),
        };
      }

      if (table === "notifications") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            mocks.notifications.push(payload);
            return { error: mocks.notificationError };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
    rpc: async (name: string, params: Record<string, unknown>) => {
      mocks.rpcCalls.push({ name, params });
      if (mocks.rpcCommitsBeforeError) {
        mocks.jobStatus = "complete";
        mocks.jobResult = params.p_result as Record<string, unknown>;
        if (mocks.rpcCommittedFinalizationIdOverride) {
          mocks.jobResult = {
            ...mocks.jobResult,
            phaseCFinalization: {
              ...(mocks.jobResult.phaseCFinalization as Record<
                string,
                unknown
              >),
              id: mocks.rpcCommittedFinalizationIdOverride,
            },
          };
        }
      }
      if (mocks.rpcThrownError) throw mocks.rpcThrownError;
      return { data: null, error: mocks.rpcError };
    },
  };
}

describe("Phase C pipeline orchestration durability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobReadError = null;
    mocks.jobStatus = "analyzing_threads";
    mocks.jobRequestedBy = "user-1";
    mocks.jobCompanyId = "company-1";
    mocks.jobResult = { leads: [{ id: "lead-1" }], totalScanned: 12 };
    mocks.jobWriteError = null;
    mocks.notificationError = null;
    mocks.notifications.length = 0;
    mocks.rpcError = null;
    mocks.rpcCommitsBeforeError = false;
    mocks.rpcCommittedFinalizationIdOverride = null;
    mocks.rpcThrownError = null;
    mocks.rpcCalls.length = 0;
    mocks.updates.length = 0;
    mocks.buildWritingProfiles.mockResolvedValue(1);
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("rejects when durable Phase C progress cannot be read", async () => {
    mocks.jobReadError = { message: "job read unavailable" };
    const persist = await buildPersistStateFn(
      makeSupabaseDouble() as never,
      "job-1"
    );

    await expect(persist(makePipelineState())).rejects.toThrow(
      "job read unavailable"
    );
    expect(mocks.updates).toHaveLength(0);
  });

  it("rejects when durable Phase C progress cannot be written", async () => {
    mocks.jobWriteError = { message: "job write unavailable" };
    const persist = await buildPersistStateFn(
      makeSupabaseDouble() as never,
      "job-1"
    );

    await expect(persist(makePipelineState())).rejects.toThrow(
      "job write unavailable"
    );
  });

  it("persists an explicit retry state for a Phase C failure", async () => {
    await writePhaseCError(
      makeSupabaseDouble() as never,
      "job-1",
      new Error("continuation unavailable"),
      "continuation"
    );

    expect(mocks.jobResult).toMatchObject({
      phaseCError: {
        message: "continuation unavailable",
        stage: "continuation",
      },
      phaseCRetry: {
        required: true,
        stage: "continuation",
      },
    });
  });

  it("rejects when the Phase C error marker itself cannot be written", async () => {
    mocks.jobWriteError = { message: "error marker unavailable" };

    await expect(
      writePhaseCError(
        makeSupabaseDouble() as never,
        "job-1",
        new Error("continuation unavailable"),
        "continuation"
      )
    ).rejects.toThrow("error marker unavailable");
  });

  it("durably prepares and accepts one exact Phase C dispatch", async () => {
    const supabase = makeSupabaseDouble() as never;

    await preparePhaseCDispatch(supabase, "job-1", "dispatch-1");
    expect(mocks.jobResult).toMatchObject({
      phaseCDispatch: { id: "dispatch-1", status: "pending" },
    });

    await acceptPhaseCDispatch(supabase, "job-1", "dispatch-1");
    expect(mocks.jobResult).toMatchObject({
      phaseCDispatch: { id: "dispatch-1", status: "accepted" },
    });
  });

  it("durably prepares and accepts one exact Phase B dispatch", async () => {
    const supabase = makeSupabaseDouble() as never;

    await preparePhaseBDispatch(supabase, "job-1", "dispatch-b-1");
    expect(mocks.jobResult).toMatchObject({
      phaseBDispatch: { id: "dispatch-b-1", status: "pending" },
    });

    await acceptPhaseBDispatch(supabase, "job-1", "dispatch-b-1");
    expect(mocks.jobResult).toMatchObject({
      phaseBDispatch: { id: "dispatch-b-1", status: "accepted" },
    });
  });

  it("confirms a response-lost Phase B handoff from its durable acceptance marker", async () => {
    mocks.jobResult = {
      phaseBDispatch: { id: "dispatch-b-1", status: "accepted" },
    };
    mocks.fetch.mockRejectedValue(new Error("response lost"));

    await expect(
      dispatchPhaseBContinuation({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        connectionId: "connection-1",
        companyId: "company-1",
        dispatchId: "dispatch-b-1",
      })
    ).resolves.toBeUndefined();

    const request = JSON.parse(
      String(mocks.fetch.mock.calls[0]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(request).toEqual({
      jobId: "job-1",
      connectionId: "connection-1",
      companyId: "company-1",
      dispatchId: "dispatch-b-1",
    });
    expect(request).not.toHaveProperty("lockOwner");
  });

  it("rejects acceptance for a stale or spoofed Phase C dispatch", async () => {
    mocks.jobResult = {
      phaseCDispatch: { id: "dispatch-current", status: "pending" },
    };

    await expect(
      acceptPhaseCDispatch(
        makeSupabaseDouble() as never,
        "job-1",
        "dispatch-stale"
      )
    ).rejects.toThrow("does not match");
  });

  it("confirms a response-lost Phase C entry from its durable acceptance marker", async () => {
    mocks.jobResult = {
      phaseCDispatch: { id: "dispatch-1", status: "accepted" },
    };
    mocks.fetch.mockRejectedValue(new Error("response lost"));

    await expect(
      dispatchPhaseCEntry({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        connectionId: "connection-1",
        companyId: "company-1",
        dispatchId: "dispatch-1",
      })
    ).resolves.toBe("accepted");

    const request = JSON.parse(
      String(mocks.fetch.mock.calls[0]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(request).not.toHaveProperty("lockOwner");
  });

  it("confirms a response-lost feature-gate skip from its durable dispatch marker", async () => {
    mocks.jobResult = {
      phaseCDispatch: { id: "dispatch-1", status: "pending" },
    };
    await skipPhaseCDispatch(
      makeSupabaseDouble() as never,
      "job-1",
      "dispatch-1"
    );
    mocks.fetch.mockRejectedValue(new Error("response lost"));

    await expect(
      dispatchPhaseCEntry({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        connectionId: "connection-1",
        companyId: "company-1",
        dispatchId: "dispatch-1",
      })
    ).resolves.toBe("skipped");
  });

  it("durably prepares and accepts one exact Phase C continuation", async () => {
    const supabase = makeSupabaseDouble() as never;

    await preparePhaseCContinuationDispatch(supabase, "job-1", "dispatch-c-2");
    await acceptPhaseCContinuationDispatch(supabase, "job-1", "dispatch-c-2");

    expect(mocks.jobResult).toMatchObject({
      phaseCContinuationDispatch: {
        id: "dispatch-c-2",
        status: "accepted",
      },
    });
  });

  it("awaits continuation acceptance instead of abandoning an in-flight fetch", async () => {
    let resolveFetch: ((response: Response) => void) | null = null;
    mocks.fetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    mocks.jobResult = {
      phaseCContinuationDispatch: {
        id: "dispatch-c-2",
        status: "pending",
      },
    };
    const dispatch = dispatchPhaseCContinuation({
      supabase: makeSupabaseDouble() as never,
      jobId: "job-1",
      connectionId: "connection-1",
      companyId: "company-1",
      dispatchId: "dispatch-c-2",
    });
    expect(dispatch).toBeInstanceOf(Promise);

    let settled = false;
    void dispatch.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveFetch!(Response.json({ ok: true, accepted: true }));
    await expect(dispatch).resolves.toBeUndefined();
  });

  it("rejects a continuation handoff that was not accepted", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ error: "handoff unavailable" }, { status: 503 })
    );

    await expect(
      dispatchPhaseCContinuation({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        connectionId: "connection-1",
        companyId: "company-1",
        dispatchId: "dispatch-c-2",
      })
    ).rejects.toThrow("503");
  });

  it("confirms a response-lost continuation from its durable acceptance marker", async () => {
    mocks.jobResult = {
      phaseCContinuationDispatch: {
        id: "dispatch-c-2",
        status: "accepted",
      },
    };
    mocks.fetch.mockRejectedValue(new Error("response lost"));

    await expect(
      dispatchPhaseCContinuation({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        connectionId: "connection-1",
        companyId: "company-1",
        dispatchId: "dispatch-c-2",
      })
    ).resolves.toBeUndefined();
  });

  it("does not publish or notify completion when the durable completion RPC fails", async () => {
    mocks.rpcError = { message: "completion unavailable" };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      finalizePhaseC({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        companyId: "company-1",
        userId: "user-1",
        state: makePipelineState(),
        priorResult: mocks.jobResult,
      })
    ).rejects.toThrow("completion unavailable");

    expect(mocks.notifications).toHaveLength(0);
    expect(log.mock.calls.flat().join(" ")).not.toContain("[phase-c] Complete");
  });

  it("does not publish an exact-complete marker when writing-profile finalization fails", async () => {
    mocks.buildWritingProfiles.mockRejectedValue(
      new Error("profile storage unavailable")
    );

    await expect(
      finalizePhaseC({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        companyId: "company-1",
        userId: "user-1",
        state: makePipelineState(),
        priorResult: mocks.jobResult,
      })
    ).rejects.toThrow("profile storage unavailable");

    expect(mocks.rpcCalls).toHaveLength(0);
    expect(mocks.jobResult).not.toHaveProperty("phaseCComplete");
    expect(mocks.jobResult).not.toHaveProperty("phaseCFinalization");
    expect(mocks.notifications).toHaveLength(0);
  });

  it("reconciles an exact post-commit response loss as successful completion", async () => {
    mocks.rpcError = { message: "completion response lost" };
    mocks.rpcCommitsBeforeError = true;

    await expect(
      finalizePhaseC({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        companyId: "company-1",
        userId: "user-1",
        state: makePipelineState(),
        priorResult: mocks.jobResult,
      })
    ).resolves.toBeUndefined();

    expect(mocks.buildWritingProfiles).toHaveBeenCalledTimes(1);
    expect(mocks.notifications).toHaveLength(1);
    expect(mocks.jobResult).toMatchObject({
      phaseCComplete: true,
      phaseCFinalization: {
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        actorUserId: "user-1",
        companyId: "company-1",
        jobId: "job-1",
      },
    });
  });

  it("reconciles a thrown post-commit transport loss without repeating completion", async () => {
    mocks.rpcCommitsBeforeError = true;
    mocks.rpcThrownError = new Error("completion transport dropped");

    await expect(
      finalizePhaseC({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        companyId: "company-1",
        userId: "user-1",
        state: makePipelineState(),
        priorResult: mocks.jobResult,
      })
    ).resolves.toBeUndefined();

    expect(mocks.rpcCalls).toHaveLength(1);
    expect(mocks.buildWritingProfiles).toHaveBeenCalledTimes(1);
    expect(mocks.notifications).toHaveLength(1);
  });

  it("fails closed when post-error completion readback has the wrong actor fence", async () => {
    mocks.rpcError = { message: "completion response lost" };
    mocks.rpcCommitsBeforeError = true;
    mocks.jobRequestedBy = "different-user";

    await expect(
      finalizePhaseC({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        companyId: "company-1",
        userId: "user-1",
        state: makePipelineState(),
        priorResult: mocks.jobResult,
      })
    ).rejects.toThrow("completion response lost");

    expect(mocks.notifications).toHaveLength(0);
  });

  it("fails closed when post-error completion readback has a different finalization digest", async () => {
    mocks.rpcError = { message: "completion response lost" };
    mocks.rpcCommitsBeforeError = true;
    mocks.rpcCommittedFinalizationIdOverride = "b".repeat(64);

    await expect(
      finalizePhaseC({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        companyId: "company-1",
        userId: "user-1",
        state: makePipelineState(),
        priorResult: mocks.jobResult,
      })
    ).rejects.toThrow("completion response lost");

    expect(mocks.notifications).toHaveLength(0);
  });

  it("keeps durable completion successful when the idempotent notification fails", async () => {
    mocks.notificationError = { message: "notification unavailable" };
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      finalizePhaseC({
        supabase: makeSupabaseDouble() as never,
        jobId: "job-1",
        companyId: "company-1",
        userId: "user-1",
        state: makePipelineState(),
        priorResult: mocks.jobResult,
      })
    ).resolves.toBeUndefined();

    expect(mocks.rpcCalls).toHaveLength(1);
    expect(mocks.notifications).toHaveLength(1);
    expect(error.mock.calls.flat().join(" ")).toContain(
      "notification could not be created"
    );
  });
});
