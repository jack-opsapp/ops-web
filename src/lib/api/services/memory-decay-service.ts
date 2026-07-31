import type { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
} from "./cron-workload-cursor-service";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
  type CronWorkloadLease,
} from "./cron-workload-control-service";

type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>;

export const MEMORY_DECAY_BATCH_SIZE = 100;
export const MEMORY_PRUNE_BATCH_SIZE = 100;
export const MEMORY_CONSOLIDATION_PAGE_SIZE = 20;

const MEMORY_WORKLOAD_KEY = "memory-decay";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MemoryDecayStats {
  decayed: number;
  pruned: number;
  consolidated: number;
  errors: string[];
}

interface MemoryDecayCursor {
  decayAfterId?: string;
  pruneAfterId?: string;
  consolidationCompanyId?: string;
  consolidationMemoryAfterId?: string;
}

interface DatabaseResult<T> {
  data: T;
  error: unknown;
}

interface DecayMemory {
  id: string;
  category: string;
  decay_score: number | null;
  last_accessed_at: string | null;
  created_at: string;
  due_date: string | null;
  resolved_at: string | null;
}

interface PruneMemory {
  id: string;
  category: string;
  due_date: string | null;
  resolved_at: string | null;
}

interface ConsolidationMemory {
  id: string;
  category?: string;
  content?: string;
  confidence: number | null;
  access_count: number | null;
  embedding: number[] | string | null;
  decay_score: number | null;
}

async function checkedDatabaseResult<T>(
  operation: string,
  pending: PromiseLike<DatabaseResult<T>>
): Promise<T> {
  let result: DatabaseResult<T>;
  try {
    result = await pending;
  } catch (cause) {
    throw new CronDatabaseOperationError(
      `Memory maintenance ${operation} was unreachable`,
      { cause }
    );
  }
  if (result.error) {
    throw new CronDatabaseOperationError(
      `Memory maintenance ${operation} failed`,
      { cause: result.error }
    );
  }
  return result.data;
}

function parseCursor(raw: string | null): MemoryDecayCursor {
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("cursor must be an object");
    }
    return parsed as MemoryDecayCursor;
  } catch (cause) {
    throw new CronDatabaseOperationError(
      "Memory maintenance cursor is invalid",
      { cause }
    );
  }
}

