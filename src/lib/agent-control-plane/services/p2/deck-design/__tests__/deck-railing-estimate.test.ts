import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateDeckGeometryFromSourceJson } from "../deck-geometry-calculator";
import { nativeDrawing } from "./deck-geometry-native-fixtures";

function single() {
  const source = nativeDrawing();
  source.levels = [source.levels[0]];
  source.levelConnections = [];
  return source;
}
function calculate(source: ReturnType<typeof single>) {
  return calculateDeckGeometryFromSourceJson(JSON.stringify(source));
}

describe("measured perimeter railing scenario", () => {
  it("reports 36 feet of unconfigured measured perimeter without calling configured zero a takeoff", () => {
    const result = calculate(single());
    expect(result.measurements.flat_railing_linear_feet).toMatchObject({
      value: 0,
    });
    expect(result.railing_estimate).toMatchObject({
      basis: "measured_perimeter_scenario",
      unit: "linear_feet",
      order_ready: false,
      flat: {
        state: "estimated",
        known_linear_feet: 36,
        total_linear_feet: 36,
      },
      configured_flat_edge_refs: [],
    });
    expect(result.railing_estimate.edges.map((e) => e.disposition)).toEqual([
      "included",
      "included",
      "included",
      "included",
    ]);
    expect(result.railing_estimate.missing_facts).toContain(
      "site_boundary_roles_and_guard_requirement"
    );
  });
  it("does not scale saved inches or use canvas distance to fill missing or stale dimensions", () => {
    const source = single();
    source.scaleFactor = 20;
    source.levels[0].edges[1].dimensionStale = true;
    delete source.levels[0].edges[2].dimension;
    const estimate = calculate(source).railing_estimate;
    expect(estimate.flat).toEqual({
      state: "partial",
      known_linear_feet: 18,
      total_linear_feet: null,
    });
    expect(estimate.edges[1].issues).toContain("dimension_stale");
    expect(estimate.edges[2].issues).toContain("dimension_missing");
  });
  it("excludes recorded house and wall edges and identifies configured coverage independently", () => {
    const source = single();
    source.levels[0].edges[0].boundaryRole = "house";
    source.levels[0].edges[1].boundaryRole = "wall";
    source.levels[0].edges[2].railingConfig = { railingType: "glass" };
    const estimate = calculate(source).railing_estimate;
    expect(estimate.flat.total_linear_feet).toBe(18);
    expect(estimate.edges[0]).toMatchObject({
      disposition: "excluded",
      reason: "house",
    });
    expect(estimate.edges[1]).toMatchObject({
      disposition: "excluded",
      reason: "wall",
    });
    expect(estimate.configured_flat_edge_refs).toEqual(["plane:1:edge:3"]);
  });
  it("deducts a measured stair opening and separately states two-sided sloped rails", () => {
    const source = single();
    source.levels[0].edges[0].stairConfig = {
      width: 36,
      totalRiseInches: 48,
      treadCount: 7,
      runPerTread: 10,
      alignment: "right",
      offset: 8,
      flipDirection: true,
    };
    const result = calculate(source);
    expect(result.railing_estimate.flat.total_linear_feet).toBe(33);
    expect(result.railing_estimate.stairs[0]).toMatchObject({
      assumed_sides: 2,
      rail_assignment: "not_configured",
      two_sides_linear_feet: 14.15,
    });
    expect(result.stair_placements[0]).toMatchObject({
      alignment: "right",
      offset_inches: 8,
      flip_direction: true,
    });
  });
  it("does not substitute the native 36-inch component allowance for unmeasured gates", () => {
    const source = single();
    source.levels[0].edges[0].assignedItems = [{ id: "gate", isGate: true }];
    const estimate = calculate(source).railing_estimate;
    expect(estimate.flat).toEqual({
      state: "partial",
      known_linear_feet: 26,
      total_linear_feet: null,
    });
    expect(estimate.edges[0].deductions).toEqual([
      { kind: "gate", inches: null },
    ]);
    expect(estimate.edges[0].issues).toContain("gate_width_unrecorded");
  });
  it("keeps optional landing and partial connection placement without guessing a landing opening", () => {
    const source = nativeDrawing();
    source.levelConnections[0].position = {
      partial: { offsetInches: 12, widthInches: 48 },
    };
    const result = calculate(source);
    expect(result.stair_placements[0]).toMatchObject({
      lower_destination: {
        basis: "lower_plane_vertex_mean",
        position: { x: 120, y: 356 },
      },
      connection_position: {
        kind: "partial",
        offset_inches: 12,
        width_inches: 48,
      },
    });
    expect(result.railing_estimate.flat.total_linear_feet).toBeNull();
    expect(
      result.railing_estimate.edges.filter((e) =>
        e.issues.includes("landing_opening_unlocated")
      )
    ).toHaveLength(4);
    expect(result.railing_estimate.stairs).toHaveLength(1);
  });
  it("does not turn impossible opening widths or duplicate stair ownership into a zero", () => {
    const source = single();
    source.levels[0].edges[0].stairConfig = {
      width: 300,
      totalRiseInches: 48,
      treadCount: 7,
      runPerTread: 10,
    };
    expect(calculate(source).railing_estimate.edges[0].issues).toContain(
      "opening_exceeds_edge"
    );
    const multilevel = nativeDrawing();
    multilevel.levels[0].edges[2].stairConfig =
      multilevel.levelConnections[0].stairConfig;
    expect(
      calculate(multilevel).railing_estimate.edges.find(
        (e) => e.edge_ref === "plane:2:edge:3"
      )?.issues
    ).toContain("multiple_stair_openings");
  });
});

