import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { featureEnabled, isResolvedActor, createRuntime } = vi.hoisted(() => ({
  featureEnabled: vi.fn(),
  isResolvedActor: vi.fn(),
  createRuntime: vi.fn(),
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: { isFeatureEnabled: featureEnabled },
}));
vi.mock("@/lib/email/phase-c-email-actor", () => ({
  isResolvedPhaseCEmailActorContext: isResolvedActor,
}));
vi.mock("@/lib/agent-control-plane/adapters/internal-runtime", () => ({
  createInternalPhaseCAdapterRuntime: createRuntime,
}));

import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts";
import { JOB_CONVERSATION_PROMPT_SAFETY_DIRECTIVE } from "@/lib/agent-control-plane/services/get-job-conversation-context";
import { isTrustedOperationalReadCursorCodec } from "@/lib/agent-control-plane/services/operational-read-cursor";
import { runPhaseCReplyContextShadow } from "../phase-c-reply-context-shadow";

const ACTOR = {
  actorUserId: "00000000-0000-4000-8000-000000000001",
  assignmentVersion: 4,
  assignmentEventId: "00000000-0000-4000-8000-000000000002",
  companyId: "00000000-0000-4000-8000-000000000003",
  connectionId: "00000000-0000-4000-8000-000000000004",
  opportunityId: "00000000-0000-4000-8000-000000000005",
  internalThreadId: "00000000-0000-4000-8000-000000000006",
  providerThreadId: "provider-thread-1",
  connectionType: "company" as const,
  actorNameSnapshot: "Operator",
  actorEmailSnapshot: "operator@example.test",
  clientFacingAddressSnapshot: "operator@example.test",
};
const SOURCE_ACTIVITY_ID = "00000000-0000-4000-8000-000000000007";
const TURN_ID = "00000000-0000-4000-8000-000000000008";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000009";
const originalCursorKey = process.env.OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY;

