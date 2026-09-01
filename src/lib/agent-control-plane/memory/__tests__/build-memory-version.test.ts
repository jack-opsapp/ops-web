import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMemoryVersion,
  createOpenAiMemoryModel,
  MemoryBuildError,
  type MemoryModel,
} from "../build-memory-version";
import {
  EMPTY_MEMORY_DOCUMENT,
  type JobMemoryDocument,
} from "../memory-schema";
import type {
  MemoryGenerationSnapshot,
  MemoryRepository,
  MemoryTurn,
  MemoryVersion,
} from "../memory-repository";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_COMPANY_ID = "00000000-0000-4000-8000-000000000010";
const OTHER_CONVERSATION_ID = "00000000-0000-4000-8000-000000000011";
const TURN_1 = "00000000-0000-4000-8000-000000000003";
const TURN_2 = "00000000-0000-4000-8000-000000000004";
const VERSION_1 = "00000000-0000-4000-8000-000000000005";
const SOURCE_1 = "00000000-0000-4000-8000-000000000006";
const SOURCE_2 = "00000000-0000-4000-8000-000000000007";

function turn(overrides: Partial<MemoryTurn> = {}): MemoryTurn {
  return {
    id: TURN_1,
    turnSequence: 1,
    sourceStateRevision: 1,
    side: "user",
    participantId: "client:00000000-0000-4000-8000-000000000008",
    participantResolutionStatus: "resolved",
    direction: "inbound",
    channel: "email",
    deliveredAt: "2026-08-07T18:00:00.000Z",
    ingestedAt: "2026-08-07T18:01:00.000Z",
    subject: "Schedule",
    normalizedPlainText: "Monday works for us.",
    attachmentEvidenceIds: [],
    providerDeliverySourceId: SOURCE_1,
    providerDeliverySourceSha256: `sha256:${"a".repeat(64)}`,
    evidenceSourceRevision: "job-conversation-turn-projection:v1:1",
    evidenceContentHash: `sha256:${"b".repeat(64)}`,
    redactionKinds: [],
    ...overrides,
  };
}

