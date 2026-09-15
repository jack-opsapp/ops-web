/**
 * `parseDeckDrawing` — the client-safe port of the server geometry calculator.
 *
 * The bar is not "it renders something". The bar is that the web viewer and
 * the agent control plane read the SAME deck out of the same JSON: identical
 * surface counts per level and identical enclosed area. Both are pinned here
 * against the immutable golden fixtures produced by the two iOS apps, and
 * cross-checked against `calculateDeckGeometryFromSourceJson` itself.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { calculateDeckGeometryFromSourceJson } from "@/lib/agent-control-plane/services/p2/deck-design/deck-geometry-calculator";
import { parseDeckDrawing, totalAreaSquareInches } from "@/lib/deck/drawing-data";

const FIXTURE_ROOT = resolve(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/deck-design/__fixtures__",
);

type JsonObject = Record<string, unknown>;

interface Fixture {
  readonly repository: string;
  readonly name: string;
  readonly body: JsonObject;
}

function loadFixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const repository of ["ops-ios", "ops-decks-ios"]) {
    const dir = resolve(FIXTURE_ROOT, repository);
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue;
      out.push({
        repository,
        name: file.replace(/\.json$/, ""),
        body: JSON.parse(
          readFileSync(resolve(dir, file), "utf8"),
        ) as JsonObject,
      });
    }
  }
  return out;
}

const fixtures = loadFixtures();
/** Fixtures that pin a calculator result (the `native-*` ones pin raw JSON only). */
const measured = fixtures.filter(
  (fixture) => "expected_full_precision_square_inches" in fixture.body,
);
/** Fixtures that are a bare `drawing_data` payload with no expectations. */
const native = fixtures.filter((fixture) => "drawing_data" in fixture.body);

describe("deck fixture corpus", () => {
  it("covers both producer repositories", () => {
    expect(fixtures.length).toBe(13);
    expect(measured.length).toBe(11);
    expect(native.length).toBe(2);
  });
});

describe.each(measured)(
  "parseDeckDrawing — $repository/$name",
  ({ body }) => {
    const drawing = body.input_drawing_json as JsonObject;
    const server = calculateDeckGeometryFromSourceJson(JSON.stringify(drawing));

    it("reads the same levels the calculator reads", () => {
      const parsed = parseDeckDrawing(drawing);
      expect(parsed).not.toBeNull();
      expect(parsed!.levels).toHaveLength(server.topology.planes.length);
    });

    it("detects the same surface count on every level", () => {
      const parsed = parseDeckDrawing(drawing)!;
      expect(parsed.levels.map((level) => level.surfaces.length)).toEqual(
        server.topology.planes.map((plane) => plane.surfaces.length),
      );
    });

    it("computes the calculator's enclosed area to the square inch", () => {
      const parsed = parseDeckDrawing(drawing)!;
      const expected = body.expected_full_precision_square_inches as
        | number
        | null;
      expect(server.full_precision.area_square_inches).toBe(expected);

      const actual = totalAreaSquareInches(parsed);
      if (expected === null) {
        expect(actual).toBeNull();
      } else {
        expect(actual).toBeCloseTo(expected, 6);
      }
    });

    it("carries the calculator's scale factor", () => {
      const parsed = parseDeckDrawing(drawing)!;
      expect(parsed.scaleFactor).toBe(
        (drawing.scaleFactor as number | undefined) ?? 2,
      );
    });
  },
);

describe.each(native)("parseDeckDrawing — native $repository/$name", ({ body }) => {
  it("reads multi-level geometry out of levels[] with empty root arrays", () => {
    const parsed = parseDeckDrawing(body.drawing_data);
    expect(parsed).not.toBeNull();
    expect(parsed!.levels.length).toBeGreaterThan(1);
    expect(parsed!.isMultiLevel).toBe(true);
    // Every level carries drawable geometry — the exact bug b130d23f hid.
    for (const level of parsed!.levels) {
      expect(level.edges.length).toBeGreaterThan(0);
      expect(level.vertices.length).toBeGreaterThan(0);
    }
    expect(parsed!.bounds).not.toBeNull();
    expect(parsed!.bounds!.width).toBeGreaterThan(0);
    expect(parsed!.bounds!.height).toBeGreaterThan(0);
  });
});