function serializeCursor(cursor: MemoryDecayCursor): string | null {
  const encoded = JSON.stringify(cursor);
  return encoded === "{}" ? null : encoded;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function shouldProtectCommitment(
  memory: Pick<
    DecayMemory,
    "category" | "due_date" | "resolved_at"
  >,
  graceWindowIso: string
): boolean {
  return (
    memory.category === "commitment" &&
    memory.resolved_at === null &&
    (memory.due_date === null || memory.due_date >= graceWindowIso)
  );
}

function parseEmbedding(value: number[] | string | null): number[] | null {
  if (Array.isArray(value)) {
    return value.every((component) => Number.isFinite(component))
      ? value
      : null;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) &&
      parsed.every(
        (component) =>
          typeof component === "number" && Number.isFinite(component)
      )
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(
  leftValue: number[] | string | null,
  rightValue: number[] | string | null
): number {
  const left = parseEmbedding(leftValue);
  const right = parseEmbedding(rightValue);
  if (!left || !right || left.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

async function decayMemoryPage({
  supabase,
  cursor,
  stats,
  graceWindowIso,
}: {
  supabase: ServiceRoleClient;
  cursor: MemoryDecayCursor;
  stats: MemoryDecayStats;
  graceWindowIso: string;
}): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS).toISOString();
  let query = supabase
    .from("agent_memories")
    .select(
      "id, category, decay_score, last_accessed_at, created_at, due_date, resolved_at"
    )
    .gt("decay_score", 0.1)
    .or(
      `last_accessed_at.lt.${thirtyDaysAgo},` +
        `and(last_accessed_at.is.null,created_at.lt.${thirtyDaysAgo})`
    )
    .order("id", { ascending: true });
  if (cursor.decayAfterId) {
    query = query.gt("id", cursor.decayAfterId);
  }
  const staleRows = await checkedDatabaseResult<DecayMemory[] | null>(
    "decay page read",
    query.limit(MEMORY_DECAY_BATCH_SIZE)
  );
  const staleMemories = (staleRows ?? []).slice(
    0,
    MEMORY_DECAY_BATCH_SIZE
  );

  for (const memory of staleMemories) {
    if (shouldProtectCommitment(memory, graceWindowIso)) continue;
    const referenceDate = memory.last_accessed_at ?? memory.created_at;
    const daysSinceAccess = Math.floor(
      (Date.now() - new Date(referenceDate).getTime()) / DAY_MS
    );
    const daysOverThreshold = daysSinceAccess - 30;
    if (daysOverThreshold <= 0) continue;

    const currentScore = memory.decay_score ?? 1;
    const newScore = currentScore * Math.pow(0.95, daysOverThreshold);
    if (Math.abs(newScore - currentScore) < 0.001) continue;

    await checkedDatabaseResult(
      `decay update for ${memory.id}`,
      supabase
        .from("agent_memories")
        .update({ decay_score: Math.max(0, newScore) })
        .eq("id", memory.id)
    );
    stats.decayed += 1;
  }

  cursor.decayAfterId =
    staleMemories.length === MEMORY_DECAY_BATCH_SIZE
      ? staleMemories.at(-1)?.id
      : undefined;
}

async function pruneMemoryPage({
  supabase,
  cursor,
  stats,
  graceWindowIso,
}: {
  supabase: ServiceRoleClient;
  cursor: MemoryDecayCursor;
  stats: MemoryDecayStats;
  graceWindowIso: string;
}): Promise<void> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  let query = supabase
    .from("agent_memories")
    .select("id, category, due_date, resolved_at")
    .lt("decay_score", 0.1)
    .lt("created_at", sixMonthsAgo.toISOString())
    .order("id", { ascending: true });
  if (cursor.pruneAfterId) {
    query = query.gt("id", cursor.pruneAfterId);
  }
  const targetRows = await checkedDatabaseResult<PruneMemory[] | null>(
    "prune page read",
    query.limit(MEMORY_PRUNE_BATCH_SIZE)
  );
  const pruneTargets = (targetRows ?? []).slice(
    0,
    MEMORY_PRUNE_BATCH_SIZE
  );
  const pruneIds = pruneTargets
    .filter(
      (memory) => !shouldProtectCommitment(memory, graceWindowIso)
    )
    .map((memory) => memory.id);

  if (pruneIds.length > 0) {
    await checkedDatabaseResult(
      "prune delete",
      supabase.from("agent_memories").delete().in("id", pruneIds)
    );
    stats.pruned += pruneIds.length;
  }

  cursor.pruneAfterId =
    pruneTargets.length === MEMORY_PRUNE_BATCH_SIZE
      ? pruneTargets.at(-1)?.id
      : undefined;
}

async function resolveConsolidationCompany(
  supabase: ServiceRoleClient,
  cursor: MemoryDecayCursor
): Promise<string | null> {
  if (
    cursor.consolidationCompanyId &&
    cursor.consolidationMemoryAfterId
  ) {
    return cursor.consolidationCompanyId;
  }

  let query = supabase
    .from("agent_memories")
    .select("company_id")
    .not("embedding", "is", null)
    .order("company_id", { ascending: true })
    .order("id", { ascending: true });
  if (cursor.consolidationCompanyId) {
    query = query.gt(
      "company_id",
      cursor.consolidationCompanyId
    );
  }
  const rows = await checkedDatabaseResult<
    Array<{ company_id: string }> | null
  >("consolidation company read", query.limit(1));
  return rows?.[0]?.company_id ?? null;
}

async function consolidateMemoryPage({
  supabase,
  cursor,
  stats,
}: {
  supabase: ServiceRoleClient;
  cursor: MemoryDecayCursor;
  stats: MemoryDecayStats;
}): Promise<void> {
  const companyId = await resolveConsolidationCompany(
    supabase,
    cursor
  );
  if (!companyId) {
    cursor.consolidationCompanyId = undefined;
    cursor.consolidationMemoryAfterId = undefined;
    return;
  }

  let query = supabase
    .from("agent_memories")
    .select(
      "id, category, content, confidence, access_count, embedding, decay_score"
    )
    .eq("company_id", companyId)
    .not("embedding", "is", null)
    .gt("decay_score", 0.1)
    .order("id", { ascending: true });
  if (
    cursor.consolidationCompanyId === companyId &&
    cursor.consolidationMemoryAfterId
  ) {
    query = query.gt(
      "id",
      cursor.consolidationMemoryAfterId
    );
  }
  const memoryRows = await checkedDatabaseResult<
    ConsolidationMemory[] | null
  >(
    "consolidation memory page read",
    query.limit(MEMORY_CONSOLIDATION_PAGE_SIZE)
  );
  const memories = (memoryRows ?? []).slice(
    0,
    MEMORY_CONSOLIDATION_PAGE_SIZE
  );
  const mergedIds = new Set<string>();

  for (let leftIndex = 0; leftIndex < memories.length; leftIndex += 1) {
    const left = memories[leftIndex];
    if (mergedIds.has(left.id)) continue;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < memories.length;
      rightIndex += 1
    ) {
      const right = memories[rightIndex];
      if (
        mergedIds.has(right.id) ||
        cosineSimilarity(left.embedding, right.embedding) <= 0.95
      ) {
        continue;
      }

      const leftConfidence = left.confidence ?? 0;
      const rightConfidence = right.confidence ?? 0;
      const primary =
        rightConfidence > leftConfidence ? right : left;
      const duplicate = primary === left ? right : left;
      const mergedAccessCount =
        (primary.access_count ?? 0) +
        (duplicate.access_count ?? 0);
      const mergedConfidence = Math.max(
        primary.confidence ?? 0,
        duplicate.confidence ?? 0
      );

      await checkedDatabaseResult(
        `consolidation update for ${primary.id}`,
        supabase
          .from("agent_memories")
          .update({
            access_count: mergedAccessCount,
            confidence: mergedConfidence,
            last_accessed_at: new Date().toISOString(),
          })
          .eq("id", primary.id)
      );
      await checkedDatabaseResult(
        `consolidation delete for ${duplicate.id}`,
        supabase
          .from("agent_memories")
          .delete()
          .eq("id", duplicate.id)
      );

      primary.access_count = mergedAccessCount;
      primary.confidence = mergedConfidence;
      mergedIds.add(duplicate.id);
      stats.consolidated += 1;
      if (duplicate === left) break;
    }
  }

  cursor.consolidationCompanyId = companyId;
  cursor.consolidationMemoryAfterId =
    memories.length === MEMORY_CONSOLIDATION_PAGE_SIZE
      ? memories.at(-1)?.id
      : undefined;
}

