/**
 * DeckDesignService — the three read lanes, and the projection each one owns.
 *
 * Contract under test:
 *   - `fetchForOpportunity` / `fetchForProject` keep the SCAN projection: the
 *     glyph needs vertices + edges, never the whole `drawing_data` blob.
 *   - `fetchDesignWithDrawing` is the VIEWER lane: it selects `drawing_data`
 *     whole, because multi-level designs keep their geometry under `levels[]`
 *     with empty root arrays (bug b130d23f) and the narrow projection reads
 *     those as an empty drawing.
 *   - `fetchForProject` reads by `deck_designs.project_id` (report acc0d021),
 *     excludes soft-deleted rows, and orders newest first.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/supabase/helpers")
  >("@/lib/supabase/helpers");
  return { ...actual, requireSupabase: requireSupabaseMock };
});

import { DeckDesignService } from "@/lib/api/services/deck-design-service";

interface RecordedQuery {
  table: string;
  select: string;
  eq: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  not: Array<[string, string, unknown]>;
  order: Array<[string, unknown]>;
  maybeSingle: boolean;
}

function stubSupabase(result: { data: unknown; error: unknown }) {
  const recorded: RecordedQuery = {
    table: "",
    select: "",
    eq: [],
    is: [],
    not: [],
    order: [],
    maybeSingle: false,
  };

  const builder = {
    select(columns: string) {
      recorded.select = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      recorded.eq.push([column, value]);
      return builder;
    },
    is(column: string, value: unknown) {
      recorded.is.push([column, value]);
      return builder;
    },
    not(column: string, operator: string, value: unknown) {
      recorded.not.push([column, operator, value]);
      return builder;
    },
    order(column: string, options: unknown) {
      recorded.order.push([column, options]);
      return builder;
    },
    maybeSingle() {
      recorded.maybeSingle = true;
      return Promise.resolve(result);
    },
    then(
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };

  requireSupabaseMock.mockReturnValue({
    from(table: string) {
      recorded.table = table;
      return builder;
    },
  });

  return recorded;
}

const ROW = {
  id: "deck-1",
  title: "Back deck — cedar",
  thumbnail_url: null,
  version: 3,
  project_id: "project-1",
  created_at: "2026-07-01T12:00:00.000Z",
  updated_at: "2026-07-13T12:00:00.000Z",
};

beforeEach(() => {
  requireSupabaseMock.mockReset();
});

describe("DeckDesignService.fetchForOpportunity", () => {
  it("keeps the narrow scan projection — vertices and edges only", async () => {
    const recorded = stubSupabase({
      data: [{ ...ROW, vertices: [], edges: [] }],
      error: null,
    });

    await DeckDesignService.fetchForOpportunity("opp-1");

    expect(recorded.table).toBe("deck_designs");
    expect(recorded.select).toBe(
      "id, title, thumbnail_url, version, project_id, created_at, updated_at, vertices:drawing_data->vertices, edges:drawing_data->edges",
    );
    expect(recorded.select).not.toContain("drawing_data,");
    expect(recorded.eq).toEqual([["opportunity_id", "opp-1"]]);
    expect(recorded.is).toEqual([["deleted_at", null]]);
  });
});

describe("DeckDesignService.fetchForProject", () => {
  it("reads decks attached to a project, newest first, excluding deleted", async () => {
    const recorded = stubSupabase({
      data: [{ ...ROW, vertices: [], edges: [] }],
      error: null,
    });

    const designs = await DeckDesignService.fetchForProject("project-1");

    expect(recorded.table).toBe("deck_designs");
    expect(recorded.select).toBe(
      "id, title, thumbnail_url, version, project_id, created_at, updated_at, vertices:drawing_data->vertices, edges:drawing_data->edges",
    );
    expect(recorded.eq).toEqual([["project_id", "project-1"]]);
    expect(recorded.is).toEqual([["deleted_at", null]]);
    expect(recorded.order).toEqual([
      ["updated_at", { ascending: false, nullsFirst: false }],
    ]);
    expect(designs).toHaveLength(1);
    expect(designs[0]!.id).toBe("deck-1");
    expect(designs[0]!.version).toBe(3);
  });

  it("throws with the project id when the read fails", async () => {
    stubSupabase({ data: null, error: { message: "boom" } });

    await expect(
      DeckDesignService.fetchForProject("project-9"),
    ).rejects.toThrow(/project-9/);
  });
});

describe("DeckDesignService.fetchDesignWithDrawing", () => {
  it("selects the whole drawing_data blob for the viewer", async () => {
    const drawing = {
      scaleFactor: 2,
      levels: [{ id: "level-1", vertices: [], edges: [], surfaces: [] }],
      vertices: [],
      edges: [],
    };
    const recorded = stubSupabase({
      data: { ...ROW, drawing_data: drawing },
      error: null,
    });

    const design = await DeckDesignService.fetchDesignWithDrawing("deck-1");

    expect(recorded.table).toBe("deck_designs");
    expect(recorded.select).toBe(
      "id, title, thumbnail_url, version, project_id, created_at, updated_at, drawing_data",
    );
    expect(recorded.eq).toEqual([["id", "deck-1"]]);
    expect(recorded.is).toEqual([["deleted_at", null]]);
    expect(recorded.maybeSingle).toBe(true);
    expect(design?.drawingData).toEqual(drawing);
    expect(design?.title).toBe("Back deck — cedar");
    expect(design?.projectId).toBe("project-1");
  });

  it("returns null when the row is gone", async () => {
    stubSupabase({ data: null, error: null });
    await expect(
      DeckDesignService.fetchDesignWithDrawing("missing"),
    ).resolves.toBeNull();
  });

  it("throws with the design id when the read fails", async () => {
    stubSupabase({ data: null, error: { message: "boom" } });
    await expect(
      DeckDesignService.fetchDesignWithDrawing("deck-7"),
    ).rejects.toThrow(/deck-7/);
  });
});
