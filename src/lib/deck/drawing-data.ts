/**
 * OPS Web — deck `drawing_data` → render model.
 *
 * A client-safe port of the geometry the agent control plane's calculator
 * derives (`src/lib/agent-control-plane/services/p2/deck-design/
 * deck-geometry-calculator.ts` § plane normalization → vertex weld → face
 * detection → surface/hole resolution). Same algorithms, same constants, so
 * the drawing a trades owner reads on the web is the drawing the agent
 * measured — surface for surface, square inch for square inch. Pinned to the
 * golden fixtures in `tests/unit/deck/drawing-data.test.ts`.
 *
 * Two deliberate differences from the server calculator:
 *
 *   1. **Tolerant, never fatal.** The calculator `fail()`s on anything it
 *      cannot canonicalise, because a contract read must be exact. A viewer
 *      that throws shows the operator nothing. Untrustworthy vertices, edges
 *      and boundaries are dropped; a drawing with nothing left returns `null`
 *      and the caller falls back to the thumbnail (bible 03 § deck_designs,
 *      legacy tolerance).
 *   2. **Presentation fields.** Level names, display colours, edge labels,
 *      stair treads and dimensions travel with the geometry — the calculator
 *      discards them, the viewer draws them.
 *
 * No `server-only` import, no zod, no Node built-ins: this module runs in the
 * browser inside the viewer.
 */

export type DeckBoundaryRole = "house" | "open" | "wall";
export type DeckLevelColor = "blue" | "green" | "amber";

export interface DeckPoint {
  readonly x: number;
  readonly y: number;
}

export interface DeckVertex {
  readonly id: string;
  readonly position: DeckPoint;
}

/** The stair run drawn on an open edge — treads only; framing is iOS's job. */
export interface DeckStair {
  readonly width: number;
  readonly runPerTread: number;
  readonly risePerStep: number;
  /**
   * Authored count, else derived from the stair's total rise. `null` when
   * neither is knowable — the viewer then draws the run without treads rather
   * than inventing a number of steps.
   */
  readonly treadCount: number | null;
  readonly alignment: "left" | "center" | "right";
  readonly offset: number;
  readonly flipDirection: boolean;
}

export interface DeckEdge {
  readonly id: string;
  readonly start: DeckPoint;
  readonly end: DeckPoint;
  readonly boundaryRole: DeckBoundaryRole;
  /** Authored real-world length. `null` when the edge was never dimensioned. */
  readonly dimensionInches: number | null;
  /** True when the authored dimension no longer matches the geometry. */
  readonly dimensionStale: boolean;
  /** The operator's own annotation on this edge, e.g. "gate side". */
  readonly label: string | null;
  readonly stair: DeckStair | null;
}

export interface DeckSurface {
  readonly id: string;
  readonly outer: readonly DeckPoint[];
  readonly holes: readonly (readonly DeckPoint[])[];
  readonly label: string | null;
  /**
   * Canvas-unit area with holes removed. `null` when the loop self-intersects
   * — a bowtie's shoelace area is a net value, not a footprint, and a
   * confidently wrong number is worse than an honest dash.
   */
  readonly areaCanvas: number | null;
}

export interface DeckLevel {
  readonly id: string;
  readonly name: string | null;
  readonly sortOrder: number;
  readonly elevationFeet: number | null;
  readonly displayColor: DeckLevelColor | null;
  readonly vertices: readonly DeckVertex[];
  readonly edges: readonly DeckEdge[];
  readonly surfaces: readonly DeckSurface[];
  /**
   * The closed outline to fill when no surface resolved — the calculator's
   * single-cycle area fallback, kept separate so `surfaces.length` still
   * matches the calculator's topology exactly.
   */
  readonly fallbackOutline: readonly DeckPoint[] | null;
  /** Canvas area of `fallbackOutline`; `null` when it self-intersects. */
  readonly fallbackAreaCanvas: number | null;
}

export interface DeckBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface DeckDrawing {
  /** Canvas units per real-world inch. Defaults to 2, as the calculator does. */
  readonly scaleFactor: number;
  readonly measurementSystem: "imperial" | "metric";
  readonly levels: readonly DeckLevel[];
  readonly bounds: DeckBounds | null;
  readonly isMultiLevel: boolean;
  readonly hasClosedSurface: boolean;
}

// ---------------------------------------------------------------------------
// Tolerant readers
// ---------------------------------------------------------------------------

const FINITE_DECIMAL_PATTERN =
  /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Numbers, and the numeric strings legacy rows carry. Nothing else. */
