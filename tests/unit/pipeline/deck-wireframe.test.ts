/**
 * Deck wireframe geometry — normalizes iOS `drawing_data` vertices/edges
 * into a square SVG viewBox of line segments. Legacy tolerance is the whole
 * game (bible 03 § deck_designs): missing keys, numeric-string positions,
 * dangling edge endpoints — a malformed row must degrade to `null` (icon
 * fallback), never throw.
 */

import { describe, expect, it } from "vitest";
import { buildWireframeModel } from "@/lib/utils/deck-wireframe";

const rect = {
  vertices: [
    { id: "v1", position: [0, 0] },
    { id: "v2", position: [200, 0] },
    { id: "v3", position: [200, 100] },
    { id: "v4", position: [0, 100] },
  ],
  edges: [
    { id: "e1", startVertexId: "v1", endVertexId: "v2" },
    { id: "e2", startVertexId: "v2", endVertexId: "v3" },
    { id: "e3", startVertexId: "v3", endVertexId: "v4" },
    { id: "e4", startVertexId: "v4", endVertexId: "v1" },
  ],
};

describe("buildWireframeModel", () => {
  it("maps a rectangle into the padded 100-unit viewBox", () => {
    const model = buildWireframeModel(rect.vertices, rect.edges);
    expect(model).not.toBeNull();
    expect(model!.viewBox).toBe("0 0 100 100");
    expect(model!.segments).toHaveLength(4);
    for (const s of model!.segments) {
      for (const n of [s.x1, s.y1, s.x2, s.y2]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(100);
      }
    }
  });

  it("preserves aspect ratio — a 2:1 deck spans full width, half height, centered", () => {
    const model = buildWireframeModel(rect.vertices, rect.edges)!;
    const xs = model.segments.flatMap((s) => [s.x1, s.x2]);
    const ys = model.segments.flatMap((s) => [s.y1, s.y2]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(w / h).toBeCloseTo(2, 5);
    // Short axis centered in the box.
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(100, 5);
  });

  it("skips edges whose endpoints are missing, keeping the rest", () => {
    const model = buildWireframeModel(rect.vertices, [
      ...rect.edges,
      { id: "dangling", startVertexId: "v1", endVertexId: "ghost" },
    ]);
    expect(model!.segments).toHaveLength(4);
  });

  it("coerces numeric-string positions (legacy payloads)", () => {
    const model = buildWireframeModel(
      [
        { id: "v1", position: ["0", "0"] },
        { id: "v2", position: ["100", "50"] },
      ],
      [{ id: "e1", startVertexId: "v1", endVertexId: "v2" }],
    );
    expect(model).not.toBeNull();
    expect(model!.segments).toHaveLength(1);
  });

  it("returns null for degenerate input: no edges, no vertices, or zero-area", () => {
    expect(buildWireframeModel([], [])).toBeNull();
    expect(buildWireframeModel(rect.vertices, [])).toBeNull();
    expect(
      buildWireframeModel(
        [
          { id: "v1", position: [5, 5] },
          { id: "v2", position: [5, 5] },
        ],
        [{ id: "e1", startVertexId: "v1", endVertexId: "v2" }],
      ),
    ).toBeNull();
  });

  it("returns null (not a throw) for garbage shapes", () => {
    expect(buildWireframeModel(undefined, undefined)).toBeNull();
    expect(
      buildWireframeModel(
        [{ id: "v1" }, { id: "v2", position: [Number.NaN, 3] }] as never,
        [{ id: "e1", startVertexId: "v1", endVertexId: "v2" }],
      ),
    ).toBeNull();
  });

  it("handles a straight-line deck edge run (zero height) by centering it", () => {
    const model = buildWireframeModel(
      [
        { id: "v1", position: [0, 40] },
        { id: "v2", position: [300, 40] },
      ],
      [{ id: "e1", startVertexId: "v1", endVertexId: "v2" }],
    );
    expect(model).not.toBeNull();
    const [s] = model!.segments;
    expect(s.y1).toBeCloseTo(50, 5);
    expect(s.y2).toBeCloseTo(50, 5);
  });
});
