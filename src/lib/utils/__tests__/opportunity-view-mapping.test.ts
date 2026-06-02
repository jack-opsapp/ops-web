/**
 * Tests for the pipeline (opportunity) saved-view pure helpers.
 *
 * Two units under test, both pure:
 *   - `mapOpportunityView` — raw `opportunity_views` row → resolved definition.
 *     Mirrors the projects `mapProjectView` contract: unknown column ids are
 *     filtered out, `{ id }`-object and bare-string column forms both parse,
 *     malformed sort entries are dropped, density falls back to "comfortable",
 *     and a non-numeric zoom defaults to 1.
 *   - `buildOpportunityViewDefinitionPayload` — UI definition → snake_case RPC
 *     payload. Verifies partial vs full fallback behaviour and that `zoomLevel`
 *     is emitted as `zoom_level`.
 */

import { describe, it, expect } from "vitest";

import { mapOpportunityView } from "../pipeline-table-formatters";
import { buildOpportunityViewDefinitionPayload } from "../opportunity-view-defaults";
import type { OpportunityViewDbRow } from "@/lib/types/pipeline-table";

function makeRow(overrides: Partial<OpportunityViewDbRow> = {}): OpportunityViewDbRow {
  return {
    id: "view-1",
    company_id: "company-1",
    created_at: "2026-06-01T00:00:00.000Z",
    created_by: "user-1",
    density: "comfortable",
    description: null,
    filters: { field: "stage", op: "in", value: ["new_lead"] },
    icon: "user-check",
    is_archived: false,
    is_default: true,
    name: "My Pipeline",
    owner_id: "user-1",
    owner_type: "user",
    permission_key: null,
    sort: [{ field: "next_follow_up", direction: "asc" }],
    sort_position: 0,
    updated_at: "2026-06-01T00:00:00.000Z",
    zoom_level: 1,
    columns: [
      { id: "deal" },
      { id: "stage" },
      { id: "client" },
      { id: "value" },
    ],
    ...overrides,
  };
}

