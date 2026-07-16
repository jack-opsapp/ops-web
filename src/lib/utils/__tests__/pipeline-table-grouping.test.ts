/**
 * Tests for the pure flattened-grouping model + per-stage rollups that feed the
 * pipeline table's optional GROUP-by-stage render path.
 *
 * The table interleaves group-header items with data items into a SINGLE
 * flattened stream so one virtualizer can render both — the safe pattern for
 * grouped + virtualized lists. These tests pin the math (rollups) and the
 * flattening contract (ordering, collapse behavior, immutability).
 *
 * Fixtures are intentionally tiny and span multiple stages, deliberately out of
 * sort order in the input, so ordering guarantees are actually exercised. One
 * row carries a `null` estimatedValue/weightedValue to prove null→0 in sums.
 */

import { describe, it, expect } from "vitest";

import {
  OpportunityStage,
  OPPORTUNITY_STAGE_SORT_ORDER,
} from "@/lib/types/pipeline";
import type { PipelineTableRow } from "@/lib/types/pipeline-table";

import {
  stageRollups,
  grandTotal,
  buildFlattenedRows,
  type PipelineFlatItem,
} from "@/lib/utils/pipeline-table-grouping";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Build a `PipelineTableRow` with sane defaults; tests override only the fields
 * under exercise (id, stage, estimatedValue, weightedValue).
 */
function makeRow(overrides: Partial<PipelineTableRow> = {}): PipelineTableRow {
  return {
    id: "row-1",
    companyId: "co-1",
    title: "Deal",
    stage: OpportunityStage.NewLead,
    clientId: null,
    clientName: null,
    estimatedValue: 0,
    winProbability: null,
    weightedValue: 0,
    ageInStageDays: null,
    lastActivityAt: null,
    nextFollowUpAt: null,
    expectedCloseDate: null,
    assignedTo: null,
    assignmentVersion: 0,
    assigneeName: null,
    source: null,
    priority: null,
    correspondenceCount: 0,
    stageEnteredAt: null,
    projectId: null,
    updatedAt: null,
    staleThresholdDays: null,
    winProbabilityIsFallback: false,
    ...overrides,
  };
}

/**
 * Canonical fixture: 5 rows across 3 stages, listed OUT of stage sort order so
 * grouping/ordering is genuinely tested. Quoting (sort 2) appears before
 * Qualifying (sort 1) and NewLead (sort 0) in the raw array.
 *
 * Per-stage expected rollups:
 *   NewLead    (sort 0): 2 rows · value 100 + 0(null) = 100 · weighted 10 + 0 = 10
 *   Qualifying (sort 1): 1 row  · value 200            = 200 · weighted 40
 *   Quoting    (sort 2): 2 rows · value 300 + 50       = 350 · weighted 180 + 30 = 210
 * Grand total: 5 rows · value 650 · weighted 260
 */
function makeFixtureRows(): PipelineTableRow[] {
  return [
    makeRow({
      id: "q1",
      stage: OpportunityStage.Quoting,
      estimatedValue: 300,
      weightedValue: 180,
    }),
    makeRow({
      id: "n1",
      stage: OpportunityStage.NewLead,
      estimatedValue: 100,
      weightedValue: 10,
    }),
    makeRow({
      id: "ql1",
      stage: OpportunityStage.Qualifying,
      estimatedValue: 200,
      weightedValue: 40,
    }),
    // Null value/weighted row — must be treated as 0 in sums but still counted.
    makeRow({
      id: "n2",
      stage: OpportunityStage.NewLead,
      estimatedValue: null,
      weightedValue: null,
    }),
    makeRow({
      id: "q2",
      stage: OpportunityStage.Quoting,
      estimatedValue: 50,
      weightedValue: 30,
    }),
  ];
}

// ─── stageRollups ───────────────────────────────────────────────────────────