function finite(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  }
  if (typeof value === "string" && FINITE_DECIMAL_PATTERN.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function readPoint(value: unknown): DeckPoint | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = finite(value[0]);
    const y = finite(value[1]);
    return x === null || y === null ? null : { x, y };
  }
  if (isRecord(value)) {
    const x = finite(value.x);
    const y = finite(value.y);
    return x === null || y === null ? null : { x, y };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Polygon math — byte-for-byte the calculator's
// ---------------------------------------------------------------------------

export function signedArea(points: readonly DeckPoint[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

export function polygonArea(points: readonly DeckPoint[]): number {
  return Math.abs(signedArea(points));
}

export function polygonPerimeter(points: readonly DeckPoint[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    total += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return total;
}

export function pointInPolygon(
  point: DeckPoint,
  polygon: readonly DeckPoint[],
): boolean {
  let inside = false;
  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]!;
    const previous = polygon[previousIndex]!;
    const crosses =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function interiorProbe(polygon: readonly DeckPoint[]): DeckPoint | null {
  if (polygon.length < 3) return null;
  const average = {
    x: polygon.reduce((total, point) => total + point.x, 0) / polygon.length,
    y: polygon.reduce((total, point) => total + point.y, 0) / polygon.length,
  };
  if (pointInPolygon(average, polygon)) return average;
  for (let index = 1; index < polygon.length - 1; index += 1) {
    const probe = {
      x: (polygon[0]!.x + polygon[index]!.x + polygon[index + 1]!.x) / 3,
      y: (polygon[0]!.y + polygon[index]!.y + polygon[index + 1]!.y) / 3,
    };
    if (pointInPolygon(probe, polygon)) return probe;
  }
  return null;
}

function orientation(a: DeckPoint, b: DeckPoint, c: DeckPoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  return Math.abs(value) <= 1e-10 ? 0 : value > 0 ? 1 : -1;
}

function pointOnSegment(a: DeckPoint, b: DeckPoint, point: DeckPoint): boolean {
  return (
    point.x <= Math.max(a.x, b.x) + 1e-10 &&
    point.x + 1e-10 >= Math.min(a.x, b.x) &&
    point.y <= Math.max(a.y, b.y) + 1e-10 &&
    point.y + 1e-10 >= Math.min(a.y, b.y)
  );
}

function segmentsIntersect(
  a: DeckPoint,
  b: DeckPoint,
  c: DeckPoint,
  d: DeckPoint,
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB) return true;
  return (
    (abC === 0 && pointOnSegment(a, b, c)) ||
    (abD === 0 && pointOnSegment(a, b, d)) ||
    (cdA === 0 && pointOnSegment(c, d, a)) ||
    (cdB === 0 && pointOnSegment(c, d, b))
  );
}

export function isSelfIntersecting(points: readonly DeckPoint[]): boolean {
  if (points.length < 4) return false;
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (
        first === second ||
        firstNext === second ||
        secondNext === first ||
        (first === 0 && secondNext === 0)
      ) {
        continue;
      }
      if (
        segmentsIntersect(
          points[first]!,
          points[firstNext]!,
          points[second]!,
          points[secondNext]!,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Plane parsing
// ---------------------------------------------------------------------------

interface ParsedVertex {
  readonly id: string;
  readonly position: DeckPoint;
  readonly carriesAuthoredWork: boolean;
}

interface ParsedEdge {
  readonly id: string;
  readonly startVertexId: string;
  readonly endVertexId: string;
  readonly boundaryRole: DeckBoundaryRole;
  readonly dimensionInches: number | null;
  readonly dimensionStale: boolean;
  readonly label: string | null;
  readonly stair: DeckStair | null;
}

interface ParsedSurfacePayload {
  readonly id: string;
  readonly outerVertexIds: readonly string[] | null;
  readonly holeVertexIds: readonly (readonly string[])[];
  readonly vertexIds: ReadonlySet<string>;
  readonly label: string | null;
}

interface ParsedPlane {
  readonly id: string;
  readonly name: string | null;
  readonly sortOrder: number;
  readonly elevationFeet: number | null;
  readonly displayColor: DeckLevelColor | null;
  readonly weldTolerance: number;
  readonly vertices: readonly ParsedVertex[];
  readonly edges: readonly ParsedEdge[];
  readonly surfaces: readonly ParsedSurfacePayload[];
}

/** A real stair is tens of treads; the clamp matches iOS's `maximumTreadCount`. */
const MAXIMUM_TREAD_COUNT = 500;

/**
 * Steps needed to climb `totalRise` at `risePerStep`, rounded up — the iOS
 * `StairConfig.calculateTreadCount`. Every level-connection stair authored in
 * the app leaves `treadCount` nil so the count re-derives when a level's
 * height changes, so this is the common path, not the fallback.
 */
function derivedTreadCount(
  totalRise: number | null,
  risePerStep: number,
): number | null {
  if (totalRise === null || totalRise <= 0 || risePerStep <= 0) return null;
  const steps = Math.ceil(totalRise / risePerStep);
  if (!Number.isFinite(steps)) return null;
  return Math.min(steps, MAXIMUM_TREAD_COUNT);
}

function parseStair(value: unknown): DeckStair | null {
  if (!isRecord(value)) return null;
  const width = finite(value.width);
  if (width === null || width <= 0) return null;
  const alignment = value.alignment;
  const authoredCount = finite(value.treadCount);
  // Matches the calculator's DeckKit defaults (IRC R311.7 rise and run).
  const risePerStep = finite(value.risePerStep) ?? 7.5;
  return {
    width,
    runPerTread: finite(value.runPerTread) ?? 10,
    risePerStep,
    treadCount:
      authoredCount !== null &&
      Number.isSafeInteger(authoredCount) &&
      authoredCount > 0
        ? authoredCount
        : derivedTreadCount(finite(value.totalRiseInches), risePerStep),
    alignment:
      alignment === "left" || alignment === "right" ? alignment : "center",
    offset: finite(value.offset) ?? 0,
    flipDirection: bool(value.flipDirection, false),
  };
}

function parseVertices(value: unknown): ParsedVertex[] {
  const seen = new Set<string>();
  const out: ParsedVertex[] = [];
  for (const raw of asArray(value)) {
    if (!isRecord(raw)) continue;
    const id = text(raw.id);
    const position = readPoint(raw.position);
    if (id === null || position === null || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      position,
      carriesAuthoredWork:
        finite(raw.elevation) !== null ||
        (raw.footingType !== undefined && raw.footingType !== null) ||
        (raw.postType !== undefined && raw.postType !== null),
    });
  }
  return out;
}

function parseEdges(value: unknown, vertexIds: ReadonlySet<string>): ParsedEdge[] {
  const seen = new Set<string>();
  const out: ParsedEdge[] = [];
  for (const raw of asArray(value)) {
    if (!isRecord(raw)) continue;
    const id = text(raw.id);
    const startVertexId = text(raw.startVertexId);
    const endVertexId = text(raw.endVertexId);
    if (
      id === null ||
      startVertexId === null ||
      endVertexId === null ||
      startVertexId === endVertexId ||
      seen.has(id) ||
      !vertexIds.has(startVertexId) ||
      !vertexIds.has(endVertexId)
    ) {
      continue;
    }
    seen.add(id);

    const railing = isRecord(raw.railingConfig) ? raw.railingConfig : null;
    const railingFamily = railing === null ? null : text(railing.railingType);
    const inferredRole: DeckBoundaryRole =
      raw.edgeType === "house_edge"
        ? "house"
        : railingFamily === "parapet_wall"
          ? "wall"
          : "open";
    const declaredRole = raw.boundaryRole;
    const boundaryRole: DeckBoundaryRole =
      declaredRole === "house" || declaredRole === "open" || declaredRole === "wall"
        ? declaredRole
        : inferredRole;

    const dimension = finite(raw.dimension);
    out.push({
      id,
      startVertexId,
      endVertexId,
      boundaryRole,
      dimensionInches: dimension !== null && dimension > 0 ? dimension : null,
      dimensionStale: bool(raw.dimensionStale, false),
      label: text(raw.label),
      // Stairs only exist on an open run — a house wall or parapet has none.
      stair: boundaryRole === "open" ? parseStair(raw.stairConfig) : null,
    });
  }
  return out;
}

/** Vertex ids walked out of a boundary loop; `null` when the loop is unusable. */
function loopVertexIds(
  value: unknown,
  vertexIds: ReadonlySet<string>,
): string[] | null {
  const rows = asArray(value);
  if (rows.length < 3) return null;
  const out: string[] = [];
  for (const row of rows) {
    if (!isRecord(row)) return null;
    const startVertexId = text(row.startVertexId);
    if (startVertexId === null || !vertexIds.has(startVertexId)) return null;
    out.push(startVertexId);
  }
  return new Set(out).size === out.length ? out : null;
}

function parseSurfaces(
  value: unknown,
  vertexIds: ReadonlySet<string>,
): ParsedSurfacePayload[] {
  const seen = new Set<string>();
  const out: ParsedSurfacePayload[] = [];
  for (const raw of asArray(value)) {
    if (!isRecord(raw)) continue;
    const id = text(raw.id);
    if (id === null || seen.has(id)) continue;
    seen.add(id);

    let outerVertexIds: string[] | null = null;
    let holeVertexIds: string[][] = [];
    if (isRecord(raw.boundary)) {
      outerVertexIds = loopVertexIds(raw.boundary.outerLoop, vertexIds);
      if (outerVertexIds !== null) {
        const holes: string[][] = [];
        for (const hole of asArray(raw.boundary.holeLoops)) {
          const loop = loopVertexIds(hole, vertexIds);
          if (loop !== null) holes.push(loop);
        }
        holeVertexIds = holes;
      }
    }

    out.push({
      id,
      outerVertexIds,
      holeVertexIds,
      vertexIds: new Set(
        asArray(raw.vertexIds)
          .map((entry) => text(entry))
          .filter((entry): entry is string => entry !== null && vertexIds.has(entry)),
      ),
      label: text(raw.label),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vertex weld (DeckKit coincidence fold)
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT_SNAP_RADIUS = 20;
const COINCIDENCE_FLOOR_DIVISOR = 20;

function coincidenceTolerance(endpointSnapRadius: number): number {
  return Math.max(0, endpointSnapRadius) / 2 / COINCIDENCE_FLOOR_DIVISOR;
}

interface WeldedPlane {
  readonly vertices: readonly ParsedVertex[];
  readonly edges: readonly ParsedEdge[];
  readonly survivorByVertexId: ReadonlyMap<string, string>;
}

/**
 * Fold vertices that sit within the drawing's coincidence tolerance onto one
 * survivor, preferring the vertex that carries authored work (an elevation, a
 * footing, a post) and breaking ties on source id. Two edges that end a
 * hair apart are one corner to the operator, and must be one corner to the
 * face walk or no surface ever closes.
 */
function weldPlane(plane: ParsedPlane): WeldedPlane {
  const tolerance = plane.weldTolerance;
  if (tolerance <= 0 || plane.vertices.length <= 1) {
    return {
      vertices: plane.vertices,
      edges: plane.edges,
      survivorByVertexId: new Map(),
    };
  }

  const ordered = [...plane.vertices].sort(
    (left, right) =>
      Number(right.carriesAuthoredWork) - Number(left.carriesAuthoredWork) ||
      left.id.localeCompare(right.id),
  );
  const cellKey = (point: DeckPoint): string =>
    `${Math.floor(point.x / tolerance)}|${Math.floor(point.y / tolerance)}`;
  const buckets = new Map<string, string[]>();
  const chosen = new Map<string, DeckPoint>();
  const survivorByVertexId = new Map<string, string>();

  for (const vertex of ordered) {
    const originX = Math.floor(vertex.position.x / tolerance);
    const originY = Math.floor(vertex.position.y / tolerance);
    let best: { readonly id: string; readonly distance: number } | null = null;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const neighbours = buckets.get(`${originX + dx}|${originY + dy}`) ?? [];
        for (const id of neighbours) {
          const candidate = chosen.get(id);
          if (!candidate) continue;
          const distance = Math.hypot(
            vertex.position.x - candidate.x,
            vertex.position.y - candidate.y,
          );
          if (distance <= tolerance && distance < (best?.distance ?? Infinity)) {
            best = { id, distance };
          }
        }
      }
    }
    if (best) {
      survivorByVertexId.set(vertex.id, best.id);
      continue;
    }
    const key = cellKey(vertex.position);
    buckets.set(key, [...(buckets.get(key) ?? []), vertex.id]);
    chosen.set(vertex.id, vertex.position);
  }

  if (survivorByVertexId.size === 0) {
    return { vertices: plane.vertices, edges: plane.edges, survivorByVertexId };
  }
  const survivor = (id: string): string => survivorByVertexId.get(id) ?? id;
  const folded = new Set(survivorByVertexId.keys());
  return {
    vertices: plane.vertices.filter((vertex) => !folded.has(vertex.id)),
    edges: plane.edges
      .map((edge) => ({
        ...edge,
        startVertexId: survivor(edge.startVertexId),
        endVertexId: survivor(edge.endVertexId),
      }))
      .filter((edge) => edge.startVertexId !== edge.endVertexId),
    survivorByVertexId,
  };
}

// ---------------------------------------------------------------------------
// Face detection
// ---------------------------------------------------------------------------

interface DetectedFace {
  readonly vertexIds: readonly string[];
  readonly positions: readonly DeckPoint[];
  readonly holeVertexIds: readonly (readonly string[])[];
  readonly holePositions: readonly (readonly DeckPoint[])[];
}

/**
 * Walk every half-edge clockwise around the planar graph to enumerate its
 * faces, drop each connected component's outer (infinite) face, then nest the
 * survivors by containment parity so an odd-depth face is a hole rather than
 * a surface. This is the reason a deck drawn as loose edges still reports
 * real square footage: nobody authors surfaces, the graph implies them.
 */
function detectFaces(welded: WeldedPlane): DetectedFace[] {
  if (welded.vertices.length < 3 || welded.edges.length < 3) return [];
  const vertexById = new Map(
    welded.vertices.map((vertex) => [vertex.id, vertex] as const),
  );
  const adjacency = new Map<string, Set<string>>(
    welded.vertices.map((vertex) => [vertex.id, new Set<string>()]),
  );
  for (const edge of welded.edges) {
    if (edge.startVertexId === edge.endVertexId) continue;
    adjacency.get(edge.startVertexId)?.add(edge.endVertexId);
    adjacency.get(edge.endVertexId)?.add(edge.startVertexId);
  }
  // Prune degree-≤1 tails repeatedly: a spur can never bound a face.
  let changed = true;
  while (changed) {
    changed = false;
    const dangling = [...adjacency.entries()]
      .filter(([, neighbors]) => neighbors.size <= 1)
      .map(([id]) => id);
    for (const id of dangling) {
      for (const neighbor of adjacency.get(id) ?? []) {
        adjacency.get(neighbor)?.delete(id);
      }
      adjacency.delete(id);
      changed = true;
    }
  }
  const coreIds = new Set(adjacency.keys());
  if (coreIds.size < 3) return [];

  const sortedNeighbors = new Map<string, string[]>();
  for (const id of [...coreIds].sort()) {
    const center = vertexById.get(id)!.position;
    sortedNeighbors.set(
      id,
      [...(adjacency.get(id) ?? [])].sort((left, right) => {
        const leftPoint = vertexById.get(left)!.position;
        const rightPoint = vertexById.get(right)!.position;
        const leftAngle = Math.atan2(
          leftPoint.y - center.y,
          leftPoint.x - center.x,
        );
        const rightAngle = Math.atan2(
          rightPoint.y - center.y,
          rightPoint.x - center.x,
        );
        return leftAngle - rightAngle || left.localeCompare(right);
      }),
    );
  }

  const walkable = welded.edges.filter(
    (edge) => coreIds.has(edge.startVertexId) && coreIds.has(edge.endVertexId),
  );
  const visited = new Set<string>();
  const edgeKey = (from: string, to: string) => `${from}|${to}`;
  const rawFaces: string[][] = [];
  for (const edge of [...walkable].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const [fromStart, toStart] of [
      [edge.startVertexId, edge.endVertexId],
      [edge.endVertexId, edge.startVertexId],
    ] as const) {
      if (visited.has(edgeKey(fromStart, toStart))) continue;
      const face: string[] = [];
      let from = fromStart;
      let to = toStart;
      let safe = true;
      const cap = walkable.length * 4 + 4;
      for (let iteration = 0; iteration < cap; iteration += 1) {
        const key = edgeKey(from, to);
        if (visited.has(key)) {
          safe = false;
          break;
        }
        visited.add(key);
        face.push(from);
        const neighbors = sortedNeighbors.get(to);
        const fromIndex = neighbors?.indexOf(from) ?? -1;
        if (!neighbors || fromIndex < 0) {
          safe = false;
          break;
        }
        const next =
          neighbors[(fromIndex - 1 + neighbors.length) % neighbors.length]!;
        if (to === fromStart && next === toStart) break;
        from = to;
        to = next;
      }
      if (safe && face.length >= 3) rawFaces.push(face);
    }
  }
  if (rawFaces.length === 0) return [];

  const componentOf = new Map<string, number>();
  let nextComponent = 0;
  for (const seed of [...coreIds].sort()) {
    if (componentOf.has(seed)) continue;
    const queue = [seed];
    componentOf.set(seed, nextComponent);
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!componentOf.has(neighbor)) {
          componentOf.set(neighbor, nextComponent);
          queue.push(neighbor);
        }
      }
    }
    nextComponent += 1;
  }

  const faces = rawFaces.map((ids) => {
    const positions = ids.map((id) => vertexById.get(id)!.position);
    return {
      ids,
      positions,
      absArea: Math.abs(signedArea(positions)),
      component: componentOf.get(ids[0]!)!,
    };
  });
  const outerByComponent = new Map<number, number>();
  faces.forEach((face, index) => {
    const previous = outerByComponent.get(face.component);
    if (previous === undefined || face.absArea > faces[previous]!.absArea) {
      outerByComponent.set(face.component, index);
    }
  });
  const outerIndices = new Set(outerByComponent.values());
  const seen = new Set<string>();
  const candidates = faces
    .map((face, index) => ({ ...face, index }))
    .filter((face) => {
      const key = [...face.ids].sort().join("|");
      if (outerIndices.has(face.index) || face.absArea <= 0.5 || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  const containers = candidates.map((candidate, index) => {
    const probe = interiorProbe(candidate.positions);
    if (!probe) return [] as number[];
    return candidates
      .map((container, containerIndex) => ({ container, containerIndex }))
      .filter(
        ({ container, containerIndex }) =>
          containerIndex !== index &&
          container.component !== candidate.component &&
          container.absArea > candidate.absArea &&
          pointInPolygon(probe, container.positions),
      )
      .map(({ containerIndex }) => containerIndex);
  });
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ index }) => containers[index]!.length % 2 === 0)
    .map(({ candidate, index }) => {
      const directHoles = candidates
        .map((hole, holeIndex) => ({ hole, holeIndex }))
        .filter(({ holeIndex }) => {
          if (
            containers[holeIndex]!.length !== containers[index]!.length + 1 ||
            !containers[holeIndex]!.includes(index)
          ) {
            return false;
          }
          const closest = [...containers[holeIndex]!].sort(
            (left, right) =>
              candidates[left]!.absArea - candidates[right]!.absArea,
          )[0];
          return closest === index;
        });
      return {
        vertexIds: candidate.ids,
        positions: candidate.positions,
        holeVertexIds: directHoles.map(({ hole }) => hole.ids),
        holePositions: directHoles.map(({ hole }) => hole.positions),
      };
    });
}

// ---------------------------------------------------------------------------
// Surface resolution
// ---------------------------------------------------------------------------

function vertexSetKey(ids: Iterable<string>): string {
  return [...ids].sort().join("|");
}

function positionsFor(
  plane: ParsedPlane,
  vertexIds: readonly string[],
): DeckPoint[] {
  const byId = new Map(
    plane.vertices.map((vertex) => [vertex.id, vertex.position] as const),
  );
  return vertexIds
    .map((id) => byId.get(id))
    .filter((position): position is DeckPoint => position !== undefined);
}

function makeSurface(
  id: string,
  outer: readonly DeckPoint[],
  holes: readonly (readonly DeckPoint[])[],
  label: string | null,
): DeckSurface | null {
  if (outer.length < 3) return null;
  const broken =
    isSelfIntersecting(outer) || holes.some((hole) => isSelfIntersecting(hole));
  const area = broken
    ? null
    : polygonArea(outer) -
      holes.reduce((total, hole) => total + polygonArea(hole), 0);
  return {
    id,
    outer,
    holes,
    label,
    areaCanvas: area !== null && Number.isFinite(area) && area > 0 ? area : null,
  };
}

/**
 * Authored surfaces first, then every detected face the authored set did not
 * already claim — matched back to a boundaryless payload (so its name and
 * finish survive) by vertex-set overlap, exactly as the calculator does.
 */
function resolveSurfaces(plane: ParsedPlane, welded: WeldedPlane): DeckSurface[] {
  const survivor = (id: string): string =>
    welded.survivorByVertexId.get(id) ?? id;
  const projectedVertexSetKey = (ids: Iterable<string>): string =>
    vertexSetKey([...ids].map(survivor));

  const explicit = plane.surfaces.filter(
    (
      surface,
    ): surface is ParsedSurfacePayload & { outerVertexIds: readonly string[] } =>
      surface.outerVertexIds !== null,
  );
  const detected = detectFaces(welded);

  const claimed = new Set<string>();
  for (const surface of explicit) {
    claimed.add(projectedVertexSetKey(surface.outerVertexIds));
    claimed.add(
      projectedVertexSetKey([
        ...surface.outerVertexIds,
        ...surface.holeVertexIds.flat(),
      ]),
    );
    surface.holeVertexIds.forEach((hole) =>
      claimed.add(projectedVertexSetKey(hole)),
    );
  }
  const unmatched = detected.filter(
    (face) =>
      !claimed.has(projectedVertexSetKey(face.vertexIds)) &&
      !claimed.has(
        projectedVertexSetKey([...face.vertexIds, ...face.holeVertexIds.flat()]),
      ),
  );

  const boundaryless = plane.surfaces
    .filter((surface) => surface.outerVertexIds === null)
    .sort((left, right) => left.id.localeCompare(right.id));
  const claimedPayloadIds = new Set<string>();

  const resolvedDetected = unmatched.map((face) => {
    const detectedSet = new Set([
      ...face.vertexIds,
      ...face.holeVertexIds.flat(),
    ]);
    let payload: ParsedSurfacePayload | null = null;
    let bestOverlap = -1;
    for (const candidate of boundaryless) {
      if (claimedPayloadIds.has(candidate.id)) continue;
      const candidateSet = new Set([...candidate.vertexIds].map(survivor));
      if (
        candidateSet.size === detectedSet.size &&
        [...candidateSet].every((id) => detectedSet.has(id))
      ) {
        payload = candidate;
        bestOverlap = 1;
        break;
      }
      const intersection = [...detectedSet].filter((id) =>
        candidateSet.has(id),
      ).length;
      const union = new Set([...detectedSet, ...candidateSet]).size;
      const overlap = union === 0 ? 0 : intersection / union;
      if (overlap > bestOverlap) {
        payload = candidate;
        bestOverlap = overlap;
      }
    }
    if (bestOverlap < 0.5) payload = null;
    if (payload) claimedPayloadIds.add(payload.id);
    return makeSurface(
      payload?.id ?? `detected:${vertexSetKey(detectedSet)}`,
      face.positions,
      face.holePositions,
      payload?.label ?? null,
    );
  });

  const resolvedExplicit = explicit.map((surface) =>
    makeSurface(
      surface.id,
      positionsFor(plane, surface.outerVertexIds),
      surface.holeVertexIds.map((hole) => positionsFor(plane, hole)),
      surface.label,
    ),
  );

  return [...resolvedExplicit, ...resolvedDetected]
    .filter((surface): surface is DeckSurface => surface !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * The whole plane as one closed ring — every vertex of degree exactly two,
 * walked in order. The calculator's area fallback for a drawing whose graph
 * never produced a face (e.g. a single authored outline).
 */
function singleCycleVertexIds(plane: ParsedPlane): string[] | null {
  if (plane.vertices.length < 3 || plane.edges.length < 3) return null;
  const adjacency = new Map<string, string[]>(
    plane.vertices.map((vertex) => [vertex.id, []]),
  );
  for (const edge of plane.edges) {
    adjacency.get(edge.startVertexId)?.push(edge.endVertexId);
    adjacency.get(edge.endVertexId)?.push(edge.startVertexId);
  }
  if ([...adjacency.values()].some((neighbors) => neighbors.length !== 2)) {
    return null;
  }
  const start = plane.vertices[0]!.id;
  const ordered = [start];
  let previous: string | null = null;
  let current = start;
  while (ordered.length < plane.vertices.length) {
    const next = [...adjacency.get(current)!]
      .sort()
      .find((candidate) => candidate !== previous);
    if (!next || ordered.includes(next)) return null;
    ordered.push(next);
    previous = current;
    current = next;
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function levelColor(value: unknown): DeckLevelColor | null {
  return value === "blue" || value === "green" || value === "amber"
    ? value
    : null;
}

function parsePlaneRecord(input: {
  readonly value: UnknownRecord;
  readonly id: string;
  readonly name: string | null;
  readonly sortOrder: number;
  readonly elevationFeet: number | null;
  readonly displayColor: DeckLevelColor | null;
  readonly weldTolerance: number;
}): ParsedPlane {
  const vertices = parseVertices(input.value.vertices);
  const vertexIds = new Set(vertices.map((vertex) => vertex.id));
  return {
    id: input.id,
    name: input.name,
    sortOrder: input.sortOrder,
    elevationFeet: input.elevationFeet,
    displayColor: input.displayColor,
    weldTolerance: input.weldTolerance,
    vertices,
    edges: parseEdges(input.value.edges, vertexIds),
    surfaces: parseSurfaces(input.value.surfaces, vertexIds),
  };
}

function toLevel(plane: ParsedPlane): DeckLevel {
  const welded = weldPlane(plane);
  const surfaces = resolveSurfaces(plane, welded);
  const byId = new Map(
    plane.vertices.map((vertex) => [vertex.id, vertex.position] as const),
  );

  let fallbackOutline: DeckPoint[] | null = null;
  let fallbackAreaCanvas: number | null = null;
  if (surfaces.length === 0) {
    const cycle = singleCycleVertexIds(plane);
    if (cycle) {
      const positions = positionsFor(plane, cycle);
      if (positions.length >= 3) {
        fallbackOutline = positions;
        if (!isSelfIntersecting(positions)) {
          const area = polygonArea(positions);
          fallbackAreaCanvas = area > 0 ? area : null;
        }
      }
    }
  }

  return {
    id: plane.id,
    name: plane.name,
    sortOrder: plane.sortOrder,
    elevationFeet: plane.elevationFeet,
    displayColor: plane.displayColor,
    vertices: plane.vertices.map((vertex) => ({
      id: vertex.id,
      position: vertex.position,
    })),
    edges: plane.edges.map((edge) => ({
      id: edge.id,
      start: byId.get(edge.startVertexId)!,
      end: byId.get(edge.endVertexId)!,
      boundaryRole: edge.boundaryRole,
      dimensionInches: edge.dimensionInches,
      dimensionStale: edge.dimensionStale,
      label: edge.label,
      stair: edge.stair,
    })),
    surfaces,
    fallbackOutline,
    fallbackAreaCanvas,
  };
}

function boundsOf(levels: readonly DeckLevel[]): DeckBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const level of levels) {
    for (const vertex of level.vertices) {
      minX = Math.min(minX, vertex.position.x);
      maxX = Math.max(maxX, vertex.position.x);
      minY = Math.min(minY, vertex.position.y);
      maxY = Math.max(maxY, vertex.position.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Parse a `deck_designs.drawing_data` payload into the viewer's render model.
 * Returns `null` when nothing drawable survives — the caller falls back to the
 * raster thumbnail, never to a blank canvas.
 */
export function parseDeckDrawing(raw: unknown): DeckDrawing | null {
  if (!isRecord(raw)) return null;

  const rawLevels = asArray(raw.levels).filter(isRecord);
  const isMultiLevel = rawLevels.length > 0;

  // Single-level drawings snap with the drawing's own configured radius;
  // multi-level DeckKit levels always use the kit default.
  const config = isRecord(raw.config) ? raw.config : null;
  const singleLevelTolerance = coincidenceTolerance(
    config === null
      ? DEFAULT_ENDPOINT_SNAP_RADIUS
      : (finite(config.endpointSnapRadius) ?? DEFAULT_ENDPOINT_SNAP_RADIUS),
  );
  const multiLevelTolerance = coincidenceTolerance(DEFAULT_ENDPOINT_SNAP_RADIUS);

  const overallElevation = finite(raw.overallElevation);
  const planes: ParsedPlane[] = isMultiLevel
    ? rawLevels.map((level, index) =>
        parsePlaneRecord({
          value: level,
          id: text(level.id) ?? `level-${index}`,
          name: text(level.name),
          sortOrder: finite(level.sortOrder) ?? index,
          elevationFeet: finite(level.elevation),
          displayColor: levelColor(level.displayColor),
          weldTolerance: multiLevelTolerance,
        }),
      )
    : [
        parsePlaneRecord({
          value: raw,
          id: "base",
          name: null,
          sortOrder: 0,
          elevationFeet: overallElevation,
          displayColor: null,
          weldTolerance: singleLevelTolerance,
        }),
      ];

  const levels = planes
    .map(toLevel)
    .filter((level) => level.vertices.length > 0 && level.edges.length > 0)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    );
  if (levels.length === 0) return null;

  const bounds = boundsOf(levels);
  if (bounds === null || (bounds.width === 0 && bounds.height === 0)) return null;

  const scaleFactor = finite(raw.scaleFactor);
  const measurementSystem =
    config !== null && config.measurementSystem === "metric"
      ? "metric"
      : "imperial";

  return {
    scaleFactor: scaleFactor !== null && scaleFactor > 0 ? scaleFactor : 2,
    measurementSystem,
    levels,
    bounds,
    isMultiLevel: levels.length > 1,
    hasClosedSurface: levels.some(
      (level) => level.surfaces.length > 0 || level.fallbackOutline !== null,
    ),
  };
}

/**
 * Total enclosed area in real-world square inches, matching the calculator's
 * `areaCalculation`: every level's surfaces (holes removed), falling back to
 * the single closed cycle where no surface resolved. `null` when any region
 * self-intersects or nothing is closed — an honest dash beats a wrong number.
 */
export function totalAreaSquareInches(drawing: DeckDrawing): number | null {
  let total = 0;
  let anySurface = false;
  for (const level of drawing.levels) {
    if (level.surfaces.length > 0) {
      for (const surface of level.surfaces) {
        if (surface.areaCanvas === null) return null;
        total += surface.areaCanvas;
        anySurface = true;
      }
      continue;
    }
    if (level.fallbackOutline !== null) {
      if (level.fallbackAreaCanvas === null) return null;
      total += level.fallbackAreaCanvas;
      anySurface = true;
    }
  }
  if (!anySurface || total <= 0) return null;
  return total / (drawing.scaleFactor * drawing.scaleFactor);
}