function domainResult() {
  return {
    contract_version: CONTRACT_VERSION,
    request_id: "00000000-0000-4000-8000-00000000000a",
    generated_at: "2026-08-14T18:00:00.000Z",
    company_id: ACTOR.companyId,
    actor: {
      user_id: ACTOR.actorUserId,
      permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
    },
    freshness: {
      read_at: "2026-08-14T18:00:00.000Z",
      source_versions: [],
      stale_after: null,
      memory_version: 2,
      turn_high_watermark_id: TURN_ID,
    },
    evidence: [],
    warnings: [],
    data: {
      conversation_id: CONVERSATION_ID,
      requested_job: { kind: "opportunity", id: ACTOR.opportunityId },
      prompt_safety_directive: JOB_CONVERSATION_PROMPT_SAFETY_DIRECTIVE,
      sections: [
        {
          kind: "memory",
          version: { version_number: 2 },
          memory_document: { facts: [] },
          memory_projection: { excluded_evidence_ids: [] },
        },
        { kind: "recent_turns", turns: [{ turn_id: TURN_ID }] },
        {
          kind: "source_evidence",
          evidence: [{ evidence_id: `job_conversation_turn:${TURN_ID}` }],
        },
        { kind: "participants", participants: [] },
        {
          kind: "cross_job_seed",
          seed: { state: "customer_unresolved" },
        },
        {
          kind: "freshness_and_gaps",
          source_state_revision: 1,
          last_turn_sequence: 1,
          required_through: { turn_id: TURN_ID, state: "summarized" },
          gaps: [],
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY = "a".repeat(64);
  isResolvedActor.mockReturnValue(true);
  featureEnabled.mockResolvedValue(true);
  createRuntime.mockReturnValue({
    getJobConversationContext: vi.fn(async () => domainResult()),
  });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalCursorKey === undefined) {
    delete process.env.OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY;
  } else {
    process.env.OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY = originalCursorKey;
  }
});

describe("Phase C reply context shadow service", () => {
  it("does nothing when the company shadow flag is disabled", async () => {
    featureEnabled.mockResolvedValue(false);

    await expect(
      runPhaseCReplyContextShadow({
        routedActor: ACTOR,
        sourceActivityId: SOURCE_ACTIVITY_ID,
        controlContext: "control",
        rpcClient: { rpc: vi.fn() },
      })
    ).resolves.toBeNull();
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("rejects structural actor input before feature or runtime work", async () => {
    isResolvedActor.mockReturnValue(false);

    await expect(
      runPhaseCReplyContextShadow({
        routedActor: ACTOR,
        sourceActivityId: SOURCE_ACTIVITY_ID,
        controlContext: "control",
        rpcClient: { rpc: vi.fn() },
      })
    ).resolves.toBeNull();
    expect(featureEnabled).not.toHaveBeenCalled();
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("runs the real v6 observer through one read-only runtime", async () => {
    const baseRpc = vi.fn(async () => ({ data: {}, error: null }));
    const getJobConversationContext = vi.fn(async () => domainResult());
    createRuntime.mockReturnValue({ getJobConversationContext });

    const observation = await runPhaseCReplyContextShadow({
      routedActor: ACTOR,
      sourceActivityId: SOURCE_ACTIVITY_ID,
      controlContext: "existing whole-thread control",
      rpcClient: { rpc: baseRpc },
    });

    expect(featureEnabled).toHaveBeenCalledWith(
      ACTOR.companyId,
      "agent_memory_reply_shadow",
      expect.any(AbortSignal)
    );
    const runtimeInput = createRuntime.mock.calls[0]![0];
    expect(Object.keys(runtimeInput).sort()).toEqual([
      "cursorCodec",
      "p2CursorKey",
      "rpcClient",
    ]);
    expect(isTrustedOperationalReadCursorCodec(runtimeInput.cursorCodec)).toBe(
      true
    );
    expect(runtimeInput.p2CursorKey).toMatchObject({
      keyId: "phase-c-p2",
      key: expect.any(Uint8Array),
    });
    expect(runtimeInput.p2CursorKey.key).toHaveLength(32);
    expect(getJobConversationContext).toHaveBeenCalledWith({
      routedActor: ACTOR,
      sourceActivityId: SOURCE_ACTIVITY_ID,
    });
    expect(observation).toMatchObject({
      status: "ready",
      memoryVersion: 2,
      evidenceCount: 1,
      recentTurnCount: 1,
      participantCount: 0,
      warningCount: 0,
    });
    expect(JSON.stringify(observation)).not.toContain("whole-thread");
  });

  it("fails closed without constructing a runtime when cursor config is invalid", async () => {
    delete process.env.OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY;

    const observation = await runPhaseCReplyContextShadow({
      routedActor: ACTOR,
      sourceActivityId: SOURCE_ACTIVITY_ID,
      controlContext: "control",
      rpcClient: { rpc: vi.fn() },
    });

    expect(observation).toMatchObject({ status: "unavailable" });
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("aborts a stuck RPC at the bounded shadow deadline", async () => {
    vi.useFakeTimers();
    const abortSignal = vi.fn((signal: AbortSignal) => {
      return new Promise<{ data: unknown; error: unknown }>(
        (_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        }
      );
    });
    const rpcClient = {
      rpc: vi.fn(() => ({
        abortSignal,
        then: vi.fn(),
      })),
    };
    createRuntime.mockImplementation(({ rpcClient: boundedClient }) => ({
      getJobConversationContext: vi.fn(async () => {
        await boundedClient.rpc("read", {});
        return domainResult();
      }),
    }));

    const pending = runPhaseCReplyContextShadow({
      routedActor: ACTOR,
      sourceActivityId: SOURCE_ACTIVITY_ID,
      controlContext: "control",
      rpcClient,
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBeNull();
    expect(abortSignal).toHaveBeenCalledOnce();
    expect(abortSignal.mock.calls[0]![0].aborted).toBe(true);
  });

  it("aborts a stuck feature lookup at the same bounded deadline", async () => {
    vi.useFakeTimers();
    featureEnabled.mockImplementation(
      (_companyId: string, _featureKey: string, signal: AbortSignal) =>
        new Promise<boolean>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );

    const pending = runPhaseCReplyContextShadow({
      routedActor: ACTOR,
      sourceActivityId: SOURCE_ACTIVITY_ID,
      controlContext: "control",
      rpcClient: { rpc: vi.fn() },
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBeNull();
    const signal = featureEnabled.mock.calls[0]![2] as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("returns at the deadline when a runtime ignores transport cancellation", async () => {
    vi.useFakeTimers();
    createRuntime.mockReturnValue({
      getJobConversationContext: vi.fn(
        () => new Promise<ReturnType<typeof domainResult>>(() => undefined)
      ),
    });

    const pending = runPhaseCReplyContextShadow({
      routedActor: ACTOR,
      sourceActivityId: SOURCE_ACTIVITY_ID,
      controlContext: "control",
      rpcClient: { rpc: vi.fn() },
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBeNull();
  });

  it("contains feature failures and never affects drafting", async () => {
    featureEnabled.mockRejectedValue(new Error("private feature row"));

    await expect(
      runPhaseCReplyContextShadow({
        routedActor: ACTOR,
        sourceActivityId: SOURCE_ACTIVITY_ID,
        controlContext: "control",
        rpcClient: { rpc: vi.fn() },
      })
    ).resolves.toBeNull();
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("contains hostile accessors before actor, feature, or context work", async () => {
    const secret = "CUSTOMER_ACTOR_SECRET";
    const actorGetter = vi.fn(() => {
      throw new Error(secret);
    });
    const hostile = Object.defineProperties(
      {},
      {
        routedActor: { enumerable: true, get: actorGetter },
        sourceActivityId: { enumerable: true, value: SOURCE_ACTIVITY_ID },
        controlContext: { enumerable: true, value: "private control" },
        rpcClient: { enumerable: true, value: { rpc: vi.fn() } },
      }
    );

    await expect(
      runPhaseCReplyContextShadow(hostile as never)
    ).resolves.toBeNull();
    expect(actorGetter).not.toHaveBeenCalled();
    expect(isResolvedActor).not.toHaveBeenCalled();
    expect(featureEnabled).not.toHaveBeenCalled();
  });
});
