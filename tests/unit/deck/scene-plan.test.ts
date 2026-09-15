/**
 * The 3D massing plan.
 *
 * The scene builder is pure on purpose: what the operator sees in 3D is a
 * geometric CLAIM about their deck — how high it sits, how many posts hold it
 * up, how far the stairs run — and a claim like that has to be checked in a
 * test, not eyeballed in a canvas. The R3F component only turns this plan into
 * meshes; every decision worth being wrong about is made here.
 */

import { describe, expect, it } from "vitest";

import { parseDeckDrawing } from "@/lib/deck/drawing-data";
import {
  BOARD_THICKNESS_FT,
  buildScenePlan,
  HOUSE_WALL_HEIGHT_FT,
} from "@/lib/deck/scene-plan";

/** A 12ft × 10ft deck: scaleFactor 2 means 2 canvas units per inch. */
function squareDeck(extra: Record<string, unknown> = {}) {
  return parseDeckDrawing({
    scaleFactor: 2,
    vertices: [
      { id: "v1", position: [0, 0] },
      { id: "v2", position: [288, 0] },
      { id: "v3", position: [288, 240] },
      { id: "v4", position: [0, 240] },
    ],
    edges: [
      { id: "e1", startVertexId: "v1", endVertexId: "v2", edgeType: "house_edge" },
      { id: "e2", startVertexId: "v2", endVertexId: "v3" },
      { id: "e3", startVertexId: "v3", endVertexId: "v4" },
      { id: "e4", startVertexId: "v4", endVertexId: "v1" },
    ],
    ...extra,
  })!;
}