describe("stageRollups", () => {
  it("computes count + sumValue + sumWeighted per stage, treating null as 0", () => {
    const rollups = stageRollups(makeFixtureRows());

    const byStage = new Map(rollups.map((r) => [r.stage, r]));

    expect(byStage.get(OpportunityStage.NewLead)).toEqual({
      stage: OpportunityStage.NewLead,
      count: 2,
      sumValue: 100, // 100 + null→0
      sumWeighted: 10, // 10 + null→0
    });
    expect(byStage.get(OpportunityStage.Qualifying)).toEqual({
      stage: OpportunityStage.Qualifying,
      count: 1,
      sumValue: 200,
      sumWeighted: 40,
    });
    expect(byStage.get(OpportunityStage.Quoting)).toEqual({
      stage: OpportunityStage.Quoting,
      count: 2,
      sumValue: 350, // 300 + 50
      sumWeighted: 210, // 180 + 30
    });
  });

  it("returns ONLY stages that have at least one row", () => {
    const rollups = stageRollups(makeFixtureRows());
    const stages = rollups.map((r) => r.stage);

    expect(stages).toHaveLength(3);
    expect(stages).toEqual(
      expect.arrayContaining([
        OpportunityStage.NewLead,
        OpportunityStage.Qualifying,
        OpportunityStage.Quoting,
      ])
    );
    // Stages with no rows are absent.
    expect(stages).not.toContain(OpportunityStage.Won);
    expect(stages).not.toContain(OpportunityStage.Lost);
  });

  it("orders rollups by OPPORTUNITY_STAGE_SORT_ORDER regardless of input order", () => {
    const rollups = stageRollups(makeFixtureRows());
    const orders = rollups.map((r) => OPPORTUNITY_STAGE_SORT_ORDER[r.stage]);

    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(rollups.map((r) => r.stage)).toEqual([
      OpportunityStage.NewLead, // sort 0
      OpportunityStage.Qualifying, // sort 1
      OpportunityStage.Quoting, // sort 2
    ]);
  });

  it("returns [] for empty input", () => {
    expect(stageRollups([])).toEqual([]);
  });
});

// ─── grandTotal ──────────────────────────────────────────────────────────────

describe("grandTotal", () => {
  it("sums count + value + weighted across all rows, treating null as 0", () => {
    expect(grandTotal(makeFixtureRows())).toEqual({
      count: 5,
      sumValue: 650, // 300 + 100 + 200 + 0 + 50
      sumWeighted: 260, // 180 + 10 + 40 + 0 + 30
    });
  });

  it("returns zeroed totals for empty input", () => {
    expect(grandTotal([])).toEqual({ count: 0, sumValue: 0, sumWeighted: 0 });
  });
});

// ─── buildFlattenedRows — ungrouped ────────────────────────────────────────

describe("buildFlattenedRows (ungrouped)", () => {
  it("returns data items in original order with no headers", () => {
    const rows = makeFixtureRows();
    const flat = buildFlattenedRows(rows, {
      grouped: false,
      collapsedStages: new Set(),
    });

    expect(flat).toHaveLength(rows.length);
    expect(flat.every((item) => item.kind === "data")).toBe(true);
    expect(
      flat.map(
        (item) => (item as Extract<PipelineFlatItem, { kind: "data" }>).row.id
      )
    ).toEqual(rows.map((r) => r.id));
  });

  it("ignores collapsedStages when ungrouped", () => {
    const rows = makeFixtureRows();
    const flat = buildFlattenedRows(rows, {
      grouped: false,
      collapsedStages: new Set([
        OpportunityStage.NewLead,
        OpportunityStage.Quoting,
      ]),
    });

    // Collapse only applies to grouped mode — flat passthrough is unaffected.
    expect(flat).toHaveLength(rows.length);
    expect(flat.every((item) => item.kind === "data")).toBe(true);
  });

  it("returns [] for empty input", () => {
    expect(
      buildFlattenedRows([], { grouped: false, collapsedStages: new Set() })
    ).toEqual([]);
  });
});