describe("parseDeckDrawing — legacy tolerance", () => {
  it("returns null for junk rather than throwing", () => {
    for (const junk of [null, undefined, 42, "drawing", [], {}]) {
      expect(() => parseDeckDrawing(junk)).not.toThrow();
      expect(parseDeckDrawing(junk)).toBeNull();
    }
  });

  it("drops vertices and edges it cannot trust instead of failing the drawing", () => {
    const parsed = parseDeckDrawing({
      vertices: [
        { id: "v1", position: [0, 0] },
        { id: "v2", position: ["96", "0"] },
        { id: "v3", position: [96, 72] },
        { id: "v4", position: [0, 72] },
        { id: "bad", position: [Number.NaN, 4] },
        { position: [1, 1] },
      ],
      edges: [
        { id: "e1", startVertexId: "v1", endVertexId: "v2" },
        { id: "e2", startVertexId: "v2", endVertexId: "v3" },
        { id: "e3", startVertexId: "v3", endVertexId: "v4" },
        { id: "e4", startVertexId: "v4", endVertexId: "v1" },
        { id: "dangling", startVertexId: "v1", endVertexId: "ghost" },
        { id: "loop", startVertexId: "v1", endVertexId: "v1" },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.levels[0]!.vertices).toHaveLength(4);
    expect(parsed!.levels[0]!.edges).toHaveLength(4);
    // Numeric strings are coerced exactly like the calculator does.
    expect(parsed!.levels[0]!.vertices[1]!.position).toEqual({ x: 96, y: 0 });
    expect(parsed!.levels[0]!.surfaces).toHaveLength(1);
    expect(totalAreaSquareInches(parsed!)).toBeCloseTo((96 * 72) / 4, 6);
  });

  it("defaults the scale factor to 2 when absent or non-positive", () => {
    const geometry = {
      vertices: [
        { id: "v1", position: [0, 0] },
        { id: "v2", position: [10, 0] },
        { id: "v3", position: [10, 10] },
      ],
      edges: [
        { id: "e1", startVertexId: "v1", endVertexId: "v2" },
        { id: "e2", startVertexId: "v2", endVertexId: "v3" },
        { id: "e3", startVertexId: "v3", endVertexId: "v1" },
      ],
    };
    expect(parseDeckDrawing(geometry)!.scaleFactor).toBe(2);
    expect(parseDeckDrawing({ ...geometry, scaleFactor: 0 })!.scaleFactor).toBe(2);
    expect(parseDeckDrawing({ ...geometry, scaleFactor: -4 })!.scaleFactor).toBe(2);
    expect(parseDeckDrawing({ ...geometry, scaleFactor: 3 })!.scaleFactor).toBe(3);
  });

  it("keeps the edge role, dimension, label and stair the viewer draws", () => {
    const parsed = parseDeckDrawing({
      scaleFactor: 1,
      vertices: [
        { id: "v1", position: [0, 0] },
        { id: "v2", position: [144, 0] },
        { id: "v3", position: [144, 120] },
        { id: "v4", position: [0, 120] },
      ],
      edges: [
        {
          id: "e1",
          startVertexId: "v1",
          endVertexId: "v2",
          edgeType: "house_edge",
          dimension: 144,
        },
        {
          id: "e2",
          startVertexId: "v2",
          endVertexId: "v3",
          dimension: 120,
          label: "gate side",
          stairConfig: { width: 48, risePerStep: 7.5, runPerTread: 10, treadCount: 3 },
        },
        { id: "e3", startVertexId: "v3", endVertexId: "v4", dimension: 144 },
        {
          id: "e4",
          startVertexId: "v4",
          endVertexId: "v1",
          railingConfig: { railingType: "parapet_wall" },
        },
      ],
    })!;

    const level = parsed.levels[0]!;
    const byId = new Map(level.edges.map((edge) => [edge.id, edge]));
    expect(byId.get("e1")!.boundaryRole).toBe("house");
    expect(byId.get("e2")!.boundaryRole).toBe("open");
    expect(byId.get("e2")!.dimensionInches).toBe(120);
    expect(byId.get("e2")!.label).toBe("gate side");
    expect(byId.get("e2")!.stair).toEqual({
      width: 48,
      runPerTread: 10,
      risePerStep: 7.5,
      treadCount: 3,
      alignment: "center",
      offset: 0,
      flipDirection: false,
    });
    expect(byId.get("e4")!.boundaryRole).toBe("wall");
    expect(byId.get("e4")!.dimensionInches).toBeNull();
  });

  it("derives a missing tread count from the stair's total rise", () => {
    const withStair = (stairConfig: Record<string, unknown>) =>
      parseDeckDrawing({
        scaleFactor: 1,
        vertices: [
          { id: "v1", position: [0, 0] },
          { id: "v2", position: [144, 0] },
          { id: "v3", position: [144, 120] },
        ],
        edges: [
          { id: "e1", startVertexId: "v1", endVertexId: "v2", stairConfig },
          { id: "e2", startVertexId: "v2", endVertexId: "v3" },
        ],
      })!.levels[0]!.edges[0]!.stair;

    // 36" of rise at the 7.5" default riser is five steps (rounded up).
    expect(withStair({ width: 48, totalRiseInches: 36 })?.treadCount).toBe(5);
    expect(
      withStair({ width: 48, totalRiseInches: 36, risePerStep: 6 })?.treadCount,
    ).toBe(6);
    // An explicit count always wins over the derivation.
    expect(
      withStair({ width: 48, totalRiseInches: 36, treadCount: 2 })?.treadCount,
    ).toBe(2);
    // Nothing to derive from, and nothing invented.
    expect(withStair({ width: 48 })?.treadCount).toBeNull();
    // Hostile input can neither invent a stair nor ask for a million treads.
    expect(withStair({ width: 48, totalRiseInches: 1e9 })?.treadCount).toBe(500);
    expect(
      withStair({ width: 48, totalRiseInches: 36, risePerStep: 0 })?.treadCount,
    ).toBeNull();
  });

  it("names levels, keeps their order, and exposes the display colour", () => {
    const square = (offset: number) => ({
      vertices: [
        { id: `${offset}-v1`, position: [offset, 0] },
        { id: `${offset}-v2`, position: [offset + 40, 0] },
        { id: `${offset}-v3`, position: [offset + 40, 40] },
        { id: `${offset}-v4`, position: [offset, 40] },
      ],
      edges: [
        { id: `${offset}-e1`, startVertexId: `${offset}-v1`, endVertexId: `${offset}-v2` },
        { id: `${offset}-e2`, startVertexId: `${offset}-v2`, endVertexId: `${offset}-v3` },
        { id: `${offset}-e3`, startVertexId: `${offset}-v3`, endVertexId: `${offset}-v4` },
        { id: `${offset}-e4`, startVertexId: `${offset}-v4`, endVertexId: `${offset}-v1` },
      ],
    });

    const parsed = parseDeckDrawing({
      scaleFactor: 1,
      vertices: [],
      edges: [],
      levels: [
        { id: "upper", name: "Upper deck", sortOrder: 1, elevation: 8, displayColor: "green", ...square(200) },
        { id: "lower", name: "Lower deck", sortOrder: 0, elevation: 2, displayColor: "blue", ...square(0) },
      ],
    })!;

    expect(parsed.isMultiLevel).toBe(true);
    expect(parsed.levels.map((level) => level.id)).toEqual(["lower", "upper"]);
    expect(parsed.levels.map((level) => level.name)).toEqual([
      "Lower deck",
      "Upper deck",
    ]);
    expect(parsed.levels.map((level) => level.displayColor)).toEqual([
      "blue",
      "green",
    ]);
    expect(parsed.levels[1]!.elevationFeet).toBe(8);
    expect(parsed.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 240,
      maxY: 40,
      width: 240,
      height: 40,
    });
  });

  it("marks a design with no closed surface honestly", () => {
    const parsed = parseDeckDrawing({
      vertices: [
        { id: "v1", position: [0, 0] },
        { id: "v2", position: [100, 0] },
        { id: "v3", position: [100, 50] },
      ],
      edges: [
        { id: "e1", startVertexId: "v1", endVertexId: "v2" },
        { id: "e2", startVertexId: "v2", endVertexId: "v3" },
      ],
    })!;

    expect(parsed.hasClosedSurface).toBe(false);
    expect(parsed.levels[0]!.surfaces).toHaveLength(0);
    expect(totalAreaSquareInches(parsed)).toBeNull();
  });

  it("keeps a surface hole out of the enclosed area", () => {
    const parsed = parseDeckDrawing({
      scaleFactor: 1,
      vertices: [
        { id: "o1", position: [0, 0] },
        { id: "o2", position: [120, 0] },
        { id: "o3", position: [120, 120] },
        { id: "o4", position: [0, 120] },
        { id: "h1", position: [40, 40] },
        { id: "h2", position: [80, 40] },
        { id: "h3", position: [80, 80] },
        { id: "h4", position: [40, 80] },
      ],
      edges: [
        { id: "oe1", startVertexId: "o1", endVertexId: "o2" },
        { id: "oe2", startVertexId: "o2", endVertexId: "o3" },
        { id: "oe3", startVertexId: "o3", endVertexId: "o4" },
        { id: "oe4", startVertexId: "o4", endVertexId: "o1" },
        { id: "he1", startVertexId: "h1", endVertexId: "h2" },
        { id: "he2", startVertexId: "h2", endVertexId: "h3" },
        { id: "he3", startVertexId: "h3", endVertexId: "h4" },
        { id: "he4", startVertexId: "h4", endVertexId: "h1" },
      ],
    })!;

    expect(totalAreaSquareInches(parsed)).toBeCloseTo(120 * 120 - 40 * 40, 6);
  });
});
