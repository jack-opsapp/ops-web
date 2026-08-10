import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemoryModel } from "../build-memory-version";
import { catchUpMemory, StaleMemoryContextError } from "../catch-up-memory";
import { EMPTY_MEMORY_DOCUMENT } from "../memory-schema";
import type {
  MemoryGenerationSnapshot,
  MemoryRepository,
  MemoryVersion,
} from "../memory-repository";

const COMPANY_ID = "00000000-0000-4000-8000-000000000101";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000102";
const TURN_ID = "00000000-0000-4000-8000-000000000103";
const VERSION_ID = "00000000-0000-4000-8000-000000000104";

function currentVersion(): MemoryVersion {
  return {
    id: VERSION_ID,
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    versionNumber: 1,
    predecessorVersionId: null,
    turnHighWatermarkId: TURN_ID,
    turnHighWatermarkSequence: 1,
    sourceStateRevision: 1,
    generationInputHash: `sha256:${"a".repeat(64)}`,
    memoryDocument: EMPTY_MEMORY_DOCUMENT,
    memoryDocumentHash: `sha256:${"b".repeat(64)}`,
    generatorRevision: "job-memory:test:v1",
    createdAt: "2026-08-07T18:01:00.000Z",
  };
}

function pendingSnapshot(): MemoryGenerationSnapshot {
  return {
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    sourceStateRevision: 1,
    lastTurnSequence: 1,
    currentVersion: null,
    currentEvidence: [],
    pendingTurns: [
      {
        id: TURN_ID,
        turnSequence: 1,
        sourceStateRevision: 1,
        side: "user",
        participantId: "client:00000000-0000-4000-8000-000000000105",
        participantResolutionStatus: "resolved",
        direction: "inbound",
        channel: "email",
        deliveredAt: "2026-08-07T18:00:00.000Z",
        ingestedAt: "2026-08-07T18:00:01.000Z",
        subject: "Question",
        normalizedPlainText: "Can you confirm Monday?",
        attachmentEvidenceIds: [],
        providerDeliverySourceId: "00000000-0000-4000-8000-000000000106",
        providerDeliverySourceSha256: `sha256:${"c".repeat(64)}`,
        evidenceSourceRevision: "job-conversation-turn-projection:v1:1",
        evidenceContentHash: `sha256:${"d".repeat(64)}`,
        redactionKinds: [],
      },
    ],
    invalidatedEvidenceIds: [],
    requiredThrough: { turnId: TURN_ID, state: "pending" },
  };
}

const emptyModel: MemoryModel = {
  generate: vi.fn().mockResolvedValue(EMPTY_MEMORY_DOCUMENT),
};

