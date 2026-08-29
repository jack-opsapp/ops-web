import { describe, expect, it } from "vitest";

import {
  DECK_GEOMETRY_CALCULATOR_REVISION,
  DECK_GEOMETRY_LOCAL_REF_REVISION,
  DECK_GEOMETRY_MAX_CONNECTIONS,
  DECK_GEOMETRY_MAX_DIRECTED_BOUNDARY_REFS,
  DECK_GEOMETRY_MAX_EDGES,
  DECK_GEOMETRY_MAX_PLANES,
  DECK_GEOMETRY_MAX_SOURCE_BYTES,
  DECK_GEOMETRY_MAX_SURFACES,
  DECK_GEOMETRY_MAX_TOPOLOGY_UNITS,
  DECK_GEOMETRY_MAX_VERTICES,
  DeckDesignGeometryInputSchema,
  DeckDesignGeometryResultSchema,
  type DeckDesignGeometryResult,
  assertNoDeckGeometryForbiddenFields,
} from "../deck-design-geometry";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const DECK_REF = `ops_deck_design:v1:${"a".repeat(64)}`;
const FENCE = `ops_deck_geometry_fence:v1:${"b".repeat(43)}`;
const READ_AT = "2026-08-22T12:34:56.789Z";

function revision(domain: string, sourceRevision: number) {
  return { domain, source_revision: sourceRevision };
}

function proof() {
  return {
    proof_ref: `ops_proof:v1:${"c".repeat(64)}`,
    read_at: READ_AT,
    source_revisions: [
      revision("artifacts", 2),
      revision("deck_designs", 3),
      revision("legacy_operational", 4),
      revision("site_visits", 5),
    ],
  };
}

function authoritative(value: number) {
  return { state: "authoritative" as const, value, warning: null };
}

function resultFixture(): DeckDesignGeometryResult {
  return {
    deck_design_ref: DECK_REF,
    design: {
      title: {
        text: "Rear deck",
        content_kind: "untrusted_business_data",
      },
      drawing_schema_version: 11,
      calculator_revision: DECK_GEOMETRY_CALCULATOR_REVISION,
      local_ref_revision: DECK_GEOMETRY_LOCAL_REF_REVISION,
    },
    coordinate_system: {
      axes: "x_right_y_down",
      unit: "drawing_unit",
    },
    topology: {
      topology_units: 14,
      planes: [
        {
          plane_ref: "plane:1",
          level: { state: "base" },
          vertices: [
            { vertex_ref: "plane:1:vertex:1", position: { x: -1, y: 0 } },
            { vertex_ref: "plane:1:vertex:2", position: { x: 11, y: 0 } },
            { vertex_ref: "plane:1:vertex:3", position: { x: 11, y: 10 } },
            { vertex_ref: "plane:1:vertex:4", position: { x: -1, y: 10 } },
          ],
          edges: [
            {
              edge_ref: "plane:1:edge:1",
              start_vertex_ref: "plane:1:vertex:1",
              end_vertex_ref: "plane:1:vertex:2",
              edge_type: "deck_edge",
              boundary_role: {
                value: "open",
                content_kind: "untrusted_business_data",
              },
              dimension: {
                state: "recorded",
                inches: 144,
                source: "manual",
                stale: false,
              },
              railing: {
                state: "configured",
                family: {
                  value: "glass",
                  content_kind: "untrusted_business_data",
                },
              },
              stair: {
                state: "configured",
                width: { state: "recorded", inches: 36 },
                stringer: {
                  state: "authoritative",
                  rise_inches: 42,
                  tread_count: 6,
                  run_per_tread_inches: 10,
                },
              },
            },
            {
              edge_ref: "plane:1:edge:2",
              start_vertex_ref: "plane:1:vertex:2",
              end_vertex_ref: "plane:1:vertex:3",
              edge_type: "deck_edge",
              boundary_role: null,
              dimension: { state: "not_recorded" },
              railing: { state: "not_configured" },
              stair: { state: "not_configured" },
            },
            {
              edge_ref: "plane:1:edge:3",
              start_vertex_ref: "plane:1:vertex:3",
              end_vertex_ref: "plane:1:vertex:4",
              edge_type: "deck_edge",
              boundary_role: null,
              dimension: {
                state: "recorded",
                inches: 144,
                source: "scale",
                stale: true,
              },
              railing: { state: "not_configured" },
              stair: { state: "not_configured" },
            },
            {
              edge_ref: "plane:1:edge:4",
              start_vertex_ref: "plane:1:vertex:4",
              end_vertex_ref: "plane:1:vertex:1",
              edge_type: "deck_edge",
              boundary_role: null,
              dimension: { state: "not_recorded" },
              railing: { state: "not_configured" },
              stair: { state: "not_configured" },
            },
          ],
          surfaces: [
            {
              surface_ref: "plane:1:surface:1",
              finish_family: {
                value: "vinyl",
                content_kind: "untrusted_business_data",
              },
              outer_loop: [
                { edge_ref: "plane:1:edge:1", direction: "forward" },
                { edge_ref: "plane:1:edge:2", direction: "forward" },
                { edge_ref: "plane:1:edge:3", direction: "forward" },
                { edge_ref: "plane:1:edge:4", direction: "forward" },
              ],
              hole_loops: [],
            },
          ],
        },
      ],
      connections: [],
    },
    measurements: {
      area_square_feet: authoritative(120),
      flat_railing_linear_feet: authoritative(6),
      stair_railing_linear_feet: authoritative(12.21),
      parapet_linear_feet: authoritative(10),
      combined_guard_linear_feet: authoritative(28.21),
      component_witness: { state: "authoritative", warning: null },
    },
    geometry_source_fence: FENCE,
    evidence: [
      {
        evidence_ref: `ops_evidence:v1:${"e".repeat(64)}`,
        source_domain: "deck_designs",
        source_type: "deck_design_geometry",
        occurred_at: READ_AT,
      },
    ],
    proof: proof(),
  };
}

