import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  acceptDispatch: vi.fn(),
  acceptContinuationDispatch: vi.fn(),
  acceptPhaseBDispatch: vi.fn(),
  acquireMailbox: vi.fn(),
  acquireMailboxByAdoption: vi.fn(),
  acquirePhaseCLock: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
  afterError: null as Error | null,
  authorize: vi.fn(),
  client: null as unknown,
  dispatchContinuation: vi.fn(),
  dispatchEntry: vi.fn(),
  enabled: true,
  jobReadError: null as { message: string } | null,
  jobResult: null as Record<string, unknown> | null,
  getConnection: vi.fn(),
  finalize: vi.fn(),
  runChunks: vi.fn(),
  jobStatus: "building_leads",
  jobRequestedBy: "user-1",
  releaseMailbox: vi.fn(),
  releasePhaseCLock: vi.fn(),
  renew: vi.fn(),
  skipDispatch: vi.fn(),
  stopRenew: vi.fn(),
  writeError: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => Promise<void>) => {
      if (mocks.afterError) throw mocks.afterError;
      mocks.afterCallbacks.push(callback);
    },
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.client,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: (_client: unknown, callback: () => Promise<unknown>) =>
    callback(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailPipelineSecret: () => null,
}));

vi.mock("@/lib/email/email-analysis-job-access", () => ({
  authorizeEmailAnalysisJobContinuation: (...args: unknown[]) =>
    mocks.authorize(...args),
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: () => Promise.resolve(mocks.enabled),
  },
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  acquireEmailConnectionSyncLock: (...args: unknown[]) =>
    mocks.acquireMailbox(...args),
  acquireOrAdoptEmailConnectionSyncLock: (...args: unknown[]) =>
    mocks.acquireMailboxByAdoption(...args),
  createEmailConnectionSyncLockRenewer: () =>
    Object.assign((...args: unknown[]) => mocks.renew(...args), {
      stop: (...args: unknown[]) => mocks.stopRenew(...args),
    }),
  releaseEmailConnectionSyncLock: (...args: unknown[]) =>
    mocks.releaseMailbox(...args),
}));

vi.mock("@/lib/api/services/phase-c-pipeline-helpers", () => ({
  acceptPhaseBDispatch: (...args: unknown[]) =>
    mocks.acceptPhaseBDispatch(...args),
  acceptPhaseCContinuationDispatch: (...args: unknown[]) =>
    mocks.acceptContinuationDispatch(...args),
  acceptPhaseCDispatch: (...args: unknown[]) => mocks.acceptDispatch(...args),
  acquirePhaseCLock: (...args: unknown[]) => mocks.acquirePhaseCLock(...args),
  buildPersistStateFn: vi.fn(),
  dispatchPhaseCContinuation: (...args: unknown[]) =>
    mocks.dispatchContinuation(...args),
  dispatchPhaseCEntry: (...args: unknown[]) => mocks.dispatchEntry(...args),
  finalizePhaseC: (...args: unknown[]) => mocks.finalize(...args),
  isExactDurablePhaseCCompletion: ({
    status,
    result,
    requestedByUserId,
    rowCompanyId,
    jobId,
    companyId,
    actorUserId,
  }: {
    status: unknown;
    result: Record<string, unknown> | null | undefined;
    requestedByUserId: unknown;
    rowCompanyId: unknown;
    jobId: string;
    companyId: string;
    actorUserId: string;
  }) => {
    const proof = result?.phaseCFinalization as
      | Record<string, unknown>
      | undefined;
    const retry = result?.phaseCRetry as Record<string, unknown> | undefined;
    return (
      status === "complete" &&
      result?.phaseCComplete === true &&
      requestedByUserId === actorUserId &&
      rowCompanyId === companyId &&
      proof?.version === 1 &&
      proof?.jobId === jobId &&
      proof?.companyId === companyId &&
      proof?.actorUserId === actorUserId &&
      typeof proof?.id === "string" &&
      /^[a-f0-9]{64}$/.test(proof.id) &&
      retry?.required === false
    );
  },
  preparePhaseCContinuationDispatch: vi.fn(),
  preparePhaseCDispatch: vi.fn(),
  releasePhaseCLock: (...args: unknown[]) => mocks.releasePhaseCLock(...args),
  skipPhaseCDispatch: (...args: unknown[]) => mocks.skipDispatch(...args),
  writePhaseCError: (...args: unknown[]) => mocks.writeError(...args),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: (...args: unknown[]) => mocks.getConnection(...args),
  },
}));