describe("source-bound memory catch-up", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns only after memory is current through the required delivered turn", async () => {
    const committed = currentVersion();
    const loadGenerationSnapshot = vi
      .fn<MemoryRepository["loadGenerationSnapshot"]>()
      .mockResolvedValueOnce(pendingSnapshot())
      .mockResolvedValueOnce({
        ...pendingSnapshot(),
        currentVersion: committed,
        currentEvidence: [],
        pendingTurns: [],
        requiredThrough: { turnId: TURN_ID, state: "summarized" },
      });
    const repository: MemoryRepository = {
      loadGenerationSnapshot,
      commitMemoryVersion: vi
        .fn<MemoryRepository["commitMemoryVersion"]>()
        .mockResolvedValue({ kind: "committed", version: committed }),
      readCurrent: vi.fn().mockResolvedValue(committed),
    };

    await expect(
      catchUpMemory({
        repository,
        model: emptyModel,
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        requiredThroughTurnId: TURN_ID,
        generatorRevision: "job-memory:test:v1",
        deadlineAt: Date.now() + 60_000,
      })
    ).resolves.toEqual(committed);
    expect(loadGenerationSnapshot).toHaveBeenCalledTimes(2);
  });

  it("reloads the winning pointer after an optimistic conflict", async () => {
    const winner = currentVersion();
    const loadGenerationSnapshot = vi
      .fn<MemoryRepository["loadGenerationSnapshot"]>()
      .mockResolvedValueOnce(pendingSnapshot())
      .mockResolvedValueOnce({
        ...pendingSnapshot(),
        currentVersion: winner,
        pendingTurns: [],
        requiredThrough: { turnId: TURN_ID, state: "summarized" },
      });
    const repository: MemoryRepository = {
      loadGenerationSnapshot,
      commitMemoryVersion: vi
        .fn<MemoryRepository["commitMemoryVersion"]>()
        .mockResolvedValue({ kind: "conflict", current: winner }),
      readCurrent: vi.fn().mockResolvedValue(winner),
    };

    await expect(
      catchUpMemory({
        repository,
        model: emptyModel,
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        requiredThroughTurnId: TURN_ID,
        generatorRevision: "job-memory:test:v1",
        deadlineAt: Date.now() + 60_000,
      })
    ).resolves.toEqual(winner);
    expect(loadGenerationSnapshot).toHaveBeenCalledTimes(2);
  });

  it("returns typed STALE_CONTEXT when the one absolute deadline is exhausted", async () => {
    const repository: MemoryRepository = {
      loadGenerationSnapshot: vi.fn(),
      commitMemoryVersion: vi.fn(),
      readCurrent: vi.fn().mockResolvedValue(null),
    };

    await expect(
      catchUpMemory({
        repository,
        model: emptyModel,
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        requiredThroughTurnId: TURN_ID,
        generatorRevision: "job-memory:test:v1",
        deadlineAt: 999,
        now: () => 1_000,
      })
    ).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    expect(repository.loadGenerationSnapshot).not.toHaveBeenCalled();
  });

  it("never converts a model failure into apparently current empty memory", async () => {
    const repository: MemoryRepository = {
      loadGenerationSnapshot: vi.fn().mockResolvedValue(pendingSnapshot()),
      commitMemoryVersion: vi.fn(),
      readCurrent: vi.fn().mockResolvedValue(null),
    };
    const model: MemoryModel = {
      generate: vi.fn().mockRejectedValue(new Error("model failed")),
    };

    await expect(
      catchUpMemory({
        repository,
        model,
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        requiredThroughTurnId: TURN_ID,
        generatorRevision: "job-memory:test:v1",
        deadlineAt: Date.now() + 60_000,
      })
    ).rejects.toBeInstanceOf(StaleMemoryContextError);
    expect(repository.commitMemoryVersion).not.toHaveBeenCalled();
  });

  it("returns STALE_CONTEXT on time when the snapshot read never settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T18:00:00.000Z"));
    const repository: MemoryRepository = {
      loadGenerationSnapshot: vi.fn(
        () => new Promise<MemoryGenerationSnapshot>(() => undefined)
      ),
      commitMemoryVersion: vi.fn(),
      readCurrent: vi.fn(),
    };
    const result = catchUpMemory({
      repository,
      model: emptyModel,
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      requiredThroughTurnId: TURN_ID,
      generatorRevision: "job-memory:test:v1",
      deadlineAt: Date.now() + 100,
    });

    const assertion = expect(result).rejects.toMatchObject({
      code: "STALE_CONTEXT",
    });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(repository.commitMemoryVersion).not.toHaveBeenCalled();
    expect(repository.readCurrent).not.toHaveBeenCalled();
  });

  it("returns STALE_CONTEXT immediately when the caller aborts a stalled read", async () => {
    const controller = new AbortController();
    const repository: MemoryRepository = {
      loadGenerationSnapshot: vi.fn(
        () => new Promise<MemoryGenerationSnapshot>(() => undefined)
      ),
      commitMemoryVersion: vi.fn(),
      readCurrent: vi.fn(),
    };
    const result = catchUpMemory({
      repository,
      model: emptyModel,
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      requiredThroughTurnId: TURN_ID,
      generatorRevision: "job-memory:test:v1",
      deadlineAt: Date.now() + 60_000,
      signal: controller.signal,
    });

    const assertion = expect(result).rejects.toMatchObject({
      code: "STALE_CONTEXT",
    });
    controller.abort("caller cancelled");
    await assertion;
    expect(repository.commitMemoryVersion).not.toHaveBeenCalled();
  });
});
