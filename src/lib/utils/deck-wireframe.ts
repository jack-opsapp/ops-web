/**
 * Deck wireframe geometry — turns the iOS deck designer's `drawing_data`
 * vertices/edges into a normalized set of SVG line segments: the hairline
 * blueprint render used when a `deck_designs` row has no raster thumbnail
 * (and as the compact card glyph, where a 40px raster reads as a smudge but
 * the crew's actual outline reads instantly).
 *
 * Legacy tolerance is the contract (bible 03 § deck_designs): rows may omit
 * keys, carry numeric-string positions, or reference deleted vertices. A
 * malformed row degrades to `null` — the caller falls back to thumbnail or
 * icon — and NEVER throws.
 */

export interface DeckWireVertexInput {
  id?: unknown;
  position?: unknown;
}

export interface DeckWireEdgeInput {
  startVertexId?: unknown;
  endVertexId?: unknown;
}

export interface WireframeSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WireframeModel {
  viewBox: string;
  segments: WireframeSegment[];
}

const BOX = 100;
const PAD_RATIO = 0.08;

function coerceFinite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function readPoint(position: unknown): { x: number; y: number } | null {
  if (!Array.isArray(position) || position.length < 2) return null;
  const x = coerceFinite(position[0]);
  const y = coerceFinite(position[1]);
  if (x === null || y === null) return null;
  return { x, y };
}

/**
 * Build the normalized wireframe: bounding box mapped into a square
 * `0 0 100 100` viewBox with 8% padding, aspect ratio preserved, the short
 * axis centered. Returns `null` when fewer than one non-degenerate segment
 * survives validation.
 */
export function buildWireframeModel(
  vertices: DeckWireVertexInput[] | null | undefined,
  edges: DeckWireEdgeInput[] | null | undefined,
): WireframeModel | null {
  if (!Array.isArray(vertices) || !Array.isArray(edges)) return null;

  const points = new Map<string, { x: number; y: number }>();
  for (const vertex of vertices) {
    if (typeof vertex?.id !== "string") continue;
    const point = readPoint(vertex.position);
    if (point) points.set(vertex.id, point);
  }

  const raw: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }> = [];
  for (const edge of edges) {
    if (typeof edge?.startVertexId !== "string" || typeof edge?.endVertexId !== "string") {
      continue;
    }
    const a = points.get(edge.startVertexId);
    const b = points.get(edge.endVertexId);
    if (!a || !b) continue;
    if (a.x === b.x && a.y === b.y) continue; // zero-length
    raw.push({ a, b });
  }
  if (raw.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { a, b } of raw) {
    minX = Math.min(minX, a.x, b.x);
    maxX = Math.max(maxX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y);
    maxY = Math.max(maxY, a.y, b.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (width === 0 && height === 0) return null;

  // Fit the longer axis into the padded box, preserve aspect, center the
  // shorter axis. A perfectly straight run (height or width 0) still renders
  // — centered on its degenerate axis.
  const inner = BOX * (1 - 2 * PAD_RATIO);
  const scale = inner / Math.max(width, height);
  const offsetX = (BOX - width * scale) / 2;
  const offsetY = (BOX - height * scale) / 2;

  const mapX = (x: number) => offsetX + (x - minX) * scale;
  const mapY = (y: number) => offsetY + (y - minY) * scale;

  return {
    viewBox: `0 0 ${BOX} ${BOX}`,
    segments: raw.map(({ a, b }) => ({
      x1: mapX(a.x),
      y1: mapY(a.y),
      x2: mapX(b.x),
      y2: mapY(b.y),
    })),
  };
}
