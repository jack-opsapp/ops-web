import { buildMemoryVersion, type MemoryModel } from "./build-memory-version";
import { withinMemoryDeadline } from "./memory-deadline";
import type { MemoryRepository, MemoryVersion } from "./memory-repository";

const MAX_CATCH_UP_ATTEMPTS = 100;

export class StaleMemoryContextError extends Error {
  readonly code = "STALE_CONTEXT" as const;
  readonly currentMemoryVersion: number | null;
  readonly currentTurnHighWatermarkId: string | null;

  constructor(current: MemoryVersion | null, options?: ErrorOptions) {
    super("STALE_CONTEXT", options);
    this.name = "StaleMemoryContextError";
    this.currentMemoryVersion = current?.versionNumber ?? null;
    this.currentTurnHighWatermarkId = current?.turnHighWatermarkId ?? null;
  }
}

export async function catchUpMemory(input: {
  readonly repository: MemoryRepository;
  readonly model: MemoryModel;
  readonly companyId: string;
  readonly conversationId: string;
  readonly requiredThroughTurnId: string;
  readonly generatorRevision: string;
  readonly deadlineAt: number;
  readonly maxTurns?: number;
  readonly maxInputCharacters?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}): Promise<MemoryVersion> {
  const now = input.now ?? Date.now;
  let current: MemoryVersion | null = null;

  try {
    for (let attempt = 0; attempt < MAX_CATCH_UP_ATTEMPTS; attempt += 1) {
      assertDeadline(input.deadlineAt, now, input.signal);
      const snapshot = await withinMemoryDeadline(
        (signal) =>
          input.repository.loadGenerationSnapshot({
            companyId: input.companyId,
            conversationId: input.conversationId,
            requiredThroughTurnId: input.requiredThroughTurnId,
            maxTurns: input.maxTurns ?? 50,
            signal,
          }),
        { deadlineAt: input.deadlineAt, signal: input.signal, now }
      );
      current = snapshot.currentVersion;
      assertDeadline(input.deadlineAt, now, input.signal);

      if (snapshot.requiredThrough.state === "missing") {
        throw new StaleMemoryContextError(current);
      }
      if (
        snapshot.requiredThrough.state === "summarized" &&
        snapshot.currentVersion
      ) {
        return snapshot.currentVersion;
      }

      const result = await buildMemoryVersion({
        repository: input.repository,
        model: input.model,
        companyId: input.companyId,
        conversationId: input.conversationId,
        requiredThroughTurnId: input.requiredThroughTurnId,
        generatorRevision: input.generatorRevision,
        deadlineAt: input.deadlineAt,
        maxTurns: input.maxTurns,
        maxInputCharacters: input.maxInputCharacters,
        signal: input.signal,
        now,
        snapshot,
      });
      current = result.kind === "conflict" ? result.current : result.version;
    }
    throw new StaleMemoryContextError(current);
  } catch (error) {
    if (error instanceof StaleMemoryContextError) throw error;
    if (now() < input.deadlineAt && !input.signal?.aborted) {
      try {
        current = await withinMemoryDeadline(
          (signal) =>
            input.repository.readCurrent({
              companyId: input.companyId,
              conversationId: input.conversationId,
              signal,
            }),
          { deadlineAt: input.deadlineAt, signal: input.signal, now }
        );
      } catch {
        // The stale error retains the last exact marker already observed.
      }
    }
    throw new StaleMemoryContextError(current, { cause: error });
  }
}

function assertDeadline(
  deadlineAt: number,
  now: () => number,
  signal: AbortSignal | undefined
): void {
  if (!Number.isFinite(deadlineAt) || now() >= deadlineAt || signal?.aborted) {
    throw new StaleMemoryContextError(null);
  }
}