describe("perimeter boundary integrity", () => {
  it("does not promote touching self-intersections to a complete estimate", () => {
    const source = single();
    const positions = [
      [0, 0],
      [100, 0],
      [100, 100],
      [50, 0],
      [0, 100],
    ];
    const plane = source.levels[0];
    plane.vertices = positions.map((position, i) => ({
      id: `v${i}`,
      position,
    }));
    plane.edges = positions.map((_, i) => ({
      id: `e${i}`,
      startVertexId: `v${i}`,
      endVertexId: `v${(i + 1) % 5}`,
      dimension: 100,
    }));
    plane.surfaces = [
      {
        id: "surface",
        boundary: {
          outerLoop: plane.edges.map(
            (e: {
              id: string;
              startVertexId: string;
              endVertexId: string;
            }) => ({
              edgeId: e.id,
              startVertexId: e.startVertexId,
              endVertexId: e.endVertexId,
            })
          ),
          holeLoops: [],
        },
      },
    ];
    const result = calculate(source);
    expect(result.railing_estimate.flat.total_linear_feet).toBeNull();
    expect(
      result.railing_estimate.edges.every((e) =>
        e.issues.includes("boundary_unresolved")
      )
    ).toBe(true);
  });
});

function golden(name: string) {
  return JSON.parse(
    readFileSync(
      `${process.cwd()}/src/lib/agent-control-plane/services/p2/deck-design/__fixtures__/ops-decks-ios/${name}.json`,
      "utf8"
    )
  ).input_drawing_json;
}
describe("independent review regressions", () => {
  it("tolerates a source surface that was not matched to a projected face", () => {
    const source = golden("adjacent-faces-no-surfaces");
    source.surfaces = [
      { id: "unmatched", vertexIds: ["adjacent-v1"], elevationFeet: 2 },
    ];
    delete source.components;
    expect(() => calculate(source)).not.toThrow();
  });
  it("flags a hole that crosses the outside boundary", () => {
    const source = golden("surface-hole");
    delete source.components;
    const holeIds = new Set(
      source.surfaces[0].boundary.holeLoops[0].map(
        (r: { startVertexId: string }) => r.startVertexId
      )
    );
    for (const vertex of source.vertices)
      if (holeIds.has(vertex.id)) {
        vertex.position[0] += 75;
        vertex.position[1] += 70;
      }
    expect(
      calculate(source).railing_estimate.flat.total_linear_feet
    ).toBeNull();
  });
  it.each([0, -1])(
    "discloses defaults after normalizing treadCount %s",
    (treadCount) => {
      const source = single();
      source.levels[0].edges[0].stairConfig = {
        width: 36,
        totalRiseInches: 48,
        treadCount,
        runPerTread: 10,
      };
      expect(calculate(source).railing_estimate.stairs[0].issues).toContain(
        "stair_defaults_used"
      );
    }
  );
  it("excludes the shared edge between adjacent coplanar faces", () => {
    const source = golden("adjacent-faces-no-surfaces");
    const result = calculate(source);
    expect(
      result.railing_estimate.edges.filter(
        (e) => e.reason === "shared_boundary"
      )
    ).toHaveLength(1);
    expect(
      result.railing_estimate.edges.find(
        (e) => e.reason === "shared_boundary"
      )?.disposition
    ).toBe("excluded");
  });
});

it("does not treat a drawing with no edges as a complete zero perimeter", () => {
  const result = calculate({
    schemaVersion: 11,
    vertices: [],
    edges: [],
    surfaces: [],
  });
  expect(result.railing_estimate.flat).toEqual({
    state: "unavailable",
    known_linear_feet: 0,
    total_linear_feet: null,
  });
});

it("keeps an unfinished outside edge unresolved instead of silently excluding it", () => {
  const source = single();
  const plane = source.levels[0];
  plane.vertices.push(
    { id: "outside-a", position: [400, 0] },
    { id: "outside-b", position: [500, 0] }
  );
  plane.edges.push({
    id: "outside",
    startVertexId: "outside-a",
    endVertexId: "outside-b",
    dimension: 50,
  });
  const estimate = calculate(source).railing_estimate;
  expect(estimate.flat.total_linear_feet).toBeNull();
  expect(
    estimate.edges.find((e) => e.gross_inches === 50)
      ?.disposition
  ).toBe("unresolved");
});
