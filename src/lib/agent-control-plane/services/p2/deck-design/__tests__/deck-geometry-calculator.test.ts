import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DECK_GEOMETRY_MAX_SOURCE_BYTES,
  DeckDesignGeometryMeasurementsSchema,
  DeckDesignGeometryTopologySchema,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import {
  DeckGeometrySourceError,
  calculateDeckGeometryFromSourceJson,
  parseDeckGeometrySource,
} from "../deck-geometry-calculator";

type JsonObject = Record<string, unknown>;

const FIXTURE_ROOT = resolve(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/deck-design/__fixtures__"
);

function fixture(repository: "ops-decks-ios" | "ops-ios", name: string) {
  return JSON.parse(
    readFileSync(resolve(FIXTURE_ROOT, repository, `${name}.json`), "utf8")
  ) as JsonObject;
}

function expectSourceError(code: string, operation: () => unknown): void {
  expect(operation).toThrowError(DeckGeometrySourceError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

function publicValue(
  value: unknown,
  divisor: number
): { state: "authoritative"; value: number; warning: null } | null {
  return typeof value === "number"
    ? {
        state: "authoritative",
        value: Number((value / divisor).toFixed(2)),
        warning: null,
      }
    : null;
}

function expectedMeasurements(sourceFixture: JsonObject) {
  const quality = sourceFixture.measurement_quality as JsonObject;
  const metric = (fixtureKey: string, qualityKey: string, divisor: number) => {
    const state = quality[qualityKey] as JsonObject;
    return (
      publicValue(sourceFixture[fixtureKey], divisor) ?? {
        state: state.state,
        warning: state.warning,
      }
    );
  };
  return {
    area_square_feet: metric(
      "expected_full_precision_square_inches",
      "area",
      144
    ),
    flat_railing_linear_feet: metric(
      "expected_flat_railing_inches",
      "flat_railing",
      12
    ),
    stair_railing_linear_feet: metric(
      "expected_stair_railing_inches",
      "stair_railing",
      12
    ),
    parapet_linear_feet: metric("expected_parapet_inches", "parapet", 12),
    combined_guard_linear_feet: metric(
      "expected_combined_guard_inches",
      "combined_guard",
      12
    ),
    component_witness: quality.component_witness,
  };
}

function boundaryRef(
  edgeId: string,
  startVertexId: string,
  endVertexId: string
) {
  return { edgeId, startVertexId, endVertexId };
}

function exactTopologySource(extraBoundaryReference: boolean): JsonObject {
  const levels = [0, 1].map((levelIndex) => {
    const prefix = `p${levelIndex}`;
    const vertices = Array.from({ length: 80 }, (_, index) => ({
      id: `${prefix}-v${String(index + 1).padStart(3, "0")}`,
      position: [index % 20, Math.floor(index / 20)],
    }));
    const edges = Array.from({ length: 120 }, (_, index) => {
      const startIndex = index % 80;
      const endIndex = (startIndex + 1 + Math.floor(index / 80)) % 80;
      return {
        id: `${prefix}-e${String(index + 1).padStart(3, "0")}`,
        startVertexId: vertices[startIndex]!.id,
        endVertexId: vertices[endIndex]!.id,
        edgeType: "deck_edge",
        boundaryRole: "open",
        assignedItems: [],
        dimensionSource: "manual",
        dimensionStale: false,
      };
    });
    const surfaces = Array.from({ length: 8 }, (_, surfaceIndex) => {
      const first = surfaceIndex * 3;
      const loopLength =
        surfaceIndex === 7 ? 4 + (extraBoundaryReference ? 1 : 0) : 3;
      const outerLoop = Array.from({ length: loopLength }, (_, loopIndex) => {
        const edge = edges[first + loopIndex]!;
        const start = vertices[first + loopIndex]!;
        const end = vertices[first + ((loopIndex + 1) % loopLength)]!;
        edge.startVertexId = start.id;
        edge.endVertexId = end.id;
        return boundaryRef(edge.id, start.id, end.id);
      });
      return {
        id: `${prefix}-s${surfaceIndex + 1}`,
        boundary: { outerLoop, holeLoops: [] },
        assignedItems: [],
        boardMaterial: "composite",
      };
    });
    return {
      id: `${prefix}-level`,
      name: `${prefix}-level`,
      sortOrder: levelIndex,
      elevation: levelIndex + 1,
      vertices,
      edges,
      surfaces,
      footprint: { isClosed: false, assignedItems: [] },
    };
  });
  const levelConnections = Array.from({ length: 32 }, (_, index) => ({
    id: `connection-${String(index + 1).padStart(2, "0")}`,
    upperLevelId: "p1-level",
    lowerLevelId: "p0-level",
    upperEdgeId: "p1-e001",
    lowerEdgeId: "p0-e001",
    stairConfig: {
      width: 36,
      risePerStep: 7.5,
      runPerTread: 10,
      treadCount: 2,
      assignedItems: [],
    },
  }));
  return {
    schemaVersion: 11,
    scaleFactor: 1,
    vertices: [],
    edges: [],
    surfaces: [],
    levels,
    levelConnections,
    surfaceConnections: [],
    footprint: { isClosed: false, assignedItems: [] },
  };
}

function pentagonSurfaceSource(surfaceCount: number): JsonObject {
  const vertices = Array.from({ length: 5 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 5;
    return {
      id: `v${index + 1}`,
      position: [Math.cos(angle) * 10, Math.sin(angle) * 10],
    };
  });
  const edges = vertices.map((vertex, index) => ({
    id: `e${index + 1}`,
    startVertexId: vertex.id,
    endVertexId: vertices[(index + 1) % vertices.length]!.id,
  }));
  const outerLoop = edges.map((edge, index) =>
    boundaryRef(
      edge.id,
      vertices[index]!.id,
      vertices[(index + 1) % vertices.length]!.id
    )
  );
  return {
    schemaVersion: 11,
    scaleFactor: 1,
    levels: [
      {
        id: "level-one",
        sortOrder: 0,
        elevation: 1,
        vertices,
        edges,
        surfaces: Array.from({ length: surfaceCount }, (_, index) => ({
          id: `surface-${index + 1}`,
          boundary: { outerLoop, holeLoops: [] },
          vertexIds: vertices.map((vertex) => vertex.id),
        })),
      },
    ],
    levelConnections: [],
    surfaceConnections: [],
  };
}

describe("deck geometry calculator", () => {
  it.each([
    ["ops-decks-ios", "adjacent-faces-no-surfaces"],
    ["ops-decks-ios", "legacy-self-intersection"],
    ["ops-decks-ios", "missing-and-stale-dimensions"],
    ["ops-decks-ios", "multi-level-connection"],
    ["ops-decks-ios", "single-level-gate-stair-parapet"],
    ["ops-decks-ios", "surface-hole"],
    ["ops-ios", "adjacent-faces-no-surfaces"],
    ["ops-ios", "legacy-self-intersection"],
    ["ops-ios", "missing-and-stale-dimensions"],
    ["ops-ios", "multi-level-connection"],
    ["ops-ios", "single-level-gate-stair-parapet"],
  ] as const)("matches %s/%s exactly", (repository, name) => {
    const sourceFixture = fixture(repository, name);
    const calculated = calculateDeckGeometryFromSourceJson(
      JSON.stringify(sourceFixture.input_drawing_json)
    );

    expect(calculated.full_precision).toEqual({
      area_square_inches: sourceFixture.expected_full_precision_square_inches,
      flat_railing_inches: sourceFixture.expected_flat_railing_inches,
      stair_railing_inches: sourceFixture.expected_stair_railing_inches,
      parapet_inches: sourceFixture.expected_parapet_inches,
      combined_guard_inches: sourceFixture.expected_combined_guard_inches,
    });
    expect(calculated.measurements).toEqual(
      expectedMeasurements(sourceFixture)
    );
    expect(
      DeckDesignGeometryMeasurementsSchema.safeParse(calculated.measurements)
        .success
    ).toBe(true);
    expect(
      DeckDesignGeometryTopologySchema.safeParse(calculated.topology).success
    ).toBe(true);
  });

  it.each(["ops-decks-ios", "ops-ios"] as const)(
    "keeps %s adjacent detected faces public without inventing component witnesses",
    (repository) => {
      const sourceFixture = fixture(repository, "adjacent-faces-no-surfaces");
      const result = calculateDeckGeometryFromSourceJson(
        JSON.stringify(sourceFixture.input_drawing_json)
      );

      expect(result.topology.planes[0]?.surfaces).toHaveLength(2);
      expect(result.full_precision.area_square_inches).toBe(20_000);
      expect(result.measurements.component_witness).toEqual({
        state: "authoritative",
        warning: null,
      });
    }
  );

  it("keeps area and railing quality independent", () => {
    const stale = fixture("ops-decks-ios", "missing-and-stale-dimensions");
    const result = calculateDeckGeometryFromSourceJson(
      JSON.stringify(stale.input_drawing_json)
    );
    expect(result.measurements).toMatchObject({
      area_square_feet: { state: "authoritative", value: 120 },
      flat_railing_linear_feet: {
        state: "unavailable",
        warning: "flat_dimension_unavailable",
      },
      stair_railing_linear_feet: { state: "authoritative", value: 0 },
      parapet_linear_feet: {
        state: "unavailable",
        warning: "parapet_dimension_unavailable",
      },
      combined_guard_linear_feet: {
        state: "unavailable",
        warning: "guard_subtype_unavailable",
      },
    });

    const bow = fixture("ops-decks-ios", "legacy-self-intersection");
    const invalidArea = calculateDeckGeometryFromSourceJson(
      JSON.stringify(bow.input_drawing_json)
    );
    expect(invalidArea.measurements).toMatchObject({
      area_square_feet: {
        state: "invalid",
        warning: "self_intersection",
      },
      flat_railing_linear_feet: { state: "authoritative", value: 12 },
      combined_guard_linear_feet: { state: "authoritative", value: 12 },
    });
  });

  it("keeps stair topology when a level connection cannot be measured", () => {
    const sourceFixture = fixture("ops-decks-ios", "multi-level-connection");
    const source = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    for (const level of source.levels as JsonObject[]) {
      delete level.elevation;
    }

    const result = calculateDeckGeometryFromSourceJson(JSON.stringify(source));

    expect(result.measurements.stair_railing_linear_feet).toEqual({
      state: "unavailable",
      warning: "stair_geometry_unavailable",
    });
    expect(result.topology.connections).toEqual([
      expect.objectContaining({
        kind: "level_stair",
        connection_ref: "connection:1",
        stair: {
          width: { state: "recorded", inches: 42 },
          stringer: {
            state: "unavailable",
            warning: "stair_geometry_unavailable",
          },
        },
      }),
    ]);
  });

  it("projects edge-mounted stair geometry on the owning edge", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const result = calculateDeckGeometryFromSourceJson(
      JSON.stringify(sourceFixture.input_drawing_json)
    );

    expect(result.topology.planes[0]?.edges[0]?.stair).toEqual({
      state: "configured",
      width: { state: "recorded", inches: 36 },
      stringer: {
        state: "authoritative",
        rise_inches: 42,
        tread_count: 6,
        run_per_tread_inches: 10,
      },
    });
  });

  it("treats null stair rise and run defaults exactly like omitted values", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const omitted = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    delete omitted.components;
    const omittedStair = (omitted.edges as JsonObject[])[0]!
      .stairConfig as JsonObject;
    delete omittedStair.risePerStep;
    delete omittedStair.runPerTread;
    const explicitNull = structuredClone(omitted) as JsonObject;
    const nullStair = (explicitNull.edges as JsonObject[])[0]!
      .stairConfig as JsonObject;
    nullStair.risePerStep = null;
    nullStair.runPerTread = null;

    const omittedResult = calculateDeckGeometryFromSourceJson(
      JSON.stringify(omitted)
    );
    const nullResult = calculateDeckGeometryFromSourceJson(
      JSON.stringify(explicitNull)
    );

    expect(nullResult).toEqual(omittedResult);
    expect(nullResult.topology.planes[0]?.edges[0]?.stair).toMatchObject({
      stringer: {
        state: "authoritative",
        rise_inches: 42,
        tread_count: 6,
        run_per_tread_inches: 10,
      },
    });
  });

  it("treats a null endpoint snap radius exactly like an omitted default", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const omitted = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    delete (omitted.config as JsonObject).endpointSnapRadius;
    const explicitNull = structuredClone(omitted) as JsonObject;
    (explicitNull.config as JsonObject).endpointSnapRadius = null;

    const omittedResult = calculateDeckGeometryFromSourceJson(
      JSON.stringify(omitted)
    );
    const nullResult = calculateDeckGeometryFromSourceJson(
      JSON.stringify(explicitNull)
    );

    expect(nullResult).toEqual(omittedResult);
    expect(nullResult.full_precision.area_square_inches).toBe(17_280);
  });

  it("treats null level sort order exactly like its omitted array-index default", () => {
    const sourceFixture = fixture("ops-decks-ios", "multi-level-connection");
    const omitted = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    for (const level of omitted.levels as JsonObject[]) {
      delete level.sortOrder;
    }
    const explicitNull = structuredClone(omitted) as JsonObject;
    for (const level of explicitNull.levels as JsonObject[]) {
      level.sortOrder = null;
    }

    const omittedResult = calculateDeckGeometryFromSourceJson(
      JSON.stringify(omitted)
    );
    const nullResult = calculateDeckGeometryFromSourceJson(
      JSON.stringify(explicitNull)
    );

    expect(nullResult).toEqual(omittedResult);
    expect(
      nullResult.topology.planes.map((plane) =>
        plane.level.state === "level" ? plane.level.sort_order : null
      )
    ).toEqual([0, 1]);
  });

  it("does not silently treat a missing stair opening as zero", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const source = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    delete ((source.edges as JsonObject[])[0]!.stairConfig as JsonObject).width;
    delete source.components;

    const result = calculateDeckGeometryFromSourceJson(JSON.stringify(source));

    expect(result.measurements).toMatchObject({
      area_square_feet: { state: "authoritative", value: 120 },
      flat_railing_linear_feet: {
        state: "unavailable",
        warning: "flat_dimension_unavailable",
      },
      stair_railing_linear_feet: {
        state: "authoritative",
        value: 12.21,
      },
      combined_guard_linear_feet: {
        state: "unavailable",
        warning: "guard_subtype_unavailable",
      },
    });
    expect(result.topology.planes[0]?.edges[0]?.stair).toMatchObject({
      state: "configured",
      width: { state: "not_recorded" },
      stringer: { state: "authoritative" },
    });
  });

  it("matches DeckKit boundary-role normalization before measuring edges", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const houseSource = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    delete houseSource.components;
    (houseSource.edges as JsonObject[])[0]!.boundaryRole = "house";

    const house = calculateDeckGeometryFromSourceJson(
      JSON.stringify(houseSource)
    );
    expect(house.measurements).toMatchObject({
      flat_railing_linear_feet: { state: "authoritative", value: 0 },
      stair_railing_linear_feet: { state: "authoritative", value: 0 },
      parapet_linear_feet: { state: "authoritative", value: 10 },
      combined_guard_linear_feet: { state: "authoritative", value: 10 },
    });
    expect(house.topology.planes[0]?.edges[0]).toMatchObject({
      edge_type: "house_edge",
      boundary_role: { value: "house" },
      railing: { state: "not_configured" },
      stair: { state: "not_configured" },
    });

    const wallSource = structuredClone(houseSource);
    (wallSource.edges as JsonObject[])[0]!.boundaryRole = "open";
    (wallSource.edges as JsonObject[])[2]!.boundaryRole = "wall";
    const wall = calculateDeckGeometryFromSourceJson(
      JSON.stringify(wallSource)
    );
    expect(wall.measurements.parapet_linear_feet).toEqual({
      state: "authoritative",
      value: 22,
      warning: null,
    });
    expect(wall.topology.planes[0]?.edges[2]).toMatchObject({
      edge_type: "deck_edge",
      boundary_role: { value: "wall" },
      railing: {
        state: "configured",
        family: { value: "parapet_wall" },
      },
      stair: { state: "not_configured" },
    });
  });

  it("projects directed outer and hole loops without leaking source ids", () => {
    const ring = fixture("ops-decks-ios", "surface-hole");
    const result = calculateDeckGeometryFromSourceJson(
      JSON.stringify(ring.input_drawing_json)
    );
    expect(result.topology.planes).toHaveLength(1);
    expect(result.topology.planes[0]?.surfaces).toEqual([
      expect.objectContaining({
        surface_ref: "plane:1:surface:1",
        outer_loop: expect.arrayContaining([
          expect.objectContaining({ edge_ref: "plane:1:edge:1" }),
        ]),
        hole_loops: [expect.any(Array)],
      }),
    ]);
    expect(result.topology.planes[0]?.surfaces[0]?.outer_loop).toHaveLength(4);
    expect(result.topology.planes[0]?.surfaces[0]?.hole_loops[0]).toHaveLength(
      4
    );
    expect(JSON.stringify(result.topology)).not.toContain("ring-");
  });

  it("keeps local references stable across source-array reorder only", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const source = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    const reordered = structuredClone(source) as JsonObject;
    for (const field of ["vertices", "edges", "surfaces", "components"]) {
      const rows = reordered[field];
      if (Array.isArray(rows)) rows.reverse();
    }

    const baseline = calculateDeckGeometryFromSourceJson(
      JSON.stringify(source)
    );
    const changed = calculateDeckGeometryFromSourceJson(
      JSON.stringify(reordered)
    );
    expect(changed.local_reference_witnesses).toEqual(
      baseline.local_reference_witnesses
    );
    expect(changed.topology).toEqual(baseline.topology);
    expect(changed.measurements).toEqual(baseline.measurements);
  });

  it("maps every exposed local reference to exactly one private source witness", () => {
    const sourceFixture = fixture("ops-decks-ios", "multi-level-connection");
    const result = calculateDeckGeometryFromSourceJson(
      JSON.stringify(sourceFixture.input_drawing_json)
    );
    const exposed = [
      ...result.topology.planes.flatMap((plane) => [
        plane.plane_ref,
        ...plane.vertices.map((vertex) => vertex.vertex_ref),
        ...plane.edges.map((edge) => edge.edge_ref),
        ...plane.surfaces.map((surface) => surface.surface_ref),
      ]),
      ...result.topology.connections.map(
        (connection) => connection.connection_ref
      ),
    ].sort();
    const witnesses = result.local_reference_witnesses;

    expect(new Set(exposed).size).toBe(exposed.length);
    expect(witnesses.map((witness) => witness.local_ref).sort()).toEqual(
      exposed
    );
    expect(
      new Set(
        witnesses.map((witness) => `${witness.kind}:${witness.source_id}`)
      ).size
    ).toBe(witnesses.length);
  });

  it("consumes a boundaryless persisted surface at most once during reconciliation", () => {
    const source = {
      schemaVersion: 11,
      scaleFactor: 1,
      vertices: [
        { id: "a", position: [0, 0] },
        { id: "b", position: [10, 0] },
        { id: "c", position: [20, 0] },
        { id: "d", position: [0, 10] },
        { id: "e", position: [10, 10] },
        { id: "f", position: [20, 10] },
      ],
      edges: [
        { id: "ab", startVertexId: "a", endVertexId: "b" },
        { id: "bc", startVertexId: "b", endVertexId: "c" },
        { id: "cf", startVertexId: "c", endVertexId: "f" },
        { id: "fe", startVertexId: "f", endVertexId: "e" },
        { id: "ed", startVertexId: "e", endVertexId: "d" },
        { id: "da", startVertexId: "d", endVertexId: "a" },
        { id: "be", startVertexId: "b", endVertexId: "e" },
      ],
      surfaces: [
        {
          id: "persisted-platform",
          vertexIds: ["b", "e"],
          boardMaterial: "vinyl",
        },
      ],
      levels: [],
      levelConnections: [],
      surfaceConnections: [],
    };

    const result = calculateDeckGeometryFromSourceJson(JSON.stringify(source));
    const finishFamilies = result.topology.planes[0]!.surfaces.map(
      (surface) => surface.finish_family?.value ?? null
    );

    expect(result.topology.planes[0]!.surfaces).toHaveLength(2);
    expect(finishFamilies.filter((family) => family === "vinyl")).toHaveLength(
      1
    );
    expect(finishFamilies.filter((family) => family === null)).toHaveLength(1);

    const tied = structuredClone(source);
    tied.surfaces = [
      {
        id: "z-surface",
        vertexIds: ["b", "e"],
        boardMaterial: "vinyl",
      },
      {
        id: "a-surface",
        vertexIds: ["b", "e"],
        boardMaterial: "wood",
      },
    ];
    const reordered = structuredClone(tied);
    reordered.surfaces.reverse();
    const baselineTie = calculateDeckGeometryFromSourceJson(
      JSON.stringify(tied)
    );
    const reorderedTie = calculateDeckGeometryFromSourceJson(
      JSON.stringify(reordered)
    );
    expect(reorderedTie.topology).toEqual(baselineTie.topology);
    expect(reorderedTie.local_reference_witnesses).toEqual(
      baselineTie.local_reference_witnesses
    );
  });

  it("matches DeckKit coincidence welding when duplicate corner ids close a face", () => {
    const source = {
      schemaVersion: 11,
      scaleFactor: 1,
      config: { endpointSnapRadius: 20 },
      vertices: [
        { id: "a", position: [0, 0] },
        { id: "b", position: [10, 0] },
        { id: "b-copy", position: [10.25, 0.1] },
        { id: "c", position: [10, 10] },
        { id: "d", position: [0, 10] },
      ],
      edges: [
        { id: "ab", startVertexId: "a", endVertexId: "b" },
        { id: "bc", startVertexId: "b-copy", endVertexId: "c" },
        { id: "cd", startVertexId: "c", endVertexId: "d" },
        { id: "da", startVertexId: "d", endVertexId: "a" },
      ],
      surfaces: [] as Array<{
        id: string;
        boundary: {
          outerLoop: ReturnType<typeof boundaryRef>[];
          holeLoops: ReturnType<typeof boundaryRef>[][];
        };
        vertexIds: string[];
      }>,
      levels: [],
      levelConnections: [],
      surfaceConnections: [],
      footprint: { isClosed: false, assignedItems: [] },
    };

    const welded = calculateDeckGeometryFromSourceJson(JSON.stringify(source));
    expect(welded.full_precision.area_square_inches).toBe(100);
    expect(welded.measurements.area_square_feet).toEqual({
      state: "authoritative",
      value: 0.69,
      warning: null,
    });
    expect(welded.topology.planes[0]?.surfaces).toHaveLength(1);

    const reorderedCoincidence = structuredClone(source);
    reorderedCoincidence.vertices.reverse();
    const reorderedWeld = calculateDeckGeometryFromSourceJson(
      JSON.stringify(reorderedCoincidence)
    );
    expect(reorderedWeld.topology).toEqual(welded.topology);
    expect(reorderedWeld.measurements).toEqual(welded.measurements);
    expect(reorderedWeld.local_reference_witnesses).toEqual(
      welded.local_reference_witnesses
    );

    const explicitBoundary = structuredClone(source);
    explicitBoundary.edges[0]!.endVertexId = "b-copy";
    explicitBoundary.surfaces = [
      {
        id: "explicit-surface",
        boundary: {
          outerLoop: [
            boundaryRef("ab", "a", "b-copy"),
            boundaryRef("bc", "b-copy", "c"),
            boundaryRef("cd", "c", "d"),
            boundaryRef("da", "d", "a"),
          ],
          holeLoops: [],
        },
        vertexIds: ["a", "b-copy", "c", "d"],
      },
    ];
    const normalizedExplicit = calculateDeckGeometryFromSourceJson(
      JSON.stringify(explicitBoundary)
    );
    expect(normalizedExplicit.full_precision.area_square_inches).toBe(100.75);
    expect(
      DeckDesignGeometryTopologySchema.safeParse(normalizedExplicit.topology)
        .success
    ).toBe(true);

    const authoredDuplicate = structuredClone(source);
    (authoredDuplicate.vertices[2] as JsonObject).elevation = 3;
    const authoredSurvivor = calculateDeckGeometryFromSourceJson(
      JSON.stringify(authoredDuplicate)
    );
    expect(authoredSurvivor.full_precision.area_square_inches).toBe(100.75);

    const multiLevel = {
      ...structuredClone(source),
      config: { endpointSnapRadius: 0 },
      vertices: [],
      edges: [],
      surfaces: [],
      levels: [
        {
          id: "level-one",
          sortOrder: 0,
          elevation: 1,
          vertices: source.vertices,
          edges: source.edges,
          surfaces: [],
        },
      ],
    };
    const defaultLevelTolerance = calculateDeckGeometryFromSourceJson(
      JSON.stringify(multiLevel)
    );
    expect(defaultLevelTolerance.full_precision.area_square_inches).toBe(100);

    source.config.endpointSnapRadius = 0;
    const exactIdentityOnly = calculateDeckGeometryFromSourceJson(
      JSON.stringify(source)
    );
    expect(exactIdentityOnly.measurements.area_square_feet).toEqual({
      state: "unavailable",
      warning: "closed_surface_unavailable",
    });
  });

  it("fails closed when persisted component witnesses disagree", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const source = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    const components = source.components as JsonObject[];
    const railing = components.find(
      (component) => component.component_type === "railing"
    )!;
    (railing.metadata as JsonObject).linear_feet = 999;
    expectSourceError("DECK_GEOMETRY_COMPONENT_WITNESS_MISMATCH", () =>
      calculateDeckGeometryFromSourceJson(JSON.stringify(source))
    );
  });

  it("treats an explicit null component vector as absent legacy data", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const source = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    source.components = null;

    const result = calculateDeckGeometryFromSourceJson(JSON.stringify(source));

    expect(result.measurements.component_witness).toEqual({
      state: "unavailable",
      warning: "components_absent_legacy",
    });
    expect(result.measurements.area_square_feet).toEqual({
      state: "authoritative",
      value: 120,
      warning: null,
    });
  });

  it("rejects forbidden Unicode controls before projecting untrusted design data", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const source = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    const railing = ((source.edges as JsonObject[])[0]!.railingConfig ??
      {}) as JsonObject;
    railing.railingType = `glass\u{E0001}`;

    expectSourceError("DECK_GEOMETRY_SOURCE_DATA_INVALID", () =>
      calculateDeckGeometryFromSourceJson(JSON.stringify(source))
    );
  });

  it("fails malformed and unresolved surface transitions as invalid geometry", () => {
    const sourceFixture = fixture(
      "ops-decks-ios",
      "single-level-gate-stair-parapet"
    );
    const source = structuredClone(
      sourceFixture.input_drawing_json
    ) as JsonObject;
    delete source.components;
    const vertexIds = (source.vertices as JsonObject[]).map(
      (vertex) => vertex.id
    );
    source.surfaces = [
      { id: "surface-a", vertexIds },
      { id: "surface-b", vertexIds },
    ];
    source.surfaceConnections = [
      {
        id: "transition-a-b",
        edgeId: "single-e1",
        upperSurfaceId: "surface-a",
        lowerSurfaceId: "surface-b",
        kind: "steps",
        widthInches: -1,
        runPerStepInches: 10,
      },
    ];

    expectSourceError("DECK_GEOMETRY_SOURCE_DATA_INVALID", () =>
      calculateDeckGeometryFromSourceJson(JSON.stringify(source))
    );

    (source.surfaceConnections as JsonObject[])[0]!.widthInches = 36;
    expectSourceError("DECK_GEOMETRY_REFERENCE_INVALID", () =>
      calculateDeckGeometryFromSourceJson(JSON.stringify(source))
    );
  });

  it("accepts every exact parser ceiling and rejects each ceiling plus one", () => {
    const minimal = JSON.stringify({ levels: [] });
    expect(
      parseDeckGeometrySource(
        minimal + " ".repeat(DECK_GEOMETRY_MAX_SOURCE_BYTES - minimal.length)
      ).topology_units
    ).toBe(1);
    expectSourceError("DECK_GEOMETRY_SOURCE_TOO_LARGE", () =>
      parseDeckGeometrySource("x".repeat(DECK_GEOMETRY_MAX_SOURCE_BYTES + 1))
    );
    expectSourceError("DECK_GEOMETRY_SOURCE_JSON_INVALID", () =>
      parseDeckGeometrySource("{")
    );

    const exactPlanes = {
      levels: Array.from({ length: 16 }, (_, index) => ({
        id: `level-${index + 1}`,
        vertices: [],
        edges: [],
        surfaces: [],
      })),
    };
    expect(
      parseDeckGeometrySource(JSON.stringify(exactPlanes)).planes
    ).toHaveLength(16);
    expectSourceError("DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED", () =>
      parseDeckGeometrySource(
        JSON.stringify({
          levels: [
            ...exactPlanes.levels,
            { id: "level-17", vertices: [], edges: [], surfaces: [] },
          ],
        })
      )
    );

    const tooManyVertices = exactTopologySource(false);
    ((tooManyVertices.levels as JsonObject[])[0]!.vertices as unknown[]).push({
      id: "overflow",
      position: [0, 0],
    });
    expectSourceError("DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED", () =>
      parseDeckGeometrySource(JSON.stringify(tooManyVertices))
    );

    const tooManyEdges = exactTopologySource(false);
    const firstLevel = (tooManyEdges.levels as JsonObject[])[0]!;
    (firstLevel.edges as unknown[]).push({
      id: "overflow-edge",
      startVertexId: "p0-v001",
      endVertexId: "p0-v002",
    });
    expectSourceError("DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED", () =>
      parseDeckGeometrySource(JSON.stringify(tooManyEdges))
    );

    const exactSurfacesAndBoundaries = pentagonSurfaceSource(64);
    const exactParsed = parseDeckGeometrySource(
      JSON.stringify(exactSurfacesAndBoundaries)
    );
    expect(exactParsed.planes[0]?.surfaces).toHaveLength(64);
    expect(exactParsed.topology_units).toBe(395);

    const tooManySurfaces = pentagonSurfaceSource(65);
    expectSourceError("DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED", () =>
      parseDeckGeometrySource(JSON.stringify(tooManySurfaces))
    );

    const tooManyBoundaryReferences = pentagonSurfaceSource(64);
    const firstSurface = (
      (tooManyBoundaryReferences.levels as JsonObject[])[0]!
        .surfaces as JsonObject[]
    )[0]!;
    const firstLoop = (firstSurface.boundary as JsonObject)
      .outerLoop as unknown[];
    firstLoop.push(structuredClone(firstLoop[0]));
    expectSourceError("DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED", () =>
      parseDeckGeometrySource(JSON.stringify(tooManyBoundaryReferences))
    );

    const tooManyConnections = exactTopologySource(false);
    (tooManyConnections.levelConnections as unknown[]).push({});
    expectSourceError("DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED", () =>
      parseDeckGeometrySource(JSON.stringify(tooManyConnections))
    );

    const exact500 = parseDeckGeometrySource(
      JSON.stringify(exactTopologySource(false))
    );
    expect(exact500.topology_units).toBe(500);

    expectSourceError("DECK_GEOMETRY_TOPOLOGY_LIMIT_EXCEEDED", () =>
      parseDeckGeometrySource(JSON.stringify(exactTopologySource(true)))
    );
  });

  it("maps derived topology growth to the same explicit collection bound", () => {
    const source = pentagonSurfaceSource(64);
    const level = (source.levels as JsonObject[])[0]!;
    const vertices = level.vertices as JsonObject[];
    const edges = level.edges as JsonObject[];
    vertices.push(
      { id: "overflow-v1", position: [30, 0] },
      { id: "overflow-v2", position: [40, 0] },
      { id: "overflow-v3", position: [35, 10] }
    );
    edges.push(
      {
        id: "overflow-e1",
        startVertexId: "overflow-v1",
        endVertexId: "overflow-v2",
      },
      {
        id: "overflow-e2",
        startVertexId: "overflow-v2",
        endVertexId: "overflow-v3",
      },
      {
        id: "overflow-e3",
        startVertexId: "overflow-v3",
        endVertexId: "overflow-v1",
      }
    );

    expectSourceError("DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED", () =>
      calculateDeckGeometryFromSourceJson(JSON.stringify(source))
    );
  });
});
