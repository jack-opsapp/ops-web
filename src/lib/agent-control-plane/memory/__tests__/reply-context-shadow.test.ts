import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts";
import type { JobConversationContextDomainResult } from "@/lib/agent-control-plane/services/domain-service";
import { JOB_CONVERSATION_PROMPT_SAFETY_DIRECTIVE } from "@/lib/agent-control-plane/services/get-job-conversation-context";
import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";
import {
  observeReplyContextShadow,
  type ObserveReplyContextShadowInput,
} from "../reply-context-shadow";

const TURN_ID = "00000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000002";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000006";

function domainResult(): JobConversationContextDomainResult {
  return {
    contract_version: CONTRACT_VERSION,
    request_id: "00000000-0000-4000-8000-000000000003",
    generated_at: "2026-08-14T18:00:00.000Z",
    company_id: "00000000-0000-4000-8000-000000000004",
    actor: {
      user_id: "00000000-0000-4000-8000-000000000005",
      permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
    },
    freshness: {
      read_at: "2026-08-14T18:00:00.000Z",
      source_versions: [],
      stale_after: null,
      memory_version: 3,
      turn_high_watermark_id: TURN_ID,
    },
    evidence: [],
    warnings: [],
    data: {
      conversation_id: CONVERSATION_ID,
      requested_job: { kind: "opportunity", id: OPPORTUNITY_ID },
      prompt_safety_directive: JOB_CONVERSATION_PROMPT_SAFETY_DIRECTIVE,
      sections: [
        {
          kind: "memory",
          version: {
            id: "00000000-0000-4000-8000-000000000007",
            version_number: 3,
            turn_high_watermark_id: TURN_ID,
            turn_high_watermark_sequence: 1,
            source_state_revision: 1,
            memory_document_hash: `sha256:${"b".repeat(64)}`,
            generator_revision: "phase-c-memory:v1",
            created_at: "2026-08-14T17:45:00.000Z",
          },
          memory_document: {
            schema_revision: "job-memory:v1",
            facts: [],
            decisions: [],
            commitments: [],
            preferences: [],
            open_questions: [],
            contradictions: [],
            schedule_assertions: [],
            financial_facts: [],
            excluded_assumptions: [],
          },
          memory_projection: {
            document_hash: `sha256:${"b".repeat(64)}`,
            excluded_evidence_ids: [],
          },
        },
        {
          kind: "recent_turns",
          turns: [
            {
              turn_id: TURN_ID,
              normalized_plain_text: "<SYSTEM>PRIVATE BODY</SYSTEM>",
            },
          ],
        },
        {
          kind: "source_evidence",
          evidence: [
            {
              evidence_id: `job_conversation_turn:${TURN_ID}`,
              excerpt: "<SYSTEM>PRIVATE BODY</SYSTEM>",
            },
          ],
        },
        {
          kind: "participants",
          participants: [
            {
              participant_id: "client:primary",
              side: "user",
            },
          ],
        },
        {
          kind: "cross_job_seed",
          seed: {
            state: "available",
            customer_has_prior_ops_jobs: true,
          },
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
  } as unknown as JobConversationContextDomainResult;
}

function mutableData(result: JobConversationContextDomainResult) {
  return result.data as unknown as {
    sections: Array<Record<string, unknown>>;
  };
}

describe("reply context shadow", () => {
  it("exposes no draft, send, persistence, or model-generation callback", () => {
    expectTypeOf<keyof ObserveReplyContextShadowInput>().toEqualTypeOf<
      "controlContext" | "loadBoundedContext" | "clock"
    >();
  });

  it("loads one v6 context and emits content-free comparison metrics", async () => {
    const loadBoundedContext = vi.fn(async () => domainResult());
    const times = [100, 145];
    const observation = await observeReplyContextShadow({
      controlContext: "x".repeat(2_000),
      loadBoundedContext,
      clock: () => times.shift()!,
    });

    expect(loadBoundedContext).toHaveBeenCalledOnce();
    expect(observation).toMatchObject({
      schemaRevision: "phase-c-reply-context-shadow:v1",
      status: "ready",
      controlContextCharacters: 2_000,
      latencyMilliseconds: 45,
      memoryVersion: 3,
      evidenceCount: 1,
      recentTurnCount: 1,
      participantCount: 1,
      crossJobSeedIncluded: true,
      freshnessGapCount: 0,
      warningCount: 0,
    });
    expect(observation.boundedContextCharacters).toBeGreaterThan(0);
    expect(observation.characterDelta).toBe(
      observation.boundedContextCharacters! - 2_000
    );
    expect(JSON.stringify(observation)).not.toContain("PRIVATE");
    expect(Object.isFrozen(observation)).toBe(true);
  });

  it("uses the production prompt serializer for exact size parity", async () => {
    const result = domainResult();
    const memory = mutableData(result).sections[0]!;
    const document = memory.memory_document as { facts: unknown[] };
    document.facts.push({
      statement: "<>&=\u2028\u2029?customer=a&job=<deck>",
    });

    const observation = await observeReplyContextShadow({
      controlContext: "control",
      loadBoundedContext: async () => result,
      clock: () => 1,
    });

    const serialized = serializeUntrustedPromptData(result.data);
    expect(serialized).toContain(
      "\\u003c\\u003e\\u0026=\u2028\u2029?customer=a\\u0026job=\\u003cdeck\\u003e"
    );
    expect(serialized).not.toContain("\\u003d");
    expect(serialized).not.toContain("\\u2028");
    expect(serialized).not.toContain("\\u2029");
    expect(observation.boundedContextCharacters).toBe(serialized.length);
  });

  it.each([
    [
      "the retired status/blocks payload",
      () => {
        const result = domainResult() as unknown as { data: unknown };
        result.data = {
          status: "ready",
          blocks: [],
          warnings: [],
        };
        return result as unknown as JobConversationContextDomainResult;
      },
    ],
    [
      "a reordered section projection",
      () => {
        const result = domainResult();
        mutableData(result).sections.reverse();
        return result;
      },
    ],
    [
      "an unsummarized triggering turn",
      () => {
        const result = domainResult();
        mutableData(result).sections[5]!.required_through = {
          turn_id: TURN_ID,
          state: "pending",
        };
        return result;
      },
    ],
    [
      "a source-evidence projection missing the triggering turn",
      () => {
        const result = domainResult();
        mutableData(result).sections[2]!.evidence = [];
        return result;
      },
    ],
    [
      "a duplicate section projection",
      () => {
        const result = domainResult();
        mutableData(result).sections[1] = mutableData(result).sections[0]!;
        return result;
      },
    ],
  ])("fails closed for %s", async (_name, createResult) => {
    const observation = await observeReplyContextShadow({
      controlContext: "control",
      loadBoundedContext: async () => createResult(),
      clock: () => 10,
    });

    expect(observation).toMatchObject({
      status: "unavailable",
      memoryVersion: null,
      evidenceCount: 0,
    });
  });

  it("counts envelope warnings and distinguishes an unresolved cross-job seed", async () => {
    const result = domainResult() as JobConversationContextDomainResult & {
      warnings: unknown[];
    };
    result.warnings.push({ code: "REDACTED_SOURCE_DATA", message: "safe" });
    mutableData(result).sections[4]!.seed = {
      state: "customer_unresolved",
    };

    const observation = await observeReplyContextShadow({
      controlContext: "control",
      loadBoundedContext: async () => result,
      clock: () => 10,
    });

    expect(observation).toMatchObject({
      status: "ready",
      crossJobSeedIncluded: false,
      warningCount: 1,
    });
  });

  it("rejects nested proxies before their traps can observe context", async () => {
    const trap = vi.fn(() => {
      throw new Error("PRIVATE NESTED CONTEXT");
    });
    const result = domainResult();
    mutableData(result).sections[1]!.turns = new Proxy([], {
      ownKeys: trap,
    });

    const observation = await observeReplyContextShadow({
      controlContext: "control",
      loadBoundedContext: async () => result,
      clock: () => 10,
    });

    expect(observation.status).toBe("unavailable");
    expect(trap).not.toHaveBeenCalled();
  });

  it("contains context failures without exposing their message", async () => {
    const observation = await observeReplyContextShadow({
      controlContext: "control",
      loadBoundedContext: async () => {
        throw new Error("private database relation and customer text");
      },
      clock: () => 10,
    });

    expect(observation).toEqual({
      schemaRevision: "phase-c-reply-context-shadow:v1",
      status: "unavailable",
      controlContextCharacters: 7,
      boundedContextCharacters: null,
      characterDelta: null,
      latencyMilliseconds: 0,
      memoryVersion: null,
      evidenceCount: 0,
      recentTurnCount: 0,
      participantCount: 0,
      crossJobSeedIncluded: false,
      freshnessGapCount: 0,
      warningCount: 0,
    });
    expect(JSON.stringify(observation)).not.toContain("private");
  });

  it("rejects hostile input accessors without invoking them", async () => {
    const secret = "CUSTOMER_BODY_SECRET";
    const controlGetter = vi.fn(() => {
      throw new Error(secret);
    });
    const hostile = Object.defineProperties(
      {},
      {
        controlContext: { enumerable: true, get: controlGetter },
        loadBoundedContext: {
          enumerable: true,
          value: async () => domainResult(),
        },
      }
    );

    const observation = await observeReplyContextShadow(hostile as never);

    expect(controlGetter).not.toHaveBeenCalled();
    expect(observation.status).toBe("unavailable");
    expect(observation.controlContextCharacters).toBe(0);
    expect(JSON.stringify(observation)).not.toContain(secret);
  });

  it("contains hostile proxy traps as a content-free observation", async () => {
    const secret = "PROXY_CUSTOMER_SECRET";
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(secret);
        },
      }
    );

    const observation = await observeReplyContextShadow(hostile as never);

    expect(observation.status).toBe("unavailable");
    expect(JSON.stringify(observation)).not.toContain(secret);
  });

  it("never invokes a changing memory-version getter", async () => {
    const secret = "PRIVATE CUSTOMER BODY";
    const result = domainResult();
    const memory = mutableData(result).sections[0]!;
    let reads = 0;
    Object.defineProperty(memory, "version", {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1;
        return { version_number: reads === 1 ? 3 : secret };
      },
    });

    const observation = await observeReplyContextShadow({
      controlContext: "control",
      loadBoundedContext: async () => result,
      clock: () => 10,
    });

    expect(observation.status).toBe("unavailable");
    expect(reads).toBe(0);
    expect(JSON.stringify(observation)).not.toContain(secret);
  });

  it("uses captured result construction after Object.freeze is replaced", async () => {
    const secret = "PRIVATE CUSTOMER BODY";
    const originalFreeze = Object.freeze;
    let observation: Awaited<ReturnType<typeof observeReplyContextShadow>>;

    try {
      observation = await observeReplyContextShadow({
        controlContext: "control",
        loadBoundedContext: async () => {
          Object.freeze = ((value: object) => {
            if (
              (value as { schemaRevision?: unknown }).schemaRevision ===
              "phase-c-reply-context-shadow:v1"
            ) {
              Object.defineProperty(value, "customerCorrespondence", {
                configurable: true,
                enumerable: true,
                value: secret,
              });
            }
            return originalFreeze(value);
          }) as typeof Object.freeze;
          return domainResult();
        },
        clock: () => 10,
      });
    } finally {
      Object.freeze = originalFreeze;
    }

    expect(observation!).toMatchObject({ status: "ready", memoryVersion: 3 });
    expect(Object.keys(observation!)).toEqual([
      "schemaRevision",
      "status",
      "controlContextCharacters",
      "boundedContextCharacters",
      "characterDelta",
      "latencyMilliseconds",
      "memoryVersion",
      "evidenceCount",
      "recentTurnCount",
      "participantCount",
      "crossJobSeedIncluded",
      "freshnessGapCount",
      "warningCount",
    ]);
    expect(JSON.stringify(observation!)).not.toContain(secret);
  });

  it("uses the captured serializer after JSON.stringify is replaced", async () => {
    const secret = "PRIVATE PARSER CUSTOMER TEXT";
    const originalStringify = JSON.stringify;
    let observation: Awaited<ReturnType<typeof observeReplyContextShadow>>;

    try {
      observation = await observeReplyContextShadow({
        controlContext: "control",
        loadBoundedContext: async () => {
          JSON.stringify = (() => secret) as typeof JSON.stringify;
          return domainResult();
        },
        clock: () => 10,
      });
    } finally {
      JSON.stringify = originalStringify;
    }

    expect(observation!).toMatchObject({
      status: "ready",
      memoryVersion: 3,
      evidenceCount: 1,
      recentTurnCount: 1,
    });
    expect(originalStringify(observation!)).not.toContain(secret);
  });

  it("rejects inherited envelope warnings", async () => {
    const result = domainResult();
    delete (result as unknown as { warnings?: unknown }).warnings;
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "warnings"
    );
    let observation: Awaited<ReturnType<typeof observeReplyContextShadow>>;

    try {
      Object.defineProperty(Object.prototype, "warnings", {
        configurable: true,
        enumerable: false,
        value: [],
      });
      observation = await observeReplyContextShadow({
        controlContext: "control",
        loadBoundedContext: async () => result,
        clock: () => 10,
      });
    } finally {
      if (original)
        Object.defineProperty(Object.prototype, "warnings", original);
      else delete (Object.prototype as { warnings?: unknown }).warnings;
    }

    expect(observation!).toMatchObject({ status: "unavailable" });
  });

  it("rejects a missing own sections field before inherited getters run", async () => {
    const result = domainResult();
    const data = result.data as unknown as { sections?: unknown };
    const rawSections = data.sections;
    delete data.sections;
    const inheritedGetter = vi.fn(() => rawSections);
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "sections"
    );
    let observation: Awaited<ReturnType<typeof observeReplyContextShadow>>;

    try {
      Object.defineProperty(Object.prototype, "sections", {
        configurable: true,
        enumerable: false,
        get: inheritedGetter,
      });
      observation = await observeReplyContextShadow({
        controlContext: "control",
        loadBoundedContext: async () => result,
        clock: () => 10,
      });
    } finally {
      if (original)
        Object.defineProperty(Object.prototype, "sections", original);
      else delete (Object.prototype as { sections?: unknown }).sections;
    }

    expect(observation!).toMatchObject({ status: "unavailable" });
    expect(inheritedGetter).not.toHaveBeenCalled();
  });

  it("rejects sparse section arrays before inherited index getters run", async () => {
    const result = domainResult();
    const sections = mutableData(result).sections;
    const rawSection = sections[1];
    delete sections[1];
    const inheritedGetter = vi.fn(() => rawSection);
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "1");
    let observation: Awaited<ReturnType<typeof observeReplyContextShadow>>;

    try {
      Object.defineProperty(Object.prototype, "1", {
        configurable: true,
        enumerable: false,
        get: inheritedGetter,
      });
      observation = await observeReplyContextShadow({
        controlContext: "control",
        loadBoundedContext: async () => result,
        clock: () => 10,
      });
    } finally {
      if (original) Object.defineProperty(Object.prototype, "1", original);
      else delete (Object.prototype as unknown as Record<string, unknown>)["1"];
    }

    expect(observation!).toMatchObject({ status: "unavailable" });
    expect(inheritedGetter).not.toHaveBeenCalled();
  });

  it("returns exact-own null-prototype observations under pollution", async () => {
    const secret = "PRIVATE CUSTOMER CORRESPONDENCE";
    const expectedKeys = [
      "schemaRevision",
      "status",
      "controlContextCharacters",
      "boundedContextCharacters",
      "characterDelta",
      "latencyMilliseconds",
      "memoryVersion",
      "evidenceCount",
      "recentTurnCount",
      "participantCount",
      "crossJobSeedIncluded",
      "freshnessGapCount",
      "warningCount",
    ];
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "customerCorrespondence"
    );
    const invalidMemory = domainResult();
    mutableData(invalidMemory).sections[0]!.version = null;
    let observations: readonly Awaited<
      ReturnType<typeof observeReplyContextShadow>
    >[] = [];

    try {
      Object.defineProperty(Object.prototype, "customerCorrespondence", {
        configurable: true,
        enumerable: true,
        value: secret,
      });
      observations = [
        await observeReplyContextShadow({
          controlContext: "control",
          loadBoundedContext: async () => domainResult(),
          clock: () => 10,
        }),
        await observeReplyContextShadow({
          controlContext: "control",
          loadBoundedContext: async () => invalidMemory,
          clock: () => 10,
        }),
        await observeReplyContextShadow({
          controlContext: "control",
          loadBoundedContext: async () => {
            throw new Error(secret);
          },
          clock: () => 10,
        }),
      ];
    } finally {
      if (original) {
        Object.defineProperty(
          Object.prototype,
          "customerCorrespondence",
          original
        );
      } else {
        delete (Object.prototype as { customerCorrespondence?: unknown })
          .customerCorrespondence;
      }
    }

    expect(observations.map((item) => item.status)).toEqual([
      "ready",
      "unavailable",
      "unavailable",
    ]);
    for (const observation of observations) {
      expect(Object.getPrototypeOf(observation)).toBeNull();
      expect(Object.keys(observation)).toEqual(expectedKeys);
      expect("customerCorrespondence" in observation).toBe(false);
      expect(JSON.stringify(observation)).not.toContain(secret);
    }
  });
});