export async function runMemoryDecayMaintenance(
  supabase: ServiceRoleClient,
  lease: CronWorkloadLease
): Promise<MemoryDecayStats> {
  const expectedCursor = await readCronWorkloadCursor(
    supabase,
    MEMORY_WORKLOAD_KEY,
    lease
  );
  const cursor = parseCursor(expectedCursor);
  const stats: MemoryDecayStats = {
    decayed: 0,
    pruned: 0,
    consolidated: 0,
    errors: [],
  };
  const graceWindowIso = new Date(
    Date.now() - 7 * DAY_MS
  ).toISOString();

  for (const [phase, work] of [
    [
      "Decay",
      () =>
        decayMemoryPage({
          supabase,
          cursor,
          stats,
          graceWindowIso,
        }),
    ],
    [
      "Prune",
      () =>
        pruneMemoryPage({
          supabase,
          cursor,
          stats,
          graceWindowIso,
        }),
    ],
    [
      "Consolidation",
      () => consolidateMemoryPage({ supabase, cursor, stats }),
    ],
  ] as const) {
    try {
      await work();
    } catch (error) {
      if (isDatabasePressureError(error)) throw error;
      stats.errors.push(`${phase} failed: ${errorMessage(error)}`);
    }
  }

  await advanceCronWorkloadCursor(
    supabase,
    MEMORY_WORKLOAD_KEY,
    lease,
    expectedCursor,
    serializeCursor(cursor)
  );
  return stats;
}