// ─── buildFlattenedRows — grouped, none collapsed ─────────────────────────

describe("buildFlattenedRows (grouped, none collapsed)", () => {
  it("emits header→rows per stage, stages in sort order", () => {
    const rows = makeFixtureRows();
    const flat = buildFlattenedRows(rows, {
      grouped: true,
      collapsedStages: new Set(),
    });

    // 3 headers + 5 data items.
    expect(flat).toHaveLength(8);

    // Expected stream: NewLead header, its 2 rows (original relative order),
    // Qualifying header + 1 row, Quoting header + 2 rows.
    const kinds = flat.map((i) => i.kind);
    expect(kinds).toEqual([
      "group-header",
      "data",
      "data",
      "group-header",
      "data",
      "group-header",
      "data",
      "data",
    ]);

    const headerStages = flat
      .filter(
        (i): i is Extract<PipelineFlatItem, { kind: "group-header" }> =>
          i.kind === "group-header"
      )
      .map((h) => h.stage);
    expect(headerStages).toEqual([
      OpportunityStage.NewLead,
      OpportunityStage.Qualifying,
      OpportunityStage.Quoting,
    ]);
  });

  it("each header carries that stage's count/sums and collapsed=false", () => {
    const flat = buildFlattenedRows(makeFixtureRows(), {
      grouped: true,
      collapsedStages: new Set(),
    });

    const headers = flat.filter(
      (i): i is Extract<PipelineFlatItem, { kind: "group-header" }> =>
        i.kind === "group-header"
    );
    const byStage = new Map(headers.map((h) => [h.stage, h]));

    expect(byStage.get(OpportunityStage.NewLead)).toEqual({
      kind: "group-header",
      stage: OpportunityStage.NewLead,
      count: 2,
      sumValue: 100,
      sumWeighted: 10,
      collapsed: false,
    });
    expect(byStage.get(OpportunityStage.Qualifying)).toEqual({
      kind: "group-header",
      stage: OpportunityStage.Qualifying,
      count: 1,
      sumValue: 200,
      sumWeighted: 40,
      collapsed: false,
    });
    expect(byStage.get(OpportunityStage.Quoting)).toEqual({
      kind: "group-header",
      stage: OpportunityStage.Quoting,
      count: 2,
      sumValue: 350,
      sumWeighted: 210,
      collapsed: false,
    });
  });

  it("preserves the incoming relative order of rows within a stage", () => {
    // Two NewLead rows in a deliberate order; grouping must not reorder them.
    const rows = [
      makeRow({
        id: "first",
        stage: OpportunityStage.NewLead,
        estimatedValue: 1,
        weightedValue: 0,
      }),
      makeRow({
        id: "second",
        stage: OpportunityStage.NewLead,
        estimatedValue: 2,
        weightedValue: 0,
      }),
    ];
    const flat = buildFlattenedRows(rows, {
      grouped: true,
      collapsedStages: new Set(),
    });

    const dataIds = flat
      .filter(
        (i): i is Extract<PipelineFlatItem, { kind: "data" }> =>
          i.kind === "data"
      )
      .map((i) => i.row.id);
    expect(dataIds).toEqual(["first", "second"]);
  });

  it("returns [] for empty input", () => {
    expect(
      buildFlattenedRows([], { grouped: true, collapsedStages: new Set() })
    ).toEqual([]);
  });
});

// ─── buildFlattenedRows — grouped, one stage collapsed ────────────────────

