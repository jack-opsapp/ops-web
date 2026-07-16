import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  rows: {
    agent_memories: [] as Row[],
    agent_knowledge_graph: [] as Row[],
    graph_entities: [] as Row[],
  },
  incrementedIds: [] as string[],
}));

vi.mock("@/lib/api/services/openai-clients", () => ({
  getSyncOpenAI: () => ({
    embeddings: {
      create: vi.fn(async () => ({
        data: [{ embedding: Array.from({ length: 1536 }, () => 0.01) }],
      })),
    },
  }),
}));

function query(table: keyof typeof state.rows) {
  const filters: Array<(row: Row) => boolean> = [];
  let limitCount: number | null = null;
  const builder: Record<string, unknown> = {};
  const matchingRows = () => {
    let rows = state.rows[table].filter((row) =>
      filters.every((filter) => filter(row))
    );
    if (limitCount !== null) rows = rows.slice(0, limitCount);
    return rows;
  };
  builder.select = () => builder;
  builder.eq = (column: string, value: unknown) => {
    filters.push((row) => row[column] === value);
    return builder;
  };
  builder.gt = (column: string, value: number) => {
    filters.push((row) => Number(row[column] ?? 0) > value);
    return builder;
  };
  builder.in = (column: string, values: unknown[]) => {
    const allowed = new Set(values);
    filters.push((row) => allowed.has(row[column]));
    return builder;
  };
  builder.is = (column: string, value: unknown) => {
    filters.push((row) => row[column] === value);
    return builder;
  };
  builder.order = () => builder;
  builder.limit = (count: number) => {
    limitCount = count;
    return builder;
  };
  builder.then = (resolve: (value: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve({ data: matchingRows(), error: null }).then(resolve);
  return builder;
}

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: keyof typeof state.rows) => query(table),
    rpc: async (name: string, params: Record<string, unknown>) => {
      if (name === "increment_access_count") {
        state.incrementedIds = params.memory_ids as string[];
        return { data: null, error: null };
      }
      if (name === "match_memories") {
        return {
          data: state.rows.agent_memories.map((row) => ({
            id: row.id,
            memory_type: row.memory_type,
            category: row.category,
            content: row.content,
            confidence: row.confidence,
            source: row.source,
          })),
          error: null,
        };
      }
      return { data: null, error: null };
    },
  }),
}));

import { MemoryService } from "@/lib/api/services/memory-service";

function memory(
  id: string,
  userId: string,
  sourceId: string,
  category: string,
  content: string
): Row {
  return {
    id,
    company_id: "company-1",
    user_id: userId,
    source_id: sourceId,
    memory_type: "fact",
    category,
    content,
    confidence: 0.9,
    source: "email",
    decay_score: 1,
  };
}

beforeEach(() => {
  state.incrementedIds = [];
  state.rows.agent_knowledge_graph = [
    {
      id: "graph-unrelated",
      company_id: "company-1",
      subject_id: "jordan@example.com",
      valid_to: null,
      properties: { secret: "UNRELATED_GRAPH_HISTORY" },
    },
  ];
  state.rows.graph_entities = [];
  state.rows.agent_memories = [
    memory(
      "memory-exact-limitation",
      "user-1",
      "provider-thread-canonical",
      "limitation",
      "EXACT_ACTOR_LIMITATION"
    ),
    memory(
      "memory-exact-pricing",
      "user-1",
      "message-canonical",
      "pricing",
      "EXACT_ACTOR_PRICE"
    ),
    memory(
      "memory-other-source",
      "user-1",
      "provider-thread-unrelated",
      "pricing",
      "UNRELATED_ACTOR_PRICE"
    ),
    memory(
      "memory-other-actor",
      "user-2",
      "provider-thread-canonical",
      "pricing",
      "OTHER_ACTOR_PRICE"
    ),
  ];
});

describe("MemoryService actor-scoped draft context", () => {
  it("returns only the actor's exact lead/thread evidence", async () => {
    const result = await MemoryService.getContextForDraft(
      "company-1",
      "jordan@example.com",
      "Exact assigned inquiry",
      {
        actorUserId: "user-1",
        exactSourceIds: ["provider-thread-canonical", "message-canonical"],
        includeClientHistory: false,
      }
    );

    expect(result.relevantFacts.map((fact) => fact.id).sort()).toEqual([
      "memory-exact-limitation",
      "memory-exact-pricing",
    ]);
    expect(result.pricingReferences).toEqual(["EXACT_ACTOR_PRICE"]);
    expect(result.clientHistory).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("UNRELATED_ACTOR_PRICE");
    expect(JSON.stringify(result)).not.toContain("OTHER_ACTOR_PRICE");
    expect(JSON.stringify(result)).not.toContain("UNRELATED_GRAPH_HISTORY");
    expect(state.incrementedIds.sort()).toEqual([
      "memory-exact-limitation",
      "memory-exact-pricing",
    ]);
  });
});