describe("buildScenePlan", () => {
  it("extrudes each surface to board thickness at the level's elevation", () => {
    const plan = buildScenePlan(squareDeck());
    expect(plan.levels).toHaveLength(1);
    const [level] = plan.levels;
    expect(level!.decks).toHaveLength(1);
    // A deck with no stored height sits on the ground, not floating.
    expect(level!.decks[0]!.top).toBeCloseTo(0, 6);
    expect(level!.decks[0]!.thickness).toBeCloseTo(BOARD_THICKNESS_FT, 6);
  });

  it("works in feet, so a 12ft × 10ft deck is 12 by 10", () => {
    const plan = buildScenePlan(squareDeck());
    const outline = plan.levels[0]!.decks[0]!.outer;
    const xs = outline.map((point) => point[0]);
    const zs = outline.map((point) => point[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(12, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(10, 6);
  });

  it("stands the house edge up as a wall and leaves the open runs clear", () => {
    const plan = buildScenePlan(squareDeck());
    const level = plan.levels[0]!;
    expect(level.walls).toHaveLength(1);
    expect(level.walls[0]!.height).toBeCloseTo(HOUSE_WALL_HEIGHT_FT, 6);
    // Rim beams run under the deck's own edges, never under the house wall.
    expect(level.rimBeams).toHaveLength(3);
  });

  it("puts posts under a raised deck and none under one at grade", () => {
    expect(buildScenePlan(squareDeck()).levels[0]!.posts).toHaveLength(0);

    const raised = buildScenePlan(
      squareDeck({
        levels: [
          {
            id: "L1",
            elevation: 6,
            scaleFactor: 2,
            vertices: [
              { id: "v1", position: [0, 0] },
              { id: "v2", position: [288, 0] },
              { id: "v3", position: [288, 240] },
              { id: "v4", position: [0, 240] },
            ],
            edges: [
              { id: "e1", startVertexId: "v1", endVertexId: "v2" },
              { id: "e2", startVertexId: "v2", endVertexId: "v3" },
              { id: "e3", startVertexId: "v3", endVertexId: "v4" },
              { id: "e4", startVertexId: "v4", endVertexId: "v1" },
            ],
          },
        ],
      }),
    );
    const level = raised.levels[0]!;
    expect(level.decks[0]!.top).toBeCloseTo(6, 6);
    // One post per corner of the outline, each reaching the ground.
    expect(level.posts).toHaveLength(4);
    expect(level.posts.every((post) => post.height > 0)).toBe(true);
    expect(level.posts[0]!.height).toBeCloseTo(6 - BOARD_THICKNESS_FT, 6);
  });

  it("descends the stairs one riser and one run per tread", () => {
    const drawing = parseDeckDrawing({
      scaleFactor: 2,
      vertices: [
        { id: "v1", position: [0, 0] },
        { id: "v2", position: [288, 0] },
        { id: "v3", position: [288, 240] },
        { id: "v4", position: [0, 240] },
      ],
      edges: [
        { id: "e1", startVertexId: "v1", endVertexId: "v2", edgeType: "house_edge" },
        { id: "e2", startVertexId: "v2", endVertexId: "v3" },
        {
          id: "e3",
          startVertexId: "v3",
          endVertexId: "v4",
          stairConfig: {
            width: 48,
            runPerTread: 10,
            risePerStep: 7.5,
            treadCount: 4,
            alignment: "center",
          },
        },
        { id: "e4", startVertexId: "v4", endVertexId: "v1" },
      ],
    })!;

    const level = buildScenePlan(drawing).levels[0]!;
    expect(level.stairs).toHaveLength(1);
    const treads = level.stairs[0]!.treads;
    expect(treads).toHaveLength(4);
    // Each tread drops one riser below the last.
    const drops = treads.slice(1).map((tread, i) => treads[i]!.top - tread.top);
    expect(drops.every((drop) => Math.abs(drop - 7.5 / 12) < 1e-9)).toBe(true);
    // The first tread is one riser below the deck, not level with it.
    expect(treads[0]!.top).toBeCloseTo(-7.5 / 12, 9);
    // 4 treads at a 10" run reach 40" — 3ft 4in — out from the edge.
    expect(treads[0]!.depth).toBeCloseTo(10 / 12, 9);
  });

  it("frames the whole design so the camera has somewhere honest to sit", () => {
    const plan = buildScenePlan(squareDeck());
    expect(plan.focus.radius).toBeGreaterThan(0);
    expect(Number.isFinite(plan.focus.center[0])).toBe(true);
    expect(Number.isFinite(plan.focus.center[1])).toBe(true);
    expect(Number.isFinite(plan.focus.center[2])).toBe(true);
  });

  it("carries each level's colour key so the massing reads as levels", () => {
    const drawing = parseDeckDrawing({
      scaleFactor: 2,
      levels: [
        {
          id: "L1",
          displayColor: "blue",
          elevation: 0,
          vertices: [
            { id: "a1", position: [0, 0] },
            { id: "a2", position: [240, 0] },
            { id: "a3", position: [240, 240] },
            { id: "a4", position: [0, 240] },
          ],
          edges: [
            { id: "x1", startVertexId: "a1", endVertexId: "a2" },
            { id: "x2", startVertexId: "a2", endVertexId: "a3" },
            { id: "x3", startVertexId: "a3", endVertexId: "a4" },
            { id: "x4", startVertexId: "a4", endVertexId: "a1" },
          ],
        },
        {
          id: "L2",
          displayColor: "green",
          elevation: 4,
          vertices: [
            { id: "b1", position: [300, 0] },
            { id: "b2", position: [480, 0] },
            { id: "b3", position: [480, 180] },
            { id: "b4", position: [300, 180] },
          ],
          edges: [
            { id: "y1", startVertexId: "b1", endVertexId: "b2" },
            { id: "y2", startVertexId: "b2", endVertexId: "b3" },
            { id: "y3", startVertexId: "b3", endVertexId: "b4" },
            { id: "y4", startVertexId: "b4", endVertexId: "b1" },
          ],
        },
      ],
    })!;

    const plan = buildScenePlan(drawing);
    expect(plan.levels.map((level) => level.colorKey)).toEqual(["blue", "green"]);
    expect(plan.levels[1]!.decks[0]!.top).toBeCloseTo(4, 6);
  });

  it("drops levels the operator has isolated away from", () => {
    const drawing = squareDeck();
    const plan = buildScenePlan(drawing, drawing.levels[0]!.id);
    expect(plan.levels).toHaveLength(1);
    expect(buildScenePlan(drawing, "nope").levels).toHaveLength(0);
  });

  it("returns an empty plan rather than throwing on a drawing with no surface", () => {
    const drawing = parseDeckDrawing({
      scaleFactor: 2,
      vertices: [
        { id: "v1", position: [0, 0] },
        { id: "v2", position: [100, 0] },
      ],
      edges: [{ id: "e1", startVertexId: "v1", endVertexId: "v2" }],
    });
    const plan = buildScenePlan(drawing!);
    expect(plan.levels.flatMap((level) => level.decks)).toHaveLength(0);
    expect(Number.isFinite(plan.focus.radius)).toBe(true);
  });
});