describe("buildFlattenedRows (grouped, one stage collapsed)", () => {
  it("emits ONLY the header for a collapsed stage (no data items)", () => {
    const flat = buildFlattenedRows(makeFixtureRows(), {
      grouped: true,
      collapsedStages: new Set([OpportunityStage.NewLead]),
    });

    // NewLead's 2 data rows are dropped: 3 headers + 3 remaining data items.
    expect(flat).toHaveLength(6);

    const newLeadHeader = flat.find(
      (i): i is Extract<PipelineFlatItem, { kind: "group-header" }> =>
        i.kind === "group-header" && i.stage === OpportunityStage.NewLead
    );
    expect(newLeadHeader).toBeDefined();
    expect(newLeadHeader?.collapsed).toBe(true);
    // Count/sums still reflect the full stage even though rows are hidden.
    expect(newLeadHeader?.count).toBe(2);
    expect(newLeadHeader?.sumValue).toBe(100);
    expect(newLeadHeader?.sumWeighted).toBe(10);

    // No NewLead data rows present in the stream.
    const newLeadDataRows = flat.filter(
      (i) => i.kind === "data" && i.row.stage === OpportunityStage.NewLead
    );
    expect(newLeadDataRows).toHaveLength(0);
  });

  it("leaves non-collapsed stages fully expanded", () => {
    const flat = buildFlattenedRows(makeFixtureRows(), {
      grouped: true,
      collapsedStages: new Set([OpportunityStage.NewLead]),
    });

    // Qualifying (1 row) and Quoting (2 rows) keep their headers + all rows.
    const qualifyingHeader = flat.find(
      (i): i is Extract<PipelineFlatItem, { kind: "group-header" }> =>
        i.kind === "group-header" && i.stage === OpportunityStage.Qualifying
    );
    const quotingHeader = flat.find(
      (i): i is Extract<PipelineFlatItem, { kind: "group-header" }> =>
        i.kind === "group-header" && i.stage === OpportunityStage.Quoting
    );
    expect(qualifyingHeader?.collapsed).toBe(false);
    expect(quotingHeader?.collapsed).toBe(false);

    expect(
      flat.filter(
        (i) => i.kind === "data" && i.row.stage === OpportunityStage.Qualifying
      )
    ).toHaveLength(1);
    expect(
      flat.filter(
        (i) => i.kind === "data" && i.row.stage === OpportunityStage.Quoting
      )
    ).toHaveLength(2);
  });

  it("emits only headers when every present stage is collapsed", () => {
    const flat = buildFlattenedRows(makeFixtureRows(), {
      grouped: true,
      collapsedStages: new Set([
        OpportunityStage.NewLead,
        OpportunityStage.Qualifying,
        OpportunityStage.Quoting,
      ]),
    });

    expect(flat).toHaveLength(3);
    expect(flat.every((i) => i.kind === "group-header")).toBe(true);
    expect(flat.every((i) => i.kind === "group-header" && i.collapsed)).toBe(
      true
    );
  });
});

// ─── Immutability ────────────────────────────────────────────────────────────

describe("input is never mutated", () => {
  it("does not mutate the rows array or its order across all three functions", () => {
    const rows = makeFixtureRows();
    const snapshotOrder = rows.map((r) => r.id);
    const frozenLength = rows.length;

    stageRollups(rows);
    grandTotal(rows);
    buildFlattenedRows(rows, {
      grouped: true,
      collapsedStages: new Set([OpportunityStage.NewLead]),
    });
    buildFlattenedRows(rows, { grouped: false, collapsedStages: new Set() });

    expect(rows.map((r) => r.id)).toEqual(snapshotOrder);
    expect(rows).toHaveLength(frozenLength);
  });

  it("does not mutate the collapsedStages set", () => {
    const rows = makeFixtureRows();
    const collapsed = new Set([OpportunityStage.NewLead]);
    const before = [...collapsed];

    buildFlattenedRows(rows, { grouped: true, collapsedStages: collapsed });

    expect([...collapsed]).toEqual(before);
  });

  it("produces deterministic output across repeated calls", () => {
    const rows = makeFixtureRows();
    const opts = {
      grouped: true,
      collapsedStages: new Set([OpportunityStage.Quoting]),
    };

    const a = buildFlattenedRows(rows, opts);
    const b = buildFlattenedRows(rows, opts);

    expect(a).toEqual(b);
  });
});
