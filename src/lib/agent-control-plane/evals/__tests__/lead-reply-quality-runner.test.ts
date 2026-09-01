import { types as nodeTypes } from "node:util";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { LEAD_REPLY_QUALITY_FIXTURES } from "../fixtures/lead-reply-quality";
import {
  runLeadReplyQualitySuite,
  type LeadReplyCandidatePath,
  type LeadReplyCandidatePathInput,
} from "../lead-reply-quality-runner";
import type { LeadReplyDisposition } from "../lead-reply-quality";

interface PathOutput {
  readonly disposition: LeadReplyDisposition;
  readonly responseMode:
    | "first_reply"
    | "direct_answer"
    | "schedule"
    | "attachment"
    | "no_reply"
    | "operator_input";
  readonly draft: string;
  readonly recipientEmail: string | null;
}

function mechanicsOutput(input: LeadReplyCandidatePathInput): PathOutput {
  const turns = input.conversation.turns;
  const latest = turns.at(-1)!;
  const latestBody = latest.body.toLowerCase();
  const rendered = input.context.rendered.toLowerCase();
  const latestParticipant = input.conversation.participants.find(
    (participant) => participant.id === latest.participantId
  );
  const recipientEmail =
    latestParticipant?.side === "user" &&
    latestParticipant.identityStatus === "resolved"
      ? latestParticipant.email
      : null;

  if (latest.side === "assistant" || /\bok,? thanks\b/i.test(latest.body)) {
    return {
      disposition: "no_reply_required",
      responseMode: "no_reply",
      draft: "",
      recipientEmail: null,
    };
  }
  if (
    latest.participantId === "client:unresolved" ||
    latestBody.includes("alex is away") ||
    (latestBody.includes("move the site visit") &&
      input.verifiedSchedule === null)
  ) {
    return {
      disposition: "operator_input_required",
      responseMode: "operator_input",
      draft: "",
      recipientEmail: null,
    };
  }
  if (
    turns.every((turn) => turn.side === "user") &&
    latestBody.includes("deck stair")
  ) {
    return {
      disposition: "reply",
      responseMode: "first_reply",
      draft:
        "The request is for the damaged deck stair. Could you send a photo?",
      recipientEmail,
    };
  }
  if (latestBody.includes("site photo") && latest.attachmentIds.length > 0) {
    return {
      disposition: "reply",
      responseMode: "attachment",
      draft: "The site photo came through.",
      recipientEmail,
    };
  }
  if (latestBody.includes("repair is only for the back deck stair")) {
    return {
      disposition: "reply",
      responseMode: "direct_answer",
      draft: "I have the back deck stair scope.",
      recipientEmail,
    };
  }
  if (
    latestBody.includes("thursday at 2:00 p.m.") &&
    input.verifiedSchedule?.statement
      .toLowerCase()
      .includes("thursday at 2:00 p.m.")
  ) {
    return {
      disposition: "reply",
      responseMode: "schedule",
      draft: "Thursday at 2:00 p.m. is confirmed.",
      recipientEmail,
    };
  }
  if (latestBody.includes("new job is only for the back deck railing")) {
    return {
      disposition: "reply",
      responseMode: "direct_answer",
      draft: "The back deck railing scope is clear.",
      recipientEmail,
    };
  }
  if (latestBody.includes("estimate") && rendered.includes("ready friday")) {
    return {
      disposition: "reply",
      responseMode: "direct_answer",
      draft: rendered.includes("send it here")
        ? "The estimate will be ready Friday. I’ll send it here once it’s complete."
        : "The estimate will be ready Friday.",
      recipientEmail,
    };
  }
  throw new Error("MECHANICS_FIXTURE_NOT_RECOGNIZED");
}

