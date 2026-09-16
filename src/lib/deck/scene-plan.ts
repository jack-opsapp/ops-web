/**
 * OPS Web — the deck's 3D massing, as data.
 *
 * Switching to 3D turns a plan into a CLAIM about the built thing: this deck
 * sits six feet up, it needs four posts, its stairs run three and a half feet
 * out. A claim like that belongs in a tested module, not inside a render loop
 * — so this file decides every dimension and `deck-scene-3d.tsx` only turns
 * the result into meshes.
 *
 * Units: FEET, y-up. The plan is in canvas units; `scaleFactor` is canvas
 * units per inch, so feet = canvas / scaleFactor / 12. Plan x → world x and
 * plan y → world z, which lands the drawing flat on the ground the same way
 * up as it is on paper.
 *
 * Massing only — this is not a framing plan. Joist layout, beam spans, footing
 * sizes and hardware are the estimator's job, and inventing them here would
 * dress a sketch up as an engineered drawing.
 */

import type { DeckDrawing, DeckLevel, DeckLevelColor, DeckPoint } from "./drawing-data";

/** 2x framing: the deck slab reads as the top of the joists. */
export const BOARD_THICKNESS_FT = 1.5 / 12;
/** A 2x10 rim joist, the common case under a residential deck edge. */
export const RIM_BEAM_DEPTH_FT = 9.25 / 12;
/** One storey of house behind the ledger — context, not a modelled building. */
export const HOUSE_WALL_HEIGHT_FT = 8;
/** A 6x6 post. */
export const POST_SIZE_FT = 5.5 / 12;
/** IRC R311.7 defaults, used only when the stair itself stored nothing. */
const DEFAULT_RISE_IN = 7.5;
const DEFAULT_RUN_IN = 10;

/** A point on the ground plane: [x, z] in feet. */
export type ScenePoint = readonly [number, number];

export interface SceneDeckSlab {
  readonly id: string;
  readonly outer: readonly ScenePoint[];
  readonly holes: readonly (readonly ScenePoint[])[];
  /** Walking surface height in feet. The slab hangs `thickness` below it. */
  readonly top: number;
  readonly thickness: number;
}

export interface SceneBeam {
  readonly id: string;
  readonly from: ScenePoint;
  readonly to: ScenePoint;
  /** Height of the beam's TOP face. */
  readonly top: number;
  readonly depth: number;
}

export interface SceneWall {
  readonly id: string;
  readonly from: ScenePoint;
  readonly to: ScenePoint;
  /** Height of the wall's base — the level it shelters. */
  readonly base: number;
  readonly height: number;
}

export interface ScenePost {
  readonly id: string;
  readonly at: ScenePoint;
  /** Base is always the ground; the post reaches `height` feet up to the frame. */
  readonly height: number;
  readonly size: number;
}

export interface SceneTread {
  readonly from: ScenePoint;
  readonly to: ScenePoint;
  /** Walking height of this tread. */
  readonly top: number;
  /** How far the tread projects out from the deck edge. */
  readonly depth: number;
}

export interface SceneStair {
  readonly id: string;
  readonly treads: readonly SceneTread[];
}

export interface SceneLevel {
  readonly id: string;
  readonly name: string | null;
  readonly colorKey: DeckLevelColor | null;
  readonly elevation: number;
  readonly decks: readonly SceneDeckSlab[];
  readonly rimBeams: readonly SceneBeam[];
  readonly walls: readonly SceneWall[];
  readonly posts: readonly ScenePost[];
  readonly stairs: readonly SceneStair[];
}

export interface DeckScenePlan {
  readonly levels: readonly SceneLevel[];
  /** Everything the camera has to hold: centre and bounding radius, in feet. */
  readonly focus: {
    readonly center: readonly [number, number, number];
    readonly radius: number;
  };
}

const EMPTY_FOCUS = { center: [0, 0, 0] as const, radius: 1 };

/**
 * Build the massing. `isolatedLevelId` drops every other level so isolating a
 * level in 2D means the same thing in 3D — the operator's question is "what is
 * on THIS level", and answering it differently per view would be a lie.
 */
export function buildScenePlan(
  drawing: DeckDrawing,
  isolatedLevelId: string | null = null,
): DeckScenePlan {
  const perFoot = drawing.scaleFactor * 12;
  if (!(perFoot > 0)) return { levels: [], focus: EMPTY_FOCUS };

  const toScene = (point: DeckPoint): ScenePoint => [
    point.x / perFoot,
    point.y / perFoot,
  ];

  const levels = drawing.levels
    .filter((level) => isolatedLevelId === null || level.id === isolatedLevelId)
    .map((level) => buildLevel(level, drawing.scaleFactor, toScene));

  return { levels, focus: focusOf(levels) };
}