describe("mapOpportunityView", () => {
  it("maps a valid row into a resolved definition", () => {
    const result = mapOpportunityView(makeRow());

    expect(result).toEqual({
      id: "view-1",
      name: "My Pipeline",
      icon: "user-check",
      permissionKey: null,
      columns: ["deal", "stage", "client", "value"],
      filters: { field: "stage", op: "in", value: ["new_lead"] },
      sort: [{ field: "next_follow_up", direction: "asc" }],
      density: "comfortable",
      zoomLevel: 1,
      isDefault: true,
      sortPosition: 0,
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("accepts bare-string column ids alongside the { id } object form", () => {
    const result = mapOpportunityView(
      makeRow({ columns: ["deal", { id: "stage" }, "assignee"] }),
    );

    expect(result.columns).toEqual(["deal", "stage", "assignee"]);
  });

  it("filters out unknown / malformed column ids", () => {
    const result = mapOpportunityView(
      makeRow({
        columns: [
          { id: "deal" },
          { id: "not_a_real_column" },
          { id: "stage" },
          { nope: true },
          42,
          null,
        ] as unknown as OpportunityViewDbRow["columns"],
      }),
    );

    expect(result.columns).toEqual(["deal", "stage"]);
  });

  it("returns an empty column list when columns is not an array", () => {
    const result = mapOpportunityView(
      makeRow({ columns: { id: "deal" } as unknown as OpportunityViewDbRow["columns"] }),
    );

    expect(result.columns).toEqual([]);
  });

  it("drops sort entries with unknown fields, bad directions, or wrong shape", () => {
    // The mapper validates sort fields against the full PIPELINE_TABLE_COLUMN_IDS
    // set (mirroring mapProjectView). Narrowing sort fields to the *sortable*
    // subset is the DB sanitizer's job, not the mapper's — so a structurally
    // valid entry with a real column id survives even if it is not sortable.
    const result = mapOpportunityView(
      makeRow({
        sort: [
          { field: "value", direction: "desc" },
          { field: "value", direction: "sideways" }, // bad direction → dropped
          { field: "not_a_column", direction: "asc" }, // unknown field → dropped
          { direction: "asc" }, // missing field → dropped
          null,
          "value",
        ] as unknown as OpportunityViewDbRow["sort"],
      }),
    );

    expect(result.sort).toEqual([{ field: "value", direction: "desc" }]);
  });

  it("returns an empty sort list when sort is not an array", () => {
    const result = mapOpportunityView(
      makeRow({ sort: "next_follow_up" as unknown as OpportunityViewDbRow["sort"] }),
    );

    expect(result.sort).toEqual([]);
  });

  it("normalizes an unknown density to 'comfortable' and preserves valid ones", () => {
    expect(mapOpportunityView(makeRow({ density: "bogus" })).density).toBe("comfortable");
    expect(mapOpportunityView(makeRow({ density: "compact" })).density).toBe("compact");
    expect(mapOpportunityView(makeRow({ density: "spacious" })).density).toBe("spacious");
  });

  it("defaults zoomLevel to 1 when the stored value is non-numeric, else coerces", () => {
    expect(
      mapOpportunityView(
        makeRow({ zoom_level: null as unknown as OpportunityViewDbRow["zoom_level"] }),
      ).zoomLevel,
    ).toBe(1);
    expect(mapOpportunityView(makeRow({ zoom_level: 1.25 })).zoomLevel).toBe(1.25);
  });
});

describe("buildOpportunityViewDefinitionPayload", () => {
  it("emits the full default payload (with snake_case zoom_level) for a null input", () => {
    const payload = buildOpportunityViewDefinitionPayload(null);

    expect(payload).toEqual({
      columns: [
        { id: "deal" },
        { id: "stage" },
        { id: "client" },
        { id: "value" },
        { id: "weighted" },
        { id: "age_in_stage" },
        { id: "next_follow_up" },
        { id: "assignee" },
      ],
      filters: {
        field: "stage",
        op: "in",
        value: ["new_lead", "qualifying", "quoting", "quoted", "follow_up", "negotiation"],
      },
      sort: [{ field: "next_follow_up", direction: "asc" }],
      density: "comfortable",
      zoom_level: 1,
    });
  });

  it("does NOT inject defaults in partial mode — only provided fields are emitted", () => {
    const payload = buildOpportunityViewDefinitionPayload(
      { density: "compact" },
      { partial: true },
    );

    expect(payload).toEqual({ density: "compact" });
    expect(payload.columns).toBeUndefined();
    expect(payload.filters).toBeUndefined();
    expect(payload.sort).toBeUndefined();
    expect(payload.zoom_level).toBeUndefined();
  });

  it("maps camelCase zoomLevel to snake_case zoom_level and clamps to range", () => {
    expect(
      buildOpportunityViewDefinitionPayload({ zoomLevel: 1.25 }, { partial: true }).zoom_level,
    ).toBe(1.25);
    // clamps above max (1.5) and below min (0.75)
    expect(
      buildOpportunityViewDefinitionPayload({ zoomLevel: 9 }, { partial: true }).zoom_level,
    ).toBe(1.5);
    expect(
      buildOpportunityViewDefinitionPayload({ zoomLevel: 0.1 }, { partial: true }).zoom_level,
    ).toBe(0.75);
  });

  it("sanitizes columns: unknown ids dropped, duplicates collapsed, shaped as { id }", () => {
    const payload = buildOpportunityViewDefinitionPayload(
      {
        columns: [
          "deal",
          "deal",
          "not_a_column",
          "stage",
        ] as unknown as NonNullable<Parameters<typeof buildOpportunityViewDefinitionPayload>[0]>["columns"],
      },
      { partial: true },
    );

    expect(payload.columns).toEqual([{ id: "deal" }, { id: "stage" }]);
  });

  it("omits an empty columns array rather than emitting columns: []", () => {
    const payload = buildOpportunityViewDefinitionPayload(
      {
        columns: ["not_a_column"] as unknown as NonNullable<
          Parameters<typeof buildOpportunityViewDefinitionPayload>[0]
        >["columns"],
      },
      { partial: true },
    );

    expect(payload.columns).toBeUndefined();
  });
});