function version(overrides: Partial<MemoryVersion> = {}): MemoryVersion {
  return {
    id: VERSION_1,
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    versionNumber: 1,
    predecessorVersionId: null,
    turnHighWatermarkId: TURN_1,
    turnHighWatermarkSequence: 1,
    sourceStateRevision: 1,
    generationInputHash: `sha256:${"c".repeat(64)}`,
    memoryDocument: EMPTY_MEMORY_DOCUMENT,
    memoryDocumentHash: `sha256:${"d".repeat(64)}`,
    generatorRevision: "job-memory:test:v1",
    createdAt: "2026-08-07T18:02:00.000Z",
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<MemoryGenerationSnapshot> = {}
): MemoryGenerationSnapshot {
  return {
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    sourceStateRevision: 2,
    lastTurnSequence: 2,
    currentVersion: null,
    currentEvidence: [],
    pendingTurns: [
      turn(),
      turn({
        id: TURN_2,
        turnSequence: 2,
        sourceStateRevision: 2,
        side: "assistant",
        participantId: "ops_user:00000000-0000-4000-8000-000000000009",
        direction: "outbound",
        deliveredAt: "2026-08-07T17:00:00.000Z",
        ingestedAt: "2026-08-07T18:03:00.000Z",
        normalizedPlainText: "Tuesday is still available.",
        providerDeliverySourceId: SOURCE_2,
        providerDeliverySourceSha256: `sha256:${"e".repeat(64)}`,
        evidenceSourceRevision: "job-conversation-turn-projection:v1:2",
        evidenceContentHash: `sha256:${"f".repeat(64)}`,
      }),
    ],
    invalidatedEvidenceIds: [],
    requiredThrough: { turnId: null, state: "not_requested" },
    ...overrides,
  };
}

function repository(input?: {
  snapshot?: MemoryGenerationSnapshot;
  commit?: Awaited<ReturnType<MemoryRepository["commitMemoryVersion"]>>;
  readCurrent?: MemoryVersion | null;
}) {
  const loadGenerationSnapshot = vi
    .fn<MemoryRepository["loadGenerationSnapshot"]>()
    .mockResolvedValue(input?.snapshot ?? snapshot());
  const commitMemoryVersion = vi
    .fn<MemoryRepository["commitMemoryVersion"]>()
    .mockResolvedValue(
      input?.commit ?? { kind: "committed", version: version() }
    );
  const readCurrent = vi
    .fn<MemoryRepository["readCurrent"]>()
    .mockResolvedValue(input?.readCurrent ?? null);
  return {
    value: {
      loadGenerationSnapshot,
      commitMemoryVersion,
      readCurrent,
    } satisfies MemoryRepository,
    loadGenerationSnapshot,
    commitMemoryVersion,
    readCurrent,
  };
}

function model(output: unknown) {
  const generate = vi.fn<MemoryModel["generate"]>().mockResolvedValue(output);
  return { value: { generate } satisfies MemoryModel, generate };
}

function modelDocument(): unknown {
  return {
    schema_version: "ops.job-memory.v1",
    facts: [],
    decisions: [],
    commitments: [],
    preferences: [],
    open_questions: [],
    contradictions: [
      {
        topic: "Schedule date",
        competing_claims: [
          {
            statement: "The customer said Monday works.",
            evidence: [{ evidence_id: "E1", relationship: "supports" }],
          },
          {
            statement: "OPS said Tuesday remains available.",
            evidence: [{ evidence_id: "E2", relationship: "contradicts" }],
          },
        ],
      },
    ],
    schedule_assertions: [],
    financial_facts: [],
    excluded_assumptions: [],
  };
}

const BUILD_INPUT = {
  companyId: COMPANY_ID,
  conversationId: CONVERSATION_ID,
  generatorRevision: "job-memory:test:v1",
  deadlineAt: Date.now() + 60_000,
} as const;

describe("versioned job-memory generation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps server aliases to exact evidence and advances through the last contiguous turn", async () => {
    const repo = repository();
    const memoryModel = model(modelDocument());

    await buildMemoryVersion({
      ...BUILD_INPUT,
      repository: repo.value,
      model: memoryModel.value,
    });

    const modelInput = memoryModel.generate.mock.calls[0][0];
    expect(modelInput.turns.map((item) => item.delivered_at)).toEqual([
      "2026-08-07T17:00:00.000Z",
      "2026-08-07T18:00:00.000Z",
    ]);
    expect(modelInput.turns.map((item) => item.evidence_alias)).toEqual([
      "E2",
      "E1",
    ]);

    const commit = repo.commitMemoryVersion.mock.calls[0][0];
    expect(commit.expectedCurrentMemoryVersionId).toBeNull();
    expect(commit.expectedSourceStateRevision).toBe(2);
    expect(commit.processedTurnIds).toEqual([TURN_1, TURN_2]);
    expect(commit.turnHighWatermarkId).toBe(TURN_2);
    expect(commit.turnHighWatermarkSequence).toBe(2);
    expect(commit.generationInputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      commit.memoryDocument.contradictions[0].competing_claims.map(
        (claim) => claim.evidence[0].evidence_id
      )
    ).toEqual([
      `job_conversation_turn:${TURN_2}`,
      `job_conversation_turn:${TURN_1}`,
    ]);
  });

  it("rejects model output that cites evidence outside the trusted snapshot", async () => {
    const repo = repository();
    const output = modelDocument() as JobMemoryDocument;
    output.contradictions[0].competing_claims[1].evidence[0].evidence_id =
      "E99";

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(output).value,
      })
    ).rejects.toMatchObject({ code: "MEMORY_EVIDENCE_NOT_ALLOWED" });
    expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it("does not commit an empty fallback when the model fails", async () => {
    const repo = repository();
    const failingModel: MemoryModel = {
      generate: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: failingModel,
      })
    ).rejects.toMatchObject({ code: "MEMORY_MODEL_FAILED" });
    expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it("preserves both evidence-backed sides of an unresolved contradiction", async () => {
    const repo = repository();

    await buildMemoryVersion({
      ...BUILD_INPUT,
      repository: repo.value,
      model: model(modelDocument()).value,
    });

    expect(
      repo.commitMemoryVersion.mock.calls[0][0].memoryDocument.contradictions
    ).toEqual([
      {
        topic: "Schedule date",
        competing_claims: [
          {
            statement: "OPS said Tuesday remains available.",
            evidence: [
              {
                evidence_id: `job_conversation_turn:${TURN_2}`,
                relationship: "contradicts",
              },
            ],
          },
          {
            statement: "The customer said Monday works.",
            evidence: [
              {
                evidence_id: `job_conversation_turn:${TURN_1}`,
                relationship: "supports",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("returns an optimistic conflict without accepting the stale candidate", async () => {
    const winner = version({ id: "00000000-0000-4000-8000-000000000010" });
    const repo = repository({
      commit: { kind: "conflict", current: winner },
    });

    const result = await buildMemoryVersion({
      ...BUILD_INPUT,
      repository: repo.value,
      model: model(modelDocument()).value,
    });

    expect(result).toEqual({ kind: "conflict", current: winner });
    expect(repo.commitMemoryVersion).toHaveBeenCalledTimes(1);
  });

  it("replays an already-current watermark without another model call or version", async () => {
    const current = version();
    const repo = repository({
      snapshot: snapshot({
        sourceStateRevision: 1,
        lastTurnSequence: 1,
        currentVersion: current,
        pendingTurns: [],
        requiredThrough: { turnId: null, state: "not_requested" },
      }),
    });
    const memoryModel = model(modelDocument());

    const result = await buildMemoryVersion({
      ...BUILD_INPUT,
      repository: repo.value,
      model: memoryModel.value,
    });

    expect(result).toEqual({ kind: "already_current", version: current });
    expect(memoryModel.generate).not.toHaveBeenCalled();
    expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it.each([
    {
      boundary: "company",
      currentVersion: version({ companyId: OTHER_COMPANY_ID }),
    },
    {
      boundary: "conversation",
      currentVersion: version({ conversationId: OTHER_CONVERSATION_ID }),
    },
  ])(
    "rejects a caller-supplied snapshot whose current version crosses the $boundary boundary",
    async ({ currentVersion }) => {
      const repo = repository();
      const memoryModel = model(modelDocument());

      await expect(
        buildMemoryVersion({
          ...BUILD_INPUT,
          repository: repo.value,
          model: memoryModel.value,
          snapshot: snapshot({
            sourceStateRevision: 1,
            lastTurnSequence: 1,
            currentVersion,
            pendingTurns: [],
            requiredThrough: { turnId: null, state: "not_requested" },
          }),
        })
      ).rejects.toMatchObject({ code: "MEMORY_SNAPSHOT_INVALID" });
      expect(repo.loadGenerationSnapshot).not.toHaveBeenCalled();
      expect(memoryModel.generate).not.toHaveBeenCalled();
      expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
    }
  );

  it("rejects a caller-supplied snapshot for a different required-through turn", async () => {
    const repo = repository();
    const memoryModel = model(modelDocument());

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        requiredThroughTurnId: TURN_2,
        repository: repo.value,
        model: memoryModel.value,
        snapshot: snapshot({
          sourceStateRevision: 1,
          lastTurnSequence: 1,
          currentVersion: version(),
          pendingTurns: [],
          requiredThrough: { turnId: TURN_1, state: "summarized" },
        }),
      })
    ).rejects.toMatchObject({ code: "MEMORY_SNAPSHOT_INVALID" });
    expect(repo.loadGenerationSnapshot).not.toHaveBeenCalled();
    expect(memoryModel.generate).not.toHaveBeenCalled();
    expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it("removes claims backed by newly redacted evidence without sending them back to a model", async () => {
    const evidenceId = `job_conversation_turn:${TURN_1}`;
    const priorDocument: JobMemoryDocument = {
      ...EMPTY_MEMORY_DOCUMENT,
      facts: [
        {
          statement: "The redacted fact must disappear.",
          evidence: [{ evidence_id: evidenceId, relationship: "supports" }],
        },
      ],
    };
    const current = version({ memoryDocument: priorDocument });
    const repo = repository({
      snapshot: snapshot({
        currentVersion: current,
        currentEvidence: [
          {
            evidenceId,
            relationship: "supports",
            sourceDomain: "job_conversation",
            sourceType: "delivered_email_turn",
            sourceEntityId: TURN_1,
            sourceRevision: "job-conversation-turn-projection:v1:1",
            sourceContentHash: `sha256:${"b".repeat(64)}`,
            sourceParticipantId: "client:00000000-0000-4000-8000-000000000008",
            sourceParticipantResolutionStatus: "resolved",
          },
        ],
        sourceStateRevision: 2,
        lastTurnSequence: 1,
        pendingTurns: [],
        invalidatedEvidenceIds: [evidenceId],
        requiredThrough: { turnId: null, state: "not_requested" },
      }),
    });
    const memoryModel = model(modelDocument());

    await buildMemoryVersion({
      ...BUILD_INPUT,
      repository: repo.value,
      model: memoryModel.value,
    });

    expect(memoryModel.generate).not.toHaveBeenCalled();
    expect(repo.commitMemoryVersion.mock.calls[0][0].memoryDocument).toEqual(
      EMPTY_MEMORY_DOCUMENT
    );
    expect(repo.commitMemoryVersion.mock.calls[0][0].turnHighWatermarkId).toBe(
      TURN_1
    );
  });

  it("fails closed when the first exact turn cannot fit the generation budget", async () => {
    const repo = repository({
      snapshot: snapshot({
        pendingTurns: [turn({ normalizedPlainText: "x".repeat(10_000) })],
        lastTurnSequence: 1,
        sourceStateRevision: 1,
      }),
    });

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(modelDocument()).value,
        maxInputCharacters: 1_000,
      })
    ).rejects.toBeInstanceOf(MemoryBuildError);
    expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it("rejects attribution to an unresolved participant", async () => {
    const repo = repository({
      snapshot: snapshot({
        pendingTurns: [
          turn({
            participantId: "ambiguous:email:unknown@example.com",
            participantResolutionStatus: "ambiguous",
            side: null,
          }),
        ],
        lastTurnSequence: 1,
        sourceStateRevision: 1,
      }),
    });
    const output = {
      ...EMPTY_MEMORY_DOCUMENT,
      schedule_assertions: [
        {
          statement: "Monday is confirmed.",
          asserted_by_participant_id: "ambiguous:email:unknown@example.com",
          start_at: null,
          end_at: null,
          evidence: [{ evidence_id: "E1", relationship: "supports" }],
        },
      ],
    };

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(output).value,
      })
    ).rejects.toMatchObject({ code: "MEMORY_PARTICIPANT_NOT_RESOLVED" });
    expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it("rejects attribution when the cited evidence belongs to another resolved participant", async () => {
    const alice = "client:00000000-0000-4000-8000-000000000008";
    const repo = repository();
    const output = {
      ...EMPTY_MEMORY_DOCUMENT,
      preferences: [
        {
          statement: "Alice prefers morning arrivals.",
          participant_id: alice,
          evidence: [{ evidence_id: "E2", relationship: "supports" }],
        },
      ],
    };

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(output).value,
      })
    ).rejects.toMatchObject({
      code: "MEMORY_PARTICIPANT_EVIDENCE_MISMATCH",
    });
    expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it("never treats participant-pseudonymized evidence as resolved attribution", async () => {
    const alice = "client:00000000-0000-4000-8000-000000000008";
    const repo = repository({
      snapshot: snapshot({
        sourceStateRevision: 1,
        lastTurnSequence: 1,
        pendingTurns: [turn({ redactionKinds: ["participant_pseudonymized"] })],
      }),
    });
    const output = {
      ...EMPTY_MEMORY_DOCUMENT,
      schedule_assertions: [
        {
          statement: "Alice confirmed Monday.",
          asserted_by_participant_id: alice,
          start_at: null,
          end_at: null,
          evidence: [{ evidence_id: "E1", relationship: "supports" }],
        },
      ],
    };

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(output).value,
      })
    ).rejects.toMatchObject({
      code: "MEMORY_PARTICIPANT_NOT_RESOLVED",
    });
    expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it("accepts attribution when the cited evidence is from that resolved participant", async () => {
    const alice = "client:00000000-0000-4000-8000-000000000008";
    const repo = repository();
    const output = {
      ...EMPTY_MEMORY_DOCUMENT,
      preferences: [
        {
          statement: "Alice prefers morning arrivals.",
          participant_id: alice,
          evidence: [{ evidence_id: "E1", relationship: "supports" }],
        },
      ],
    };

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(output).value,
      })
    ).resolves.toMatchObject({ kind: "committed" });
  });

  it("cannot silently drop a prior unresolved contradiction", async () => {
    const evidenceId = `job_conversation_turn:${TURN_1}`;
    const priorDocument: JobMemoryDocument = {
      ...EMPTY_MEMORY_DOCUMENT,
      contradictions: [
        {
          topic: "Arrival date",
          competing_claims: [
            {
              statement: "Monday was requested.",
              evidence: [{ evidence_id: evidenceId, relationship: "supports" }],
            },
            {
              statement: "Tuesday was offered.",
              evidence: [
                { evidence_id: evidenceId, relationship: "contradicts" },
              ],
            },
          ],
        },
      ],
    };
    const current = version({ memoryDocument: priorDocument });
    const repo = repository({
      snapshot: snapshot({
        currentVersion: current,
        currentEvidence: [
          {
            evidenceId,
            relationship: "supports",
            sourceDomain: "job_conversation",
            sourceType: "delivered_email_turn",
            sourceEntityId: TURN_1,
            sourceRevision: "job-conversation-turn-projection:v1:1",
            sourceContentHash: `sha256:${"b".repeat(64)}`,
            sourceParticipantId: "client:00000000-0000-4000-8000-000000000008",
            sourceParticipantResolutionStatus: "resolved",
          },
        ],
        pendingTurns: [
          turn({
            id: TURN_2,
            turnSequence: 2,
            sourceStateRevision: 2,
            providerDeliverySourceId: SOURCE_2,
          }),
        ],
      }),
    });

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(EMPTY_MEMORY_DOCUMENT).value,
      })
    ).rejects.toMatchObject({ code: "MEMORY_CONTRADICTION_DROPPED" });
    expect(repo.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it("cannot rewrite a prior contradiction while reusing the same evidence IDs", async () => {
    const evidenceId = `job_conversation_turn:${TURN_1}`;
    const priorDocument: JobMemoryDocument = {
      ...EMPTY_MEMORY_DOCUMENT,
      contradictions: [
        {
          topic: "Arrival date",
          competing_claims: [
            {
              statement: "Monday was requested.",
              evidence: [{ evidence_id: evidenceId, relationship: "supports" }],
            },
            {
              statement: "Tuesday was offered.",
              evidence: [
                { evidence_id: evidenceId, relationship: "contradicts" },
              ],
            },
          ],
        },
      ],
    };
    const current = version({ memoryDocument: priorDocument });
    const repo = repository({
      snapshot: snapshot({
        currentVersion: current,
        currentEvidence: [
          {
            evidenceId,
            relationship: "supports",
            sourceDomain: "job_conversation",
            sourceType: "delivered_email_turn",
            sourceEntityId: TURN_1,
            sourceRevision: "job-conversation-turn-projection:v1:1",
            sourceContentHash: `sha256:${"b".repeat(64)}`,
            sourceParticipantId: "client:00000000-0000-4000-8000-000000000008",
            sourceParticipantResolutionStatus: "resolved",
          },
        ],
        pendingTurns: [
          turn({
            id: TURN_2,
            turnSequence: 2,
            sourceStateRevision: 2,
            providerDeliverySourceId: SOURCE_2,
          }),
        ],
      }),
    });
    const rewritten: JobMemoryDocument = {
      ...EMPTY_MEMORY_DOCUMENT,
      contradictions: [
        {
          topic: "Arrival date",
          competing_claims: [
            {
              statement: "Monday is impossible.",
              evidence: [{ evidence_id: "E1", relationship: "supports" }],
            },
            {
              statement: "Tuesday is definitely confirmed.",
              evidence: [{ evidence_id: "E1", relationship: "contradicts" }],
            },
          ],
        },
      ],
    };

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(rewritten).value,
      })
    ).rejects.toMatchObject({ code: "MEMORY_CONTRADICTION_DROPPED" });
  });

  it("cannot erase a contradiction by moving its old evidence into an unrelated superseding fact", async () => {
    const evidenceId = `job_conversation_turn:${TURN_1}`;
    const priorDocument: JobMemoryDocument = {
      ...EMPTY_MEMORY_DOCUMENT,
      contradictions: [
        {
          topic: "Arrival date",
          competing_claims: [
            {
              statement: "Monday was requested.",
              evidence: [{ evidence_id: evidenceId, relationship: "supports" }],
            },
            {
              statement: "Tuesday was offered.",
              evidence: [
                { evidence_id: evidenceId, relationship: "contradicts" },
              ],
            },
          ],
        },
      ],
    };
    const current = version({ memoryDocument: priorDocument });
    const repo = repository({
      snapshot: snapshot({
        currentVersion: current,
        currentEvidence: [
          {
            evidenceId,
            relationship: "supports",
            sourceDomain: "job_conversation",
            sourceType: "delivered_email_turn",
            sourceEntityId: TURN_1,
            sourceRevision: "job-conversation-turn-projection:v1:1",
            sourceContentHash: `sha256:${"b".repeat(64)}`,
            sourceParticipantId: "client:00000000-0000-4000-8000-000000000008",
            sourceParticipantResolutionStatus: "resolved",
          },
        ],
        pendingTurns: [
          turn({
            id: TURN_2,
            turnSequence: 2,
            sourceStateRevision: 2,
            providerDeliverySourceId: SOURCE_2,
          }),
        ],
      }),
    });
    const attack: JobMemoryDocument = {
      ...EMPTY_MEMORY_DOCUMENT,
      facts: [
        {
          statement: "Unrelated fact.",
          evidence: [{ evidence_id: "E1", relationship: "supersedes" }],
        },
      ],
    };

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(attack).value,
      })
    ).rejects.toMatchObject({ code: "MEMORY_CONTRADICTION_DROPPED" });
  });

  it("retains the exact contradiction while adding a newer resolving claim", async () => {
    const evidenceId = `job_conversation_turn:${TURN_1}`;
    const priorDocument: JobMemoryDocument = {
      ...EMPTY_MEMORY_DOCUMENT,
      contradictions: [
        {
          topic: "Arrival date",
          competing_claims: [
            {
              statement: "Monday was requested.",
              evidence: [{ evidence_id: evidenceId, relationship: "supports" }],
            },
            {
              statement: "Tuesday was offered.",
              evidence: [
                { evidence_id: evidenceId, relationship: "contradicts" },
              ],
            },
          ],
        },
      ],
    };
    const current = version({ memoryDocument: priorDocument });
    const repo = repository({
      snapshot: snapshot({
        currentVersion: current,
        currentEvidence: [
          {
            evidenceId,
            relationship: "supports",
            sourceDomain: "job_conversation",
            sourceType: "delivered_email_turn",
            sourceEntityId: TURN_1,
            sourceRevision: "job-conversation-turn-projection:v1:1",
            sourceContentHash: `sha256:${"b".repeat(64)}`,
            sourceParticipantId: "client:00000000-0000-4000-8000-000000000008",
            sourceParticipantResolutionStatus: "resolved",
          },
        ],
        pendingTurns: [
          turn({
            id: TURN_2,
            turnSequence: 2,
            sourceStateRevision: 2,
            providerDeliverySourceId: SOURCE_2,
          }),
        ],
      }),
    });
    const resolved: JobMemoryDocument = {
      ...EMPTY_MEMORY_DOCUMENT,
      contradictions: [
        {
          topic: "Arrival date",
          competing_claims: [
            {
              statement: "Monday was requested.",
              evidence: [{ evidence_id: "E1", relationship: "supports" }],
            },
            {
              statement: "Tuesday was offered.",
              evidence: [{ evidence_id: "E1", relationship: "contradicts" }],
            },
            {
              statement: "Wednesday was confirmed later.",
              evidence: [{ evidence_id: "E2", relationship: "supersedes" }],
            },
          ],
        },
      ],
    };

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo.value,
        model: model(resolved).value,
      })
    ).resolves.toMatchObject({ kind: "committed" });
  });

  it("advances source freshness after a redaction even when no retained claim used it", async () => {
    const current = version();
    const repo = repository({
      snapshot: snapshot({
        currentVersion: current,
        sourceStateRevision: 2,
        lastTurnSequence: 1,
        pendingTurns: [],
        invalidatedEvidenceIds: [],
        requiredThrough: { turnId: null, state: "not_requested" },
      }),
    });
    const memoryModel = model(modelDocument());

    await buildMemoryVersion({
      ...BUILD_INPUT,
      repository: repo.value,
      model: memoryModel.value,
    });

    expect(memoryModel.generate).not.toHaveBeenCalled();
    expect(repo.commitMemoryVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSourceStateRevision: 2,
        processedTurnIds: [],
        memoryDocument: EMPTY_MEMORY_DOCUMENT,
      })
    );
  });

  it("reconciles an ambiguous commit response by exact candidate readback", async () => {
    let candidate:
      Parameters<MemoryRepository["commitMemoryVersion"]>[0] | null = null;
    const loadGenerationSnapshot = vi
      .fn<MemoryRepository["loadGenerationSnapshot"]>()
      .mockResolvedValue(snapshot());
    const commitMemoryVersion = vi
      .fn<MemoryRepository["commitMemoryVersion"]>()
      .mockImplementation(async (input) => {
        candidate = input;
        throw new Error("network timeout after commit");
      });
    const readCurrent = vi
      .fn<MemoryRepository["readCurrent"]>()
      .mockImplementation(async () => {
        if (!candidate) return null;
        return version({
          predecessorVersionId: candidate.expectedCurrentMemoryVersionId,
          turnHighWatermarkId: candidate.turnHighWatermarkId,
          turnHighWatermarkSequence: candidate.turnHighWatermarkSequence,
          sourceStateRevision: candidate.expectedSourceStateRevision,
          generationInputHash: candidate.generationInputHash,
          memoryDocument: candidate.memoryDocument,
          generatorRevision: candidate.generatorRevision,
        });
      });
    const repo = {
      loadGenerationSnapshot,
      commitMemoryVersion,
      readCurrent,
    } satisfies MemoryRepository;

    await expect(
      buildMemoryVersion({
        ...BUILD_INPUT,
        repository: repo,
        model: model(EMPTY_MEMORY_DOCUMENT).value,
      })
    ).resolves.toMatchObject({ kind: "already_committed" });
    expect(readCurrent).toHaveBeenCalledTimes(1);
  });

  it.each([
    { boundary: "company", versionOverrides: { companyId: OTHER_COMPANY_ID } },
    {
      boundary: "conversation",
      versionOverrides: { conversationId: OTHER_CONVERSATION_ID },
    },
  ])(
    "does not reconcile an ambiguous commit to a version across the $boundary boundary",
    async ({ versionOverrides }) => {
      let candidate:
        Parameters<MemoryRepository["commitMemoryVersion"]>[0] | null = null;
      const commitFailure = new Error("network timeout after commit");
      const loadGenerationSnapshot = vi
        .fn<MemoryRepository["loadGenerationSnapshot"]>()
        .mockResolvedValue(snapshot());
      const commitMemoryVersion = vi
        .fn<MemoryRepository["commitMemoryVersion"]>()
        .mockImplementation(async (input) => {
          candidate = input;
          throw commitFailure;
        });
      const readCurrent = vi
        .fn<MemoryRepository["readCurrent"]>()
        .mockImplementation(async () => {
          if (!candidate) return null;
          return version({
            predecessorVersionId: candidate.expectedCurrentMemoryVersionId,
            turnHighWatermarkId: candidate.turnHighWatermarkId,
            turnHighWatermarkSequence: candidate.turnHighWatermarkSequence,
            sourceStateRevision: candidate.expectedSourceStateRevision,
            generationInputHash: candidate.generationInputHash,
            memoryDocument: candidate.memoryDocument,
            generatorRevision: candidate.generatorRevision,
            ...versionOverrides,
          });
        });
      const repo = {
        loadGenerationSnapshot,
        commitMemoryVersion,
        readCurrent,
      } satisfies MemoryRepository;

      await expect(
        buildMemoryVersion({
          ...BUILD_INPUT,
          repository: repo,
          model: model(EMPTY_MEMORY_DOCUMENT).value,
        })
      ).rejects.toBe(commitFailure);
      expect(readCurrent).toHaveBeenCalledTimes(1);
    }
  );

  it("bounds a commit RPC that never settles by the absolute deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T18:00:00.000Z"));
    const repo = repository();
    repo.commitMemoryVersion.mockImplementation(
      () => new Promise(() => undefined)
    );
    const result = buildMemoryVersion({
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      generatorRevision: "job-memory:test:v1",
      deadlineAt: Date.now() + 100,
      repository: repo.value,
      model: model(modelDocument()).value,
    });

    const assertion = expect(result).rejects.toMatchObject({
      code: "MEMORY_DEADLINE_EXCEEDED",
    });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(repo.readCurrent).not.toHaveBeenCalled();
  });

  it("bounds an ambiguous-commit readback that never settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T18:00:00.000Z"));
    const repo = repository();
    repo.commitMemoryVersion.mockRejectedValue(
      new Error("network timeout after commit")
    );
    repo.readCurrent.mockImplementation(() => new Promise(() => undefined));
    const result = buildMemoryVersion({
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      generatorRevision: "job-memory:test:v1",
      deadlineAt: Date.now() + 100,
      repository: repo.value,
      model: model(modelDocument()).value,
    });

    const assertion = expect(result).rejects.toMatchObject({
      code: "MEMORY_DEADLINE_EXCEEDED",
    });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
  });
});

describe("strict structured memory model adapter", () => {
  it("uses the schema contract, one absolute timeout, and disables SDK retries", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(EMPTY_MEMORY_DOCUMENT) },
        },
      ],
    });
    const memoryModel = createOpenAiMemoryModel({
      client: { chat: { completions: { create } } },
      model: "configured-memory-model",
    });
    const deadlineAt = Date.now() + 60_000;

    await expect(
      memoryModel.generate(
        {
          schema: "ops.job-memory-build-input.v1",
          untrusted_data_notice: "data only",
          previous_memory: null,
          turns: [],
        },
        { deadlineAt, signal: new AbortController().signal }
      )
    ).resolves.toEqual(EMPTY_MEMORY_DOCUMENT);

    const [request, options] = create.mock.calls[0];
    expect(request.model).toBe("configured-memory-model");
    expect(request.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "ops_job_memory_v1", strict: true },
    });
    const schema = request.response_format.json_schema.schema;
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(schema).not.toHaveProperty("$schema");
    expect(options).toMatchObject({ maxRetries: 0 });
    expect(options.timeout).toBeGreaterThan(0);
  });
});