function mechanicsPath(
  expectedContextKind: LeadReplyCandidatePathInput["context"]["kind"]
): { path: LeadReplyCandidatePath; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (input: LeadReplyCandidatePathInput) => {
    if (input.context.kind !== expectedContextKind) {
      throw new Error("MECHANICS_CONTEXT_PATH_MISMATCH");
    }
    return mechanicsOutput(input);
  });
  return { path: { run }, run };
}

describe("lead reply quality deterministic runner", () => {
  it("executes both candidate paths over every real fixture without production dependencies", async () => {
    const control = mechanicsPath("whole_history_control");
    const shared = mechanicsPath("shared_job_memory");
    let now = 0;
    const result = await runLeadReplyQualitySuite({
      fixtures: LEAD_REPLY_QUALITY_FIXTURES,
      controlPath: control.path,
      sharedPath: shared.path,
      clock: () => (now += 10),
    });

    expect(result.fixtureResults).toHaveLength(13);
    expect(result).not.toHaveProperty("evaluationMode");
    expect(
      result.fixtureResults
        .filter(
          (fixture) =>
            !fixture.comparison.control.passed ||
            !fixture.comparison.shared.passed
        )
        .map((fixture) => ({
          id: fixture.fixtureId,
          control: fixture.comparison.control,
          shared: fixture.comparison.shared,
        }))
    ).toEqual([]);
    expect(result.qualityChecksPassed).toBe(true);
    expect(result.releaseGatePassed).toBe(false);
    expect(result.sharedVariation.hasProperVariation).toBe(true);
    expect(control.run).toHaveBeenCalledTimes(13);
    expect(shared.run).toHaveBeenCalledTimes(13);
    expect(
      control.run.mock.calls.every(
        ([input]) => input.context.kind === "whole_history_control"
      )
    ).toBe(true);
    expect(
      shared.run.mock.calls.every(
        ([input]) => input.context.kind === "shared_job_memory"
      )
    ).toBe(true);
    expect(Object.keys(control.run.mock.calls[0]![0])).toEqual([
      "conversation",
      "context",
      "verifiedSchedule",
    ]);
    expect(control.run.mock.calls[0]![0]).not.toHaveProperty("fixture");
    expect(Object.isFrozen(control.run.mock.calls[0]![0].conversation)).toBe(
      true
    );
    expect(Object.isFrozen(control.run.mock.calls[0]![0].context)).toBe(true);
    const verifiedScheduleFixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (fixture) => fixture.id === "evolving-conversation-verified-schedule"
    )!;
    expect(verifiedScheduleFixture.verifiedSchedule).toEqual({
      statement: "Thursday at 2:00 p.m. is available.",
      evidenceId: "verified_schedule:site_visit:2026-08-20T14:00:00-07:00",
    });
    expect(
      verifiedScheduleFixture.conversation.turns.some((turn) =>
        turn.body.toLowerCase().includes("server-verified schedule")
      )
    ).toBe(false);
    expect(
      verifiedScheduleFixture.sharedContext.rendered
        .toLowerCase()
        .includes("server-verified schedule")
    ).toBe(false);
  });

  it("fails the suite when shared output negates the exact schedule and commitment", async () => {
    const control = mechanicsPath("whole_history_control");
    const shared = mechanicsPath("shared_job_memory");
    const result = await runLeadReplyQualitySuite({
      fixtures: LEAD_REPLY_QUALITY_FIXTURES,
      controlPath: control.path,
      sharedPath: {
        run: async (input) =>
          input.conversation.turns.length >= 200
            ? {
                disposition: "reply",
                responseMode: "direct_answer",
                draft:
                  "The estimate will not be ready Friday. I will not send it here.",
                recipientEmail: "alex@example.test",
              }
            : shared.path.run(input),
      },
    });
    const unsafe = result.fixtureResults.find(
      (fixture) => fixture.fixtureId === "long-history-current-estimate-date"
    )!;

    expect(unsafe.comparison.shared.releaseCritical.scheduleAccuracy).toBe(
      false
    );
    expect(unsafe.comparison.shared.releaseCritical.commitmentContinuity).toBe(
      false
    );
    expect(result.qualityChecksPassed).toBe(false);
  });

  it("makes an unnecessary acknowledgement reply a hard suite failure", async () => {
    const control = mechanicsPath("whole_history_control");
    const shared = mechanicsPath("shared_job_memory");
    const result = await runLeadReplyQualitySuite({
      fixtures: LEAD_REPLY_QUALITY_FIXTURES,
      controlPath: control.path,
      sharedPath: {
        run: async (input) =>
          /\bok,? thanks\b/i.test(input.conversation.turns.at(-1)!.body)
            ? {
                disposition: "reply",
                responseMode: "direct_answer",
                draft: "Got it. Thanks for the update.",
                recipientEmail: "alex@example.test",
              }
            : shared.path.run(input),
      },
    });

    expect(result.qualityChecksPassed).toBe(false);
    expect(
      result.fixtureResults.find(
        (fixture) => fixture.fixtureId === "acknowledgement-no-response-needed"
      )!.comparison.shared.releaseCritical.dispositionSafe
    ).toBe(false);
  });

  it("never exposes fixture expectations to either deeply immutable candidate input", async () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES[0]!;
    const control = mechanicsPath("whole_history_control");
    const shared = mechanicsPath("shared_job_memory");

    await runLeadReplyQualitySuite({
      fixtures: [fixture],
      controlPath: control.path,
      sharedPath: shared.path,
    });

    for (const input of [
      control.run.mock.calls[0]![0],
      shared.run.mock.calls[0]![0],
    ]) {
      expect(input).not.toHaveProperty("fixture");
      expect(input).not.toHaveProperty("expectedClaims");
      expect(input).not.toHaveProperty("expectedDisposition");
      expect(input).not.toHaveProperty("expectedRecipientEmail");
      expect(input.conversation).not.toHaveProperty("resolvedRecipientEmail");
      expect(input.conversation).not.toHaveProperty("opportunityId");
      expect(Object.isFrozen(input.conversation.turns)).toBe(true);
      expect(Object.isFrozen(input.conversation.turns[0])).toBe(true);
      expect(Object.isFrozen(input.conversation.participants)).toBe(true);
      expect(Object.isFrozen(input.conversation.participants[0])).toBe(true);
      expect(Object.isFrozen(input.context.evidenceIds)).toBe(true);
    }
  });

  it("rejects one adapter masquerading as two independent paths", async () => {
    const path = mechanicsPath("whole_history_control").path;
    await expect(
      runLeadReplyQualitySuite({
        fixtures: [LEAD_REPLY_QUALITY_FIXTURES[0]!],
        controlPath: path,
        sharedPath: path,
      })
    ).rejects.toThrow("LEAD_REPLY_EVAL_PATHS_NOT_INDEPENDENT");
  });

  it("is mechanics-only and can never claim release readiness", async () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "long-history-current-estimate-date"
    )!;
    const control = mechanicsPath("whole_history_control");
    const shared = mechanicsPath("shared_job_memory");
    const result = await runLeadReplyQualitySuite({
      fixtures: [fixture],
      controlPath: control.path,
      sharedPath: shared.path,
    });

    expect(result.qualityChecksPassed).toBe(true);
    expect(result).not.toHaveProperty("evaluationMode");
    expect(result.releaseGatePassed).toBe(false);
    expectTypeOf<
      Parameters<typeof runLeadReplyQualitySuite>[0]
    >().not.toHaveProperty("evaluationMode");

    await expect(
      runLeadReplyQualitySuite({
        fixtures: [fixture],
        controlPath: control.path,
        sharedPath: shared.path,
        evaluationMode: "measured_model_paths",
      } as never)
    ).rejects.toThrow("LEAD_REPLY_EVAL_SUITE_INPUT_INVALID");
  });

  it("rejects a candidate that replaces Object.freeze before any result is trusted", async () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES[0]!;
    const originalFreeze = Object.freeze;
    let caught: unknown;

    try {
      try {
        await runLeadReplyQualitySuite({
          fixtures: [fixture],
          controlPath: {
            run: async (input) => {
              Object.freeze = ((value: object) => {
                if (
                  Object.prototype.hasOwnProperty.call(
                    value,
                    "releaseGatePassed"
                  )
                ) {
                  Object.assign(value, {
                    releaseGatePassed: true,
                    evaluationMode: "measured_model_paths",
                  });
                }
                return originalFreeze(value);
              }) as typeof Object.freeze;
              return mechanicsOutput(input);
            },
          },
          sharedPath: { run: async (input) => mechanicsOutput(input) },
        });
      } catch (error) {
        caught = error;
      }
    } finally {
      Object.freeze = originalFreeze;
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe(
      "LEAD_REPLY_EVAL_INTRINSICS_MUTATED"
    );
  });

  it("rejects hostile candidate callbacks that mutate scoring intrinsics", async () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "long-history-current-estimate-date"
    )!;
    const originalEvery = Array.prototype.every;
    const originalTest = RegExp.prototype.test;
    const originalExec = RegExp.prototype.exec;
    const originalTrim = String.prototype.trim;
    const originalNormalize = String.prototype.normalize;
    const originalGetPrototypeOf = Object.getPrototypeOf;
    const originalGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
    const originalHasOwn = Object.hasOwn;
    const originalOwnKeys = Reflect.ownKeys;
    const originalSetHas = Set.prototype.has;
    const originalMax = Math.max;
    const originalRound = Math.round;
    const unsafeOutput = {
      disposition: "reply" as const,
      responseMode: "direct_answer" as const,
      draft:
        "The estimate will be ready Friday. I’ll send it here once it’s complete. We’ve pencilled you in.",
      recipientEmail: "jamie@example.test",
    };
    let caught: unknown;

    try {
      try {
        await runLeadReplyQualitySuite({
          fixtures: [fixture],
          controlPath: {
            run: async () => {
              Array.prototype.every = (() =>
                true) as unknown as typeof Array.prototype.every;
              RegExp.prototype.test = (() =>
                false) as typeof RegExp.prototype.test;
              RegExp.prototype.exec = (() =>
                null) as typeof RegExp.prototype.exec;
              String.prototype.trim = (() =>
                "") as typeof String.prototype.trim;
              String.prototype.normalize = (() =>
                "forged") as typeof String.prototype.normalize;
              Object.getPrototypeOf = (() =>
                null) as typeof Object.getPrototypeOf;
              Object.getOwnPropertyDescriptors =
                (() => ({})) as typeof Object.getOwnPropertyDescriptors;
              Object.hasOwn = (() => false) as typeof Object.hasOwn;
              Reflect.ownKeys = (() => []) as typeof Reflect.ownKeys;
              Set.prototype.has = (() => true) as typeof Set.prototype.has;
              Math.max = (() => 999) as typeof Math.max;
              Math.round = (() => 999) as typeof Math.round;
              return unsafeOutput;
            },
          },
          sharedPath: { run: async () => unsafeOutput },
        });
      } catch (error) {
        caught = error;
      }
    } finally {
      Array.prototype.every = originalEvery;
      RegExp.prototype.test = originalTest;
      RegExp.prototype.exec = originalExec;
      String.prototype.trim = originalTrim;
      String.prototype.normalize = originalNormalize;
      Object.getPrototypeOf = originalGetPrototypeOf;
      Object.getOwnPropertyDescriptors = originalGetOwnPropertyDescriptors;
      Object.hasOwn = originalHasOwn;
      Reflect.ownKeys = originalOwnKeys;
      Set.prototype.has = originalSetHas;
      Math.max = originalMax;
      Math.round = originalRound;
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe(
      "LEAD_REPLY_EVAL_INTRINSICS_MUTATED"
    );
  });

  it("rejects an inherited numeric setter before it can forge mechanics evidence", async () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "long-history-current-estimate-date"
    )!;
    const originalIndexDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "0"
    );
    const defineOwnIndex = Object.defineProperty;
    const unsafeOutput = {
      disposition: "reply" as const,
      responseMode: "direct_answer" as const,
      draft: "The estimate will be ready Friday. I will demolish Tuesday.",
      recipientEmail: "attacker@example.test",
    };
    let caught: unknown;

    try {
      try {
        await runLeadReplyQualitySuite({
          fixtures: [fixture],
          controlPath: {
            run: async () => {
              Object.defineProperty(Array.prototype, "0", {
                configurable: true,
                get: () => undefined,
                set(value: unknown) {
                  const candidate = value as {
                    fixtureId?: string;
                    comparison?: Record<string, unknown>;
                  };
                  const replacement =
                    candidate?.fixtureId && candidate.comparison
                      ? {
                          ...candidate,
                          comparison: {
                            ...candidate.comparison,
                            candidateChecksPassed: true,
                          },
                        }
                      : value;
                  defineOwnIndex(this, "0", {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: replacement,
                  });
                },
              });
              return unsafeOutput;
            },
          },
          sharedPath: { run: async () => unsafeOutput },
        });
      } catch (error) {
        caught = error;
      }
    } finally {
      if (originalIndexDescriptor) {
        Object.defineProperty(Array.prototype, "0", originalIndexDescriptor);
      } else {
        delete (Array.prototype as unknown as Record<string, unknown>)["0"];
      }
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe(
      "LEAD_REPLY_EVAL_INTRINSICS_MUTATED"
    );
  });

  it("rejects an inherited index-2 setter before it can hide a third unsupported clause", async () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "long-history-current-estimate-date"
    )!;
    const originalIndexDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "2"
    );
    const unsafeOutput = {
      disposition: "reply" as const,
      responseMode: "direct_answer" as const,
      draft:
        "The estimate will be ready Friday. I’ll send it here once it’s complete. We’ve pencilled you in.",
      recipientEmail: "jamie@example.test",
    };
    let caught: unknown;

    try {
      try {
        await runLeadReplyQualitySuite({
          fixtures: [fixture],
          controlPath: {
            run: async (input) => mechanicsOutput(input),
          },
          sharedPath: {
            run: async () => {
              Object.defineProperty(Array.prototype, "2", {
                configurable: true,
                get: () => undefined,
                set: () => undefined,
              });
              return unsafeOutput;
            },
          },
        });
      } catch (error) {
        caught = error;
      }
    } finally {
      if (originalIndexDescriptor) {
        Object.defineProperty(Array.prototype, "2", originalIndexDescriptor);
      } else {
        delete (Array.prototype as unknown as Record<string, unknown>)["2"];
      }
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe(
      "LEAD_REPLY_EVAL_INTRINSICS_MUTATED"
    );
  });

  it("does not let a hard-coded first-recipient strategy pass the suite", async () => {
    const control = mechanicsPath("whole_history_control");
    const shared = mechanicsPath("shared_job_memory");
    const result = await runLeadReplyQualitySuite({
      fixtures: LEAD_REPLY_QUALITY_FIXTURES,
      controlPath: control.path,
      sharedPath: {
        run: async (input) => {
          const output = await shared.path.run(input);
          return output.disposition === "reply"
            ? { ...output, recipientEmail: "alex@example.test" }
            : output;
        },
      },
    });

    expect(result.qualityChecksPassed).toBe(false);
    expect(
      result.fixtureResults.some(
        (fixture) =>
          !fixture.comparison.shared.releaseCritical.recipientIdentity
      )
    ).toBe(true);
  });

  it("snapshots the complete fixture oracle before either awaited path can mutate it", async () => {
    const source = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "long-history-current-estimate-date"
    )!;
    const fixture = structuredClone(source);
    const observedInputs: LeadReplyCandidatePathInput[] = [];
    const forge = () => {
      Object.assign(fixture.conversation.turns.at(-1)!, {
        body: "FORGED TURN",
      });
      Object.assign(fixture.conversation.participants[0]!, {
        email: "attacker@example.test",
      });
      Object.assign(fixture.controlContext, {
        rendered: "FORGED CONTROL CONTEXT",
        evidenceIds: [],
      });
      Object.assign(fixture.sharedContext, {
        rendered: "FORGED SHARED CONTEXT",
        evidenceIds: [],
      });
      Object.assign(fixture, {
        expectedClaims: [
          {
            id: "forged-fact",
            dimension: "fact",
            acceptedPhrases: ["I will demolish Tuesday"],
            rejectedPhrases: [],
            evidenceIds: ["turn-current-estimate"],
          },
          {
            id: "forged-schedule",
            dimension: "schedule",
            acceptedPhrases: ["Tuesday"],
            rejectedPhrases: [],
            evidenceIds: ["turn-current-estimate"],
          },
          {
            id: "forged-commitment",
            dimension: "commitment",
            acceptedPhrases: ["I will demolish Tuesday"],
            rejectedPhrases: [],
            evidenceIds: ["turn-current-estimate"],
          },
        ],
        forbiddenClaims: [],
        allowedClauses: [
          {
            id: "forged-clause",
            kind: "evidence_backed",
            phrases: ["I will demolish Tuesday."],
            evidenceIds: ["turn-current-estimate"],
          },
        ],
        requiredDecisionEvidenceIds: ["turn-current-estimate"],
        expectedRecipientEmail: "attacker@example.test",
      });
      return {
        disposition: "reply" as const,
        responseMode: "direct_answer" as const,
        draft: "I will demolish Tuesday.",
        recipientEmail: "attacker@example.test",
      };
    };

    const result = await runLeadReplyQualitySuite({
      fixtures: [fixture],
      controlPath: {
        run: async (input) => {
          observedInputs.push(input);
          return forge();
        },
      },
      sharedPath: {
        run: async (input) => {
          observedInputs.push(input);
          return forge();
        },
      },
    });

    expect(observedInputs).toHaveLength(2);
    expect(
      observedInputs.every(
        (input) =>
          input.conversation.turns.at(-1)!.body !== "FORGED TURN" &&
          input.conversation.participants[0]!.email === "jamie@example.test" &&
          !input.context.rendered.startsWith("FORGED") &&
          input.context.evidenceIds.length > 0
      )
    ).toBe(true);
    expect(result.fixtureResults[0]!.comparison.control.passed).toBe(false);
    expect(result.fixtureResults[0]!.comparison.shared.passed).toBe(false);
    expect(result.qualityChecksPassed).toBe(false);
    expect(result.releaseGatePassed).toBe(false);
  });

  it("captures both path callables once before the first await", async () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "long-history-current-estimate-date"
    )!;
    const shared = mechanicsPath("shared_job_memory");
    const forgedSharedRun = vi.fn(async () => ({
      disposition: "reply" as const,
      responseMode: "direct_answer" as const,
      draft: "I will demolish Tuesday.",
      recipientEmail: "attacker@example.test",
    }));
    const controlPath: LeadReplyCandidatePath = {
      run: async (input) => {
        (shared.path as { run: LeadReplyCandidatePath["run"] }).run =
          forgedSharedRun;
        return mechanicsOutput(input);
      },
    };

    const result = await runLeadReplyQualitySuite({
      fixtures: [fixture],
      controlPath,
      sharedPath: shared.path,
    });

    expect(shared.run).toHaveBeenCalledTimes(1);
    expect(forgedSharedRun).not.toHaveBeenCalled();
    expect(result.qualityChecksPassed).toBe(true);
    expect(result.releaseGatePassed).toBe(false);
  });

  it("rejects accessor, proxy, symbol, and extra-field path boundaries before execution", async () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES[0]!;
    const runGetter = vi.fn(() => async () => mechanicsOutput as never);
    const accessorPath = Object.defineProperty({}, "run", {
      enumerable: true,
      get: runGetter,
    });
    const ordinary = mechanicsPath("shared_job_memory").path;

    await expect(
      runLeadReplyQualitySuite({
        fixtures: [fixture],
        controlPath: accessorPath as LeadReplyCandidatePath,
        sharedPath: ordinary,
      })
    ).rejects.toThrow("LEAD_REPLY_EVAL_PATH_INVALID");
    expect(runGetter).not.toHaveBeenCalled();

    const proxied = new Proxy(mechanicsPath("whole_history_control").path, {});
    expect(nodeTypes.isProxy(proxied)).toBe(true);
    await expect(
      runLeadReplyQualitySuite({
        fixtures: [fixture],
        controlPath: proxied,
        sharedPath: ordinary,
      })
    ).rejects.toThrow("LEAD_REPLY_EVAL_PATH_INVALID");

    const revoked = Proxy.revocable(
      mechanicsPath("whole_history_control").path,
      {}
    );
    revoked.revoke();
    await expect(
      runLeadReplyQualitySuite({
        fixtures: [fixture],
        controlPath: revoked.proxy,
        sharedPath: ordinary,
      })
    ).rejects.toThrow("LEAD_REPLY_EVAL_PATH_INVALID");

    const extra = {
      ...mechanicsPath("whole_history_control").path,
      fixtureId: fixture.id,
    };
    await expect(
      runLeadReplyQualitySuite({
        fixtures: [fixture],
        controlPath: extra,
        sharedPath: ordinary,
      })
    ).rejects.toThrow("LEAD_REPLY_EVAL_PATH_INVALID");

    const symbolPath = mechanicsPath("whole_history_control")
      .path as unknown as Record<PropertyKey, unknown>;
    symbolPath[Symbol("oracle")] = fixture.id;
    await expect(
      runLeadReplyQualitySuite({
        fixtures: [fixture],
        controlPath: symbolPath as unknown as LeadReplyCandidatePath,
        sharedPath: ordinary,
      })
    ).rejects.toThrow("LEAD_REPLY_EVAL_PATH_INVALID");
  });

  it("rejects a hostile runner input or mutable fixture oracle before a candidate runs", async () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES[0]!;
    const control = mechanicsPath("whole_history_control");
    const shared = mechanicsPath("shared_job_memory");
    const fixturesGetter = vi.fn(() => [fixture]);
    const hostileInput = Object.defineProperties(
      {},
      {
        fixtures: { enumerable: true, get: fixturesGetter },
        controlPath: { enumerable: true, value: control.path },
        sharedPath: { enumerable: true, value: shared.path },
      }
    );

    await expect(
      runLeadReplyQualitySuite(hostileInput as never)
    ).rejects.toThrow("LEAD_REPLY_EVAL_SUITE_INPUT_INVALID");
    expect(fixturesGetter).not.toHaveBeenCalled();
    expect(control.run).not.toHaveBeenCalled();
    expect(shared.run).not.toHaveBeenCalled();

    const fixtureWithGetter = structuredClone(fixture) as unknown as Record<
      PropertyKey,
      unknown
    >;
    const claimsGetter = vi.fn(() => fixture.expectedClaims);
    Object.defineProperty(fixtureWithGetter, "expectedClaims", {
      enumerable: true,
      get: claimsGetter,
    });
    await expect(
      runLeadReplyQualitySuite({
        fixtures: [fixtureWithGetter as unknown as typeof fixture],
        controlPath: control.path,
        sharedPath: shared.path,
      })
    ).rejects.toThrow("LEAD_REPLY_EVAL_FIXTURE_INVALID");
    expect(claimsGetter).not.toHaveBeenCalled();
  });
});