vi.mock("@/lib/api/services/email-ai-classifier", () => ({
  EmailAIClassifier: { deepExtractLeads: vi.fn() },
  stripQuotedContent: (value: string) => value,
}));

vi.mock("@/lib/notifications/server-notification-service", () => ({
  createTrustedNotifications: vi.fn(),
}));

vi.mock("@/lib/api/services/memory-service", () => ({
  MemoryService: {
    runPhaseCChunks: (...args: unknown[]) => mocks.runChunks(...args),
  },
  SKIP_CLASSIFICATION_KEYWORDS: {
    vendor: [],
    subtrade: [],
    internal: [],
    spam: [],
  },
}));

import { POST as entryPOST } from "@/app/api/integrations/email/analyze-memory/route";
import { POST as continuationPOST } from "@/app/api/integrations/email/analyze-memory-continue/route";
import { POST as phaseBPOST } from "@/app/api/integrations/email/analyze-continue/route";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";

function request(path: string, dispatchId?: string): NextRequest {
  return new NextRequest(`https://ops.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobId: "job-1",
      connectionId: "connection-1",
      companyId: COMPANY_ID,
      ...(dispatchId ? { dispatchId } : {}),
    }),
  });
}

function makeClient() {
  return {
    from(table: string) {
      if (table !== "gmail_scan_jobs") {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        select: (_columns: string) => ({
          eq: (_column: string, _value: string) => ({
            single: async () => ({
              data: mocks.jobReadError
                ? null
                : mocks.jobResult === null
                  ? null
                  : {
                      id: "job-1",
                      result: mocks.jobResult,
                      status: mocks.jobStatus,
                      requested_by_user_id: mocks.jobRequestedBy,
                      connection_id: "connection-1",
                      company_id: COMPANY_ID,
                    },
              error: mocks.jobReadError,
            }),
          }),
        }),
      };
    },
  };
}

describe("Phase C route orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
    mocks.afterError = null;
    mocks.enabled = true;
    mocks.jobReadError = null;
    mocks.jobStatus = "building_leads";
    mocks.jobRequestedBy = "user-1";
    mocks.jobResult = null;
    mocks.client = makeClient();
    mocks.authorize.mockResolvedValue({
      allowed: true,
      actorUserId: "user-1",
      companyId: COMPANY_ID,
      connectionId: "connection-1",
      connectionType: "company",
    });
    mocks.acquireMailbox.mockResolvedValue("fresh-owner-1");
    mocks.acquireMailboxByAdoption.mockResolvedValue("old-owner-1");
    mocks.acquirePhaseCLock.mockResolvedValue("phase-c-holder-1");
    mocks.acceptDispatch.mockResolvedValue(undefined);
    mocks.acceptContinuationDispatch.mockResolvedValue(undefined);
    mocks.acceptPhaseBDispatch.mockResolvedValue(undefined);
    mocks.dispatchContinuation.mockResolvedValue(undefined);
    mocks.dispatchEntry.mockResolvedValue("accepted");
    mocks.getConnection.mockResolvedValue({
      id: "connection-1",
      companyId: COMPANY_ID,
    });
    mocks.releaseMailbox.mockResolvedValue(undefined);
    mocks.releasePhaseCLock.mockResolvedValue(undefined);
    mocks.renew.mockResolvedValue(undefined);
    mocks.stopRenew.mockResolvedValue(undefined);
    mocks.skipDispatch.mockResolvedValue(undefined);
    mocks.writeError.mockResolvedValue(undefined);
  });

  function completedPhaseCResult(): Record<string, unknown> {
    return {
      phaseCComplete: true,
      phaseCFinalization: {
        version: 1,
        id: "a".repeat(64),
        actorUserId: "user-1",
        companyId: COMPANY_ID,
        jobId: "job-1",
      },
      phaseCRetry: {
        required: false,
      },
    };
  }

  it("returns a durable error when continuation after() registration fails", async () => {
    mocks.afterError = new Error("after unavailable");

    const response = await continuationPOST(
      request("/api/integrations/email/analyze-memory-continue", "dispatch-c-2")
    );

    expect(response.status).toBe(500);
    expect(mocks.writeError).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({ message: "after unavailable" }),
      "continuation_handoff"
    );
  });

  it("marks a missing continuation pipeline state as a durable retry", async () => {
    const response = await continuationPOST(
      request("/api/integrations/email/analyze-memory-continue", "dispatch-c-2")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true });
    expect(mocks.acceptContinuationDispatch).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      "dispatch-c-2"
    );

    await mocks.afterCallbacks[0]();

    expect(mocks.writeError).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({
        message: expect.stringContaining("no result"),
      }),
      "continuation"
    );
  });

  it("claims a fresh mailbox owner and durably accepts the exact entry dispatch", async () => {
    const response = await entryPOST(
      request("/api/integrations/email/analyze-memory", "dispatch-1")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true });
    expect(mocks.acquireMailbox).toHaveBeenCalledWith(
      "connection-1",
      "email-analyze-phase-c-entry",
      expect.anything()
    );
    expect(mocks.acquireMailboxByAdoption).not.toHaveBeenCalled();
    expect(mocks.acceptDispatch).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      "dispatch-1"
    );
  });

  it("durably records a feature-gate skip before returning it", async () => {
    mocks.enabled = false;

    const response = await entryPOST(
      request("/api/integrations/email/analyze-memory", "dispatch-1")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: true });
    expect(mocks.skipDispatch).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      "dispatch-1"
    );
    expect(mocks.acquireMailbox).not.toHaveBeenCalled();
  });

  it("claims a fresh Phase B owner and durably accepts the exact Phase A dispatch", async () => {
    mocks.jobResult = {
      phase: "leads_built",
      detection: {},
      leads: [],
      ownerEmail: "operator@example.com",
      discoveredLeadNames: [],
      phaseBDispatch: { id: "dispatch-b-1", status: "pending" },
    };

    const response = await phaseBPOST(
      request("/api/integrations/email/analyze-continue", "dispatch-b-1")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true });
    expect(mocks.acquireMailbox).toHaveBeenCalledWith(
      "connection-1",
      "email-analyze-phase-b",
      expect.anything()
    );
    expect(mocks.acquireMailboxByAdoption).not.toHaveBeenCalled();
    expect(mocks.acceptPhaseBDispatch).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      "dispatch-b-1"
    );
  });

  it("marks missing Phase C entry input as a durable retry", async () => {
    const response = await entryPOST(
      request("/api/integrations/email/analyze-memory", "dispatch-1")
    );
    expect(response.status).toBe(200);

    await mocks.afterCallbacks[0]();

    expect(mocks.writeError).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({
        message: expect.stringContaining("result"),
      }),
      "entry"
    );
  });

  it("skips an already-complete entry before connection, LLM, or profile work", async () => {
    mocks.jobStatus = "complete";
    mocks.jobResult = completedPhaseCResult();

    const response = await entryPOST(
      request("/api/integrations/email/analyze-memory", "dispatch-1")
    );
    expect(response.status).toBe(200);
    await mocks.afterCallbacks[0]();

    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.runChunks).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.writeError).not.toHaveBeenCalled();
  });

  it("skips an already-complete continuation before LLM or profile work", async () => {
    mocks.jobStatus = "complete";
    mocks.jobResult = completedPhaseCResult();

    const response = await continuationPOST(
      request("/api/integrations/email/analyze-memory-continue", "dispatch-c-2")
    );
    expect(response.status).toBe(200);
    await mocks.afterCallbacks[0]();

    expect(mocks.runChunks).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.writeError).not.toHaveBeenCalled();
  });

  it("does not trust a Phase C result marker without durable complete status", async () => {
    mocks.jobStatus = "analyzing_threads";
    mocks.jobResult = completedPhaseCResult();

    const response = await entryPOST(
      request("/api/integrations/email/analyze-memory", "dispatch-1")
    );
    expect(response.status).toBe(200);
    await mocks.afterCallbacks[0]();

    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.runChunks).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.writeError).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({
        message: expect.stringContaining("completion state is inconsistent"),
      }),
      "entry"
    );
  });

  it("marks writing-profile finalization failure for durable Phase C retry", async () => {
    const state = {
      userId: "user-1",
      ownerEmail: "operator@example.com",
      employeeEmails: [],
      classifiedThreads: [],
      startIndex: 0,
      stats: { factsExtracted: 0, entitiesCreated: 0, edgesCreated: 0 },
      emailsByProfileType: {},
      entityResolutionDone: true,
      startedAt: "2026-07-21T00:00:00.000Z",
    };
    mocks.jobStatus = "analyzing_threads";
    mocks.jobResult = { phaseCPipeline: state };
    mocks.runChunks.mockResolvedValue({ done: true, state });
    mocks.finalize.mockRejectedValue(new Error("profile storage unavailable"));

    const response = await continuationPOST(
      request("/api/integrations/email/analyze-memory-continue", "dispatch-c-2")
    );
    expect(response.status).toBe(200);
    await mocks.afterCallbacks[0]();

    expect(mocks.writeError).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({ message: "profile storage unavailable" }),
      "continuation"
    );
  });
});