describe("P2 deck-design geometry contract", () => {
  it("pins the exact immutable parser and calculator envelope", () => {
    expect(DECK_GEOMETRY_CALCULATOR_REVISION).toBe(
      "deck-geometry-calculator:2026-08-22.v1"
    );
    expect(DECK_GEOMETRY_LOCAL_REF_REVISION).toBe(
      "deck-local-ref:2026-08-22.v1"
    );
    expect({
      sourceBytes: DECK_GEOMETRY_MAX_SOURCE_BYTES,
      planes: DECK_GEOMETRY_MAX_PLANES,
      vertices: DECK_GEOMETRY_MAX_VERTICES,
      edges: DECK_GEOMETRY_MAX_EDGES,
      surfaces: DECK_GEOMETRY_MAX_SURFACES,
      connections: DECK_GEOMETRY_MAX_CONNECTIONS,
      directedBoundaryRefs: DECK_GEOMETRY_MAX_DIRECTED_BOUNDARY_REFS,
      topologyUnits: DECK_GEOMETRY_MAX_TOPOLOGY_UNITS,
    }).toEqual({
      sourceBytes: 1_048_576,
      planes: 16,
      vertices: 160,
      edges: 240,
      surfaces: 64,
      connections: 32,
      directedBoundaryRefs: 320,
      topologyUnits: 500,
    });
  });

  it("accepts only one exact opaque discovery anchor", () => {
    expect(
      DeckDesignGeometryInputSchema.parse({
        source: "job_artifact",
        job_ref: { kind: "project", id: UUID_A },
        deck_design_ref: DECK_REF,
      })
    ).toEqual({
      source: "job_artifact",
      job_ref: { kind: "project", id: UUID_A },
      deck_design_ref: DECK_REF,
    });
    expect(
      DeckDesignGeometryInputSchema.parse({
        source: "site_visit_artifact",
        site_visit_ref: { kind: "site_visit", id: UUID_B },
        deck_design_ref: DECK_REF,
      })
    ).toEqual({
      source: "site_visit_artifact",
      site_visit_ref: { kind: "site_visit", id: UUID_B },
      deck_design_ref: DECK_REF,
    });

    for (const invalid of [
      { source: "job_artifact", deck_design_ref: DECK_REF },
      {
        source: "site_visit_artifact",
        job_ref: { kind: "project", id: UUID_A },
        deck_design_ref: DECK_REF,
      },
      {
        source: "job_artifact",
        job_ref: { kind: "customer", id: UUID_A },
        deck_design_ref: DECK_REF,
      },
      {
        source: "job_artifact",
        job_ref: { kind: "project", id: UUID_A },
        deck_design_ref: UUID_B,
      },
      {
        source: "job_artifact",
        job_ref: { kind: "project", id: UUID_A },
        deck_design_ref: DECK_REF,
        company_id: UUID_B,
      },
    ]) {
      expect(DeckDesignGeometryInputSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });

  it("accepts bounded renderable geometry and independent measurements", () => {
    expect(DeckDesignGeometryResultSchema.parse(resultFixture())).toEqual(
      resultFixture()
    );
  });

  it("allows one metric to be unavailable without suppressing another", () => {
    const fixture = resultFixture();
    fixture.measurements.flat_railing_linear_feet = {
      state: "unavailable",
      warning: "flat_dimension_unavailable",
    };
    fixture.measurements.combined_guard_linear_feet = {
      state: "unavailable",
      warning: "guard_subtype_unavailable",
    };
    expect(DeckDesignGeometryResultSchema.safeParse(fixture).success).toBe(
      true
    );
  });

  it("allows final-only combined rounding without accepting a false total", () => {
    const fixture = resultFixture();
    fixture.measurements.flat_railing_linear_feet = authoritative(1);
    fixture.measurements.stair_railing_linear_feet = authoritative(1);
    fixture.measurements.parapet_linear_feet = authoritative(1);
    fixture.measurements.combined_guard_linear_feet = authoritative(3.01);
    expect(DeckDesignGeometryResultSchema.safeParse(fixture).success).toBe(
      true
    );

    fixture.measurements.combined_guard_linear_feet = authoritative(3.03);
    expect(DeckDesignGeometryResultSchema.safeParse(fixture).success).toBe(
      false
    );
  });

  it("accepts exact two-decimal measurements without admitting fractional cents", () => {
    const exact = resultFixture();
    exact.measurements.area_square_feet = authoritative(138.89);
    expect(DeckDesignGeometryResultSchema.safeParse(exact).success).toBe(true);

    for (const hostileValue of [138.891, 0.001]) {
      const hostile = resultFixture();
      hostile.measurements.area_square_feet = authoritative(hostileValue);
      expect(DeckDesignGeometryResultSchema.safeParse(hostile).success).toBe(
        false
      );
    }
  });

  it("requires canonical local-reference ordering and exact topology counts", () => {
    const duplicate = resultFixture();
    duplicate.topology.planes[0]!.vertices[1]!.vertex_ref =
      duplicate.topology.planes[0]!.vertices[0]!.vertex_ref;
    expect(DeckDesignGeometryResultSchema.safeParse(duplicate).success).toBe(
      false
    );

    const wrongUnits = resultFixture();
    wrongUnits.topology.topology_units += 1;
    expect(DeckDesignGeometryResultSchema.safeParse(wrongUnits).success).toBe(
      false
    );

    const dangling = resultFixture();
    dangling.topology.planes[0]!.edges[0]!.start_vertex_ref =
      "plane:1:vertex:99";
    expect(DeckDesignGeometryResultSchema.safeParse(dangling).success).toBe(
      false
    );
  });

  it("rejects invalid metric state/value and warning combinations", () => {
    const unavailableWithValue = resultFixture();
    unavailableWithValue.measurements.area_square_feet = {
      state: "unavailable",
      value: 120,
      warning: "closed_surface_unavailable",
    } as never;
    expect(
      DeckDesignGeometryResultSchema.safeParse(unavailableWithValue).success
    ).toBe(false);

    const authoritativeWithWarning = resultFixture();
    authoritativeWithWarning.measurements.stair_railing_linear_feet = {
      state: "authoritative",
      value: 10,
      warning: "stair_geometry_unavailable",
    } as never;
    expect(
      DeckDesignGeometryResultSchema.safeParse(authoritativeWithWarning).success
    ).toBe(false);
  });

  it("requires the evidence time and exact sorted revision vector to match the proof", () => {
    const staleEvidence = resultFixture();
    staleEvidence.evidence[0]!.occurred_at = "2026-08-22T12:34:56.788Z";
    expect(
      DeckDesignGeometryResultSchema.safeParse(staleEvidence).success
    ).toBe(false);

    const incompleteFence = resultFixture();
    incompleteFence.proof.source_revisions = [revision("deck_designs", 3)];
    expect(
      DeckDesignGeometryResultSchema.safeParse(incompleteFence).success
    ).toBe(false);

    const noncanonicalFence = resultFixture();
    noncanonicalFence.geometry_source_fence = `ops_deck_geometry_fence:v1:${"b".repeat(44)}`;
    expect(
      DeckDesignGeometryResultSchema.safeParse(noncanonicalFence).success
    ).toBe(false);
  });

  it("rejects raw drawing, component, catalog, price, identity, and storage fields", () => {
    for (const field of [
      "drawing_data",
      "components",
      "assigned_items",
      "product_id",
      "catalog_variant_id",
      "unit_price",
      "created_by",
      "storage_path",
      "rendered_url",
      "private_notes",
    ]) {
      expect(() =>
        assertNoDeckGeometryForbiddenFields({ safe: { [field]: "leak" } })
      ).toThrow("DECK_GEOMETRY_FORBIDDEN_FIELD");
    }
    expect(() =>
      assertNoDeckGeometryForbiddenFields(resultFixture())
    ).not.toThrow();
  });
});
