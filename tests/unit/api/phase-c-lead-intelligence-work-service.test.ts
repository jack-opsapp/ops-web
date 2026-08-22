import { describe, expect, it, vi } from "vitest";

import {
  PhaseCLeadIntelligenceWorkService,
  type ClaimedPhaseCLeadIntelligenceWork,
  type PhaseCLeadIntelligenceComponent,
  type PhaseCLeadIntelligenceWorkDependencies,
} from "@/lib/api/services/phase-c-lead-intelligence-work-service";

function work(
  overrides: Partial<ClaimedPhaseCLeadIntelligenceWork> = {}
): ClaimedPhaseCLeadIntelligenceWork {
  return {
    companyId: "company-1",
    opportunityId: "opportunity-1",
    requiredEventId: "event-4",
    requiredEventAt: "2026-08-20T15:00:00.000Z",
    requiredActivityId: "activity-4",
    requiredConnectionId: "connection-1",
    requiredProviderThreadId: "thread-1",
    attemptCount: 1,
    componentOutcomes: {},
    componentErrors: {},
    ...overrides,
  };
}

function dependencies(input?: {
  jobs?: ClaimedPhaseCLeadIntelligenceWork[];
  completed?: PhaseCLeadIntelligenceComponent[];
  process?: PhaseCLeadIntelligenceWorkDependencies["processComponent"];
}) {
  const jobs = input?.jobs ?? [work()];
  const completed = new Set(input?.completed ?? []);
  const acknowledge = vi.fn<
    PhaseCLeadIntelligenceWorkDependencies["acknowledge"]
  >(async ({ component }) => {
    completed.add(component);
    return completed.size === 4 ? "completed" : "acknowledged";
  });
  const fail = vi.fn<PhaseCLeadIntelligenceWorkDependencies["fail"]>(
    async () => "retry_scheduled"
  );
  const processComponent =
    input?.process ??
    vi.fn<PhaseCLeadIntelligenceWorkDependencies["processComponent"]>(
      async ({ component }) => ({
        outcome: component === "event_handoff" ? "review" : "applied",
        detail: { component },
      })
    );

  const value: PhaseCLeadIntelligenceWorkDependencies = {
    workerId: () => "phase-c-worker-test",
    claim: vi.fn(async () => jobs),
    isComponentComplete: vi.fn((job, component) => completed.has(component)),
    processComponent,
    acknowledge,
    fail,
  };
  return { value, acknowledge, fail, processComponent };
}

describe("PhaseCLeadIntelligenceWorkService", () => {
  it("acknowledges every component against the exact claimed event in dependency order", async () => {
    const deps = dependencies();
    const result = await new PhaseCLeadIntelligenceWorkService(
      deps.value
    ).runWorker({ limit: 2, leaseSeconds: 180 });

    expect(deps.processComponent).toHaveBeenCalledTimes(4);
    expect(
      vi
        .mocked(deps.processComponent)
        .mock.calls.map(([call]) => call.component)
    ).toEqual(["summary", "lifecycle", "commercial", "event_handoff"]);
    expect(deps.acknowledge).toHaveBeenCalledTimes(4);
    for (const [call] of deps.acknowledge.mock.calls) {
      expect(call.expectedRequiredEventId).toBe("event-4");
      expect(call.workerId).toBe("phase-c-worker-test");
    }
    expect(deps.fail).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      retrying: 0,
      failed: 0,
    });
  });

  it("retains one failed component while independently completing later deterministic work", async () => {
    const processComponent = vi.fn(async ({ component }) => {
      if (component === "lifecycle") {
        throw new Error("model refusal");
      }
      return { outcome: "applied" as const, detail: { component } };
    });
    const deps = dependencies({ process: processComponent });

    const result = await new PhaseCLeadIntelligenceWorkService(
      deps.value
    ).runWorker({ limit: 1 });

    expect(processComponent.mock.calls.map(([call]) => call.component)).toEqual(
      ["summary", "lifecycle", "commercial", "event_handoff"]
    );
    expect(deps.acknowledge).toHaveBeenCalledTimes(3);
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        opportunityId: "opportunity-1",
        expectedRequiredEventId: "event-4",
        errorCode: "phase_c_lifecycle_failed",
        errorMessage: "lifecycle: model refusal",
        componentErrors: {
          lifecycle: {
            code: "phase_c_lifecycle_failed",
            message: "model refusal",
          },
        },
      })
    );
    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      retrying: 1,
      failed: 0,
    });
  });

  it("replays only unfinished components after a crash", async () => {
    const deps = dependencies({ completed: ["summary", "lifecycle"] });

    const result = await new PhaseCLeadIntelligenceWorkService(
      deps.value
    ).runWorker();

    expect(
      vi
        .mocked(deps.processComponent)
        .mock.calls.map(([call]) => call.component)
    ).toEqual(["commercial", "event_handoff"]);
    expect(result.componentsSkippedAsComplete).toBe(2);
    expect(result.completed).toBe(1);
  });

  it("durably skips every remaining component when Phase C is disabled", async () => {
    const processComponent = vi.fn(async () => ({
      outcome: "skipped" as const,
      detail: { reason: "phase_c_disabled" },
      skipRemainingReason: "phase_c_disabled",
    }));
    const deps = dependencies({ process: processComponent });

    const result = await new PhaseCLeadIntelligenceWorkService(
      deps.value
    ).runWorker();

    expect(processComponent).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).toHaveBeenCalledTimes(4);
    expect(deps.acknowledge.mock.calls.map(([call]) => call.outcome)).toEqual([
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(result.completed).toBe(1);
  });

  it("stops cleanly when newer correspondence supersedes the claimed event", async () => {
    const deps = dependencies();
    deps.acknowledge.mockResolvedValueOnce("superseded");

    const result = await new PhaseCLeadIntelligenceWorkService(
      deps.value
    ).runWorker();

    expect(deps.processComponent).toHaveBeenCalledTimes(1);
    expect(deps.fail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ superseded: 1, completed: 0 });
  });

  it("reports lease loss independently instead of claiming success", async () => {
    const deps = dependencies();
    deps.acknowledge.mockResolvedValueOnce("lease_lost");
    deps.fail.mockResolvedValueOnce("lease_lost");

    const result = await new PhaseCLeadIntelligenceWorkService(
      deps.value
    ).runWorker();

    expect(deps.fail).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ failed: 1, completed: 0 });
    expect(result.errors[0]?.error).toContain("lease lost");
  });
});