function buildLevel(
  level: DeckLevel,
  scaleFactor: number,
  toScene: (point: DeckPoint) => ScenePoint,
): SceneLevel {
  const elevation = level.elevationFeet ?? 0;

  const decks: SceneDeckSlab[] = level.surfaces.map((surface) => ({
    id: surface.id,
    outer: surface.outer.map(toScene),
    holes: surface.holes.map((hole) => hole.map(toScene)),
    top: elevation,
    thickness: BOARD_THICKNESS_FT,
  }));

  const rimBeams: SceneBeam[] = [];
  const walls: SceneWall[] = [];
  for (const edge of level.edges) {
    const from = toScene(edge.start);
    const to = toScene(edge.end);
    if (edge.boundaryRole === "house") {
      // The ledger side is the house. One storey of wall gives the massing a
      // back — without it a deck reads as a raft floating in nothing.
      walls.push({
        id: edge.id,
        from,
        to,
        base: elevation,
        height: HOUSE_WALL_HEIGHT_FT,
      });
    } else {
      // A rim joist hangs under every edge the deck actually owns.
      rimBeams.push({
        id: edge.id,
        from,
        to,
        top: elevation - BOARD_THICKNESS_FT,
        depth: RIM_BEAM_DEPTH_FT,
      });
    }
  }

  // Posts hold up a raised deck. A deck at grade has none, and drawing them
  // anyway would put phantom footings in a quote.
  const postHeight = elevation - BOARD_THICKNESS_FT;
  const posts: ScenePost[] =
    postHeight > 0
      ? cornerPoints(level, toScene).map((at, index) => ({
          id: `${level.id}:post:${index}`,
          at,
          height: postHeight,
          size: POST_SIZE_FT,
        }))
      : [];

  const stairs: SceneStair[] = [];
  for (const edge of level.edges) {
    const stair = edge.stair;
    if (!stair || !stair.treadCount || stair.treadCount <= 0) continue;
    stairs.push(
      buildStair(edge.id, edge.start, edge.end, stair, elevation, scaleFactor, toScene, level),
    );
  }

  return {
    id: level.id,
    name: level.name,
    colorKey: level.displayColor,
    elevation,
    decks,
    rimBeams,
    walls,
    posts,
    stairs,
  };
}

/** Outline corners a post could sit under — the surface, else the raw outline. */
function cornerPoints(
  level: DeckLevel,
  toScene: (point: DeckPoint) => ScenePoint,
): ScenePoint[] {
  const ring = level.surfaces[0]?.outer ?? level.fallbackOutline ?? [];
  return ring.map(toScene);
}

function buildStair(
  edgeId: string,
  start: DeckPoint,
  end: DeckPoint,
  stair: NonNullable<DeckLevel["edges"][number]["stair"]>,
  elevation: number,
  scaleFactor: number,
  toScene: (point: DeckPoint) => ScenePoint,
  level: DeckLevel,
): SceneStair {
  const a = toScene(start);
  const b = toScene(end);
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  if (length === 0) return { id: edgeId, treads: [] };

  const ux = dx / length;
  const uz = dz / length;
  // Left-hand normal, then flipped to point AWAY from the deck — stairs come
  // off a deck, they do not run back across it.
  let nx = -uz;
  let nz = ux;
  const interior = interiorPoint(level, toScene);
  const midX = (a[0] + b[0]) / 2;
  const midZ = (a[1] + b[1]) / 2;
  if (nx * (interior[0] - midX) + nz * (interior[1] - midZ) > 0) {
    nx = -nx;
    nz = -nz;
  }
  if (stair.flipDirection) {
    nx = -nx;
    nz = -nz;
  }

  const widthFt = Math.min(stair.width / 12, length);
  const offsetFt = stair.offset / 12;
  const alongStart =
    stair.alignment === "left"
      ? offsetFt
      : stair.alignment === "right"
        ? length - widthFt - offsetFt
        : (length - widthFt) / 2;

  const riseFt = (stair.risePerStep > 0 ? stair.risePerStep : DEFAULT_RISE_IN) / 12;
  const runFt = (stair.runPerTread > 0 ? stair.runPerTread : DEFAULT_RUN_IN) / 12;

  const at = (along: number, out: number): ScenePoint => [
    a[0] + ux * along + nx * out,
    a[1] + uz * along + nz * out,
  ];

  const treads: SceneTread[] = [];
  for (let step = 1; step <= stair.treadCount!; step += 1) {
    const depth = step * runFt;
    treads.push({
      from: at(alongStart, depth),
      to: at(alongStart + widthFt, depth),
      top: elevation - step * riseFt,
      depth,
    });
  }
  return { id: edgeId, treads };
}

function interiorPoint(
  level: DeckLevel,
  toScene: (point: DeckPoint) => ScenePoint,
): ScenePoint {
  const ring = level.surfaces[0]?.outer ?? level.fallbackOutline ?? [];
  if (ring.length === 0) return [0, 0];
  const points = ring.map(toScene);
  return [
    points.reduce((total, point) => total + point[0], 0) / points.length,
    points.reduce((total, point) => total + point[1], 0) / points.length,
  ];
}

/** Bounding sphere over everything the plan will draw. */
function focusOf(levels: readonly SceneLevel[]): DeckScenePlan["focus"] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const see = (point: ScenePoint, y: number) => {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minZ = Math.min(minZ, point[1]);
    maxZ = Math.max(maxZ, point[1]);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  for (const level of levels) {
    for (const slab of level.decks) {
      for (const point of slab.outer) see(point, slab.top);
    }
    for (const wall of level.walls) {
      see(wall.from, wall.base + wall.height);
      see(wall.to, wall.base);
    }
    for (const beam of level.rimBeams) {
      see(beam.from, beam.top - beam.depth);
      see(beam.to, beam.top);
    }
    for (const post of level.posts) see(post.at, 0);
    for (const stair of level.stairs) {
      for (const tread of stair.treads) {
        see(tread.from, tread.top);
        see(tread.to, tread.top);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return EMPTY_FOCUS;

  const center = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ] as const;
  const radius = Math.max(
    Math.hypot(maxX - minX, maxZ - minZ) / 2,
    (maxY - minY) / 2,
    1,
  );
  return { center, radius };
}
