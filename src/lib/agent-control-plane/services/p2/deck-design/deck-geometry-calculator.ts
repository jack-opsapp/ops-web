import {
  DECK_GEOMETRY_MAX_CONNECTIONS,
  DECK_GEOMETRY_MAX_DIRECTED_BOUNDARY_REFS,
  DECK_GEOMETRY_MAX_EDGES,
  DECK_GEOMETRY_MAX_PLANES,
  DECK_GEOMETRY_MAX_SOURCE_BYTES,
  DECK_GEOMETRY_MAX_SURFACES,
  DECK_GEOMETRY_MAX_TOPOLOGY_UNITS,
  DECK_GEOMETRY_MAX_VERTICES,
  DeckDesignGeometryMeasurementsSchema,
  DeckDesignGeometryTopologySchema,
  type DeckDesignGeometryMeasurements,
  type DeckDesignGeometryTopology,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import { createP2CanonicalTextSchema } from "@/lib/agent-control-plane/contracts/p2-common";

type UnknownRecord = Record<string, unknown>;
type Point = Readonly<{ x: number; y: number }>;

interface ParsedVertex {
  readonly id: string;
  readonly position: Point;
  readonly elevationFeet: number | null;
  readonly carriesAuthoredWork: boolean;
}

interface ParsedStair {
  readonly width: number | null;
  readonly risePerStep: number | null;
  readonly runPerTread: number | null;
  readonly treadCount: number | null;
  readonly totalRiseInches: number | null;
}

interface ParsedEdge {
  readonly id: string;
  readonly startVertexId: string;
  readonly endVertexId: string;
  readonly edgeType: "deck_edge" | "house_edge";
  readonly boundaryRole: "house" | "open" | "wall";
  readonly dimension: number | null;
  readonly dimensionSource: "ar" | "laser" | "manual" | "scale";
  readonly dimensionStale: boolean;
  readonly railingFamily: string | null;
  readonly stair: ParsedStair | null;
  readonly gateCount: number;
}

interface ParsedBoundaryReference {
  readonly edgeId: string;
  readonly startVertexId: string;
  readonly endVertexId: string;
}

interface ParsedSurface {
  readonly id: string;
  readonly boundary: Readonly<{
    outerLoop: readonly ParsedBoundaryReference[];
    holeLoops: readonly (readonly ParsedBoundaryReference[])[];
  }> | null;
  readonly vertexIds: ReadonlySet<string>;
  readonly finishFamily: string | null;
  readonly elevationFeet: number;
}

interface ParsedPlane {
  readonly sourceId: string;
  readonly sortOrder: number;
  readonly elevationFeet: number | null;
  readonly overallElevationFeet: number | null;
  readonly weldTolerance: number;
  readonly vertices: readonly ParsedVertex[];
  readonly edges: readonly ParsedEdge[];
  readonly surfaces: readonly ParsedSurface[];
}

interface ParsedLevelConnection {
  readonly kind: "level_stair";
  readonly id: string;
  readonly upperLevelId: string;
  readonly lowerLevelId: string;
  readonly upperEdgeId: string;
  readonly lowerEdgeId: string;
  readonly stair: ParsedStair;
}

interface ParsedSurfaceConnection {
  readonly kind: "surface_transition";
  readonly id: string;
  readonly levelId: string | null;
  readonly edgeId: string;
  readonly upperSurfaceId: string;
  readonly lowerSurfaceId: string;
  readonly transitionKind: "riser" | "steps";
  readonly widthInches: number;
  readonly runPerStepInches: number;
}

interface ParsedComponentWitness {
  readonly componentType: "deck_board" | "railing";
  readonly sourceId: string;
  readonly levelId: string | null;
  readonly measurementKey: "linear_feet" | "sqft";
  readonly value: number;
}

export interface ParsedDeckGeometrySource {
  readonly schema_version: number | null;
  readonly scale_factor: number;
  readonly topology_units: number;
  readonly planes: readonly ParsedPlane[];
  readonly level_connections: readonly ParsedLevelConnection[];
  readonly surface_connections: readonly ParsedSurfaceConnection[];
  readonly component_witnesses: readonly ParsedComponentWitness[] | null;
}

export interface DeckGeometryCalculation {
  readonly drawing_schema_version: number | null;
  readonly topology: DeckDesignGeometryTopology;
  readonly measurements: DeckDesignGeometryMeasurements;
  readonly full_precision: Readonly<{
    area_square_inches: number | null;
    flat_railing_inches: number | null;
    stair_railing_inches: number | null;
    parapet_inches: number | null;
    combined_guard_inches: number | null;
  }>;
  readonly local_reference_witnesses: readonly Readonly<{
    kind: "connection" | "edge" | "plane" | "surface" | "vertex";
    source_id: string;
    local_ref: string;
  }>[];
}

export class DeckGeometrySourceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "DeckGeometrySourceError";
    this.code = code;
  }
}

const UTF8_ENCODER = new TextEncoder();
const FINITE_DECIMAL_PATTERN =
  /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const SourceIdSchema = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 256,
  maximumUtf8Bytes: 1_024,
});
const SourceSemanticSchema = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 128,
  maximumUtf8Bytes: 512,
});

function fail(code: string): never {
  throw new DeckGeometrySourceError(code);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): UnknownRecord {
  if (!isRecord(value)) fail("DECK_GEOMETRY_SOURCE_DATA_INVALID");
  return value;
}

function array(value: unknown, fallback: readonly unknown[] = []): unknown[] {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) fail("DECK_GEOMETRY_SOURCE_DATA_INVALID");
  return value;
}

function sourceId(value: unknown): string {
  const parsed = SourceIdSchema.safeParse(value);
  if (!parsed.success) {
    fail("DECK_GEOMETRY_REFERENCE_INVALID");
  }
  return parsed.data;
}

function semanticValue(value: unknown): string {
  const parsed = SourceSemanticSchema.safeParse(value);
  if (!parsed.success) {
    fail("DECK_GEOMETRY_SOURCE_DATA_INVALID");
  }
  return parsed.data;
}

function finiteNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && FINITE_DECIMAL_PATTERN.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) fail("DECK_GEOMETRY_FINITE_VALUE_INVALID");
  return Object.is(parsed, -0) ? 0 : parsed;
}

function optionalFiniteNumber(value: unknown): number | null {
  return value === undefined || value === null ? null : finiteNumber(value);
}

function integer(value: unknown): number {
  const parsed = finiteNumber(value);
  if (!Number.isSafeInteger(parsed)) {
    fail("DECK_GEOMETRY_FINITE_VALUE_INVALID");
  }
  return parsed;
}

function optionalPositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = integer(value);
  return parsed > 0 ? parsed : null;
}

function legacyBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0" || value === "false") return false;
  if (value === 1 || value === "1" || value === "true") return true;
  fail("DECK_GEOMETRY_SOURCE_DATA_INVALID");
}

function point(value: unknown): Point {
  if (Array.isArray(value) && value.length === 2) {
    return { x: finiteNumber(value[0]), y: finiteNumber(value[1]) };
  }
  const source = record(value);
  return { x: finiteNumber(source.x), y: finiteNumber(source.y) };
}

function uniqueById<T extends { readonly id: string }>(
  rows: readonly T[]
): void {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    fail("DECK_GEOMETRY_DUPLICATE_ID");
  }
}

function parseStair(value: unknown): ParsedStair | null {
  if (value === undefined || value === null) return null;
  const source = record(value);
  return {
    width: optionalFiniteNumber(source.width),
    risePerStep:
      source.risePerStep == null
        ? 7.5
        : optionalFiniteNumber(source.risePerStep),
    runPerTread:
      source.runPerTread == null
        ? 10
        : optionalFiniteNumber(source.runPerTread),
    treadCount: optionalPositiveInteger(source.treadCount),
    totalRiseInches: optionalFiniteNumber(source.totalRiseInches),
  };
}

function parseVertex(value: unknown): ParsedVertex {
  const source = record(value);
  const elevationFeet = optionalFiniteNumber(source.elevation);
  return {
    id: sourceId(source.id),
    position: point(source.position),
    elevationFeet,
    carriesAuthoredWork:
      elevationFeet !== null ||
      (source.footingType !== undefined && source.footingType !== null) ||
      (source.postType !== undefined && source.postType !== null),
  };
}

function parseEdge(value: unknown): ParsedEdge {
  const source = record(value);
  const decodedEdgeType = source.edgeType ?? "deck_edge";
  if (decodedEdgeType !== "deck_edge" && decodedEdgeType !== "house_edge") {
    fail("DECK_GEOMETRY_SOURCE_DATA_INVALID");
  }
  const railing =
    source.railingConfig === undefined || source.railingConfig === null
      ? null
      : record(source.railingConfig);
  const decodedRailingFamily =
    railing === null ? null : semanticValue(railing.railingType);
  const inferredRole =
    decodedEdgeType === "house_edge"
      ? "house"
      : decodedRailingFamily === "parapet_wall"
        ? "wall"
        : "open";
  const boundaryRole = source.boundaryRole ?? inferredRole;
  if (
    boundaryRole !== "house" &&
    boundaryRole !== "open" &&
    boundaryRole !== "wall"
  ) {
    fail("DECK_GEOMETRY_SOURCE_DATA_INVALID");
  }
  const dimensionSource = source.dimensionSource ?? "manual";
  if (
    dimensionSource !== "ar" &&
    dimensionSource !== "laser" &&
    dimensionSource !== "manual" &&
    dimensionSource !== "scale"
  ) {
    fail("DECK_GEOMETRY_SOURCE_DATA_INVALID");
  }
  const assignedItems = array(source.assignedItems);
  let gateCount = 0;
  for (const item of assignedItems) {
    const candidate = record(item);
    if (legacyBoolean(candidate.isGate, false)) gateCount += 1;
  }
  const decodedStair = parseStair(source.stairConfig);
  const edgeType = boundaryRole === "house" ? "house_edge" : "deck_edge";
  const railingFamily =
    boundaryRole === "house"
      ? null
      : boundaryRole === "wall"
        ? "parapet_wall"
        : decodedRailingFamily;
  const stair = boundaryRole === "open" ? decodedStair : null;
  return {
    id: sourceId(source.id),
    startVertexId: sourceId(source.startVertexId),
    endVertexId: sourceId(source.endVertexId),
    edgeType,
    boundaryRole,
    dimension: optionalFiniteNumber(source.dimension),
    dimensionSource,
    dimensionStale: legacyBoolean(source.dimensionStale, false),
    railingFamily,
    stair,
    gateCount,
  };
}

function parseBoundaryReference(value: unknown): ParsedBoundaryReference {
  const source = record(value);
  return {
    edgeId: sourceId(source.edgeId),
    startVertexId: sourceId(source.startVertexId),
    endVertexId: sourceId(source.endVertexId),
  };
}

function parseBoundaryLoop(value: unknown): ParsedBoundaryReference[] {
  const rows = array(value);
  if (rows.length < 3) fail("DECK_GEOMETRY_REFERENCE_INVALID");
  return rows.map(parseBoundaryReference);
}

function parseSurface(value: unknown): ParsedSurface {
  const source = record(value);
  const rawBoundary = source.boundary;
  let boundary: ParsedSurface["boundary"] = null;
  if (rawBoundary !== undefined && rawBoundary !== null) {
    const boundarySource = record(rawBoundary);
    boundary = {
      outerLoop: parseBoundaryLoop(boundarySource.outerLoop),
      holeLoops: array(boundarySource.holeLoops).map(parseBoundaryLoop),
    };
  }
  const vertexIds = new Set(
    array(source.vertexIds).map((value) => sourceId(value))
  );
  return {
    id: sourceId(source.id),
    boundary,
    vertexIds,
    finishFamily:
      source.boardMaterial === undefined || source.boardMaterial === null
        ? null
        : semanticValue(source.boardMaterial),
    elevationFeet: optionalFiniteNumber(source.elevationFeet) ?? 0,
  };
}

function parsePlane(input: {
  readonly value: UnknownRecord;
  readonly sourceId: string;
  readonly sortOrder: number;
  readonly elevationFeet: number | null;
  readonly overallElevationFeet: number | null;
  readonly weldTolerance: number;
}): ParsedPlane {
  const vertices = array(input.value.vertices).map(parseVertex);
  const edges = array(input.value.edges).map(parseEdge);
  const surfaces = array(input.value.surfaces).map(parseSurface);
  uniqueById(vertices);
  uniqueById(edges);
  uniqueById(surfaces);
  return {
    sourceId: input.sourceId,
    sortOrder: input.sortOrder,
    elevationFeet: input.elevationFeet,
    overallElevationFeet: input.overallElevationFeet,
    weldTolerance: input.weldTolerance,
    vertices,
    edges,
    surfaces,
  };
}

function rawBoundaryReferenceCount(value: UnknownRecord): number {
  let total = 0;
  for (const rawSurface of array(value.surfaces)) {
    const surface = record(rawSurface);
    if (surface.boundary === undefined || surface.boundary === null) continue;
    const boundary = record(surface.boundary);
    total += array(boundary.outerLoop).length;
    for (const hole of array(boundary.holeLoops)) total += array(hole).length;
  }
  return total;
}

function parseSchemaVersion(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = integer(value);
  if (parsed < 1 || parsed > 11) {
    fail("DECK_GEOMETRY_SOURCE_SCHEMA_UNSUPPORTED");
  }
  return parsed;
}

const DEFAULT_ENDPOINT_SNAP_RADIUS = 20;
const COINCIDENCE_FLOOR_DIVISOR = 20;

function deckKitCoincidenceTolerance(endpointSnapRadius: number): number {
  return Math.max(0, endpointSnapRadius) / 2 / COINCIDENCE_FLOOR_DIVISOR;
}

function drawingCoincidenceTolerance(root: UnknownRecord): number {
  if (root.config === undefined || root.config === null) {
    return deckKitCoincidenceTolerance(DEFAULT_ENDPOINT_SNAP_RADIUS);
  }
  const config = record(root.config);
  const endpointSnapRadius =
    config.endpointSnapRadius == null
      ? DEFAULT_ENDPOINT_SNAP_RADIUS
      : finiteNumber(config.endpointSnapRadius);
  return deckKitCoincidenceTolerance(endpointSnapRadius);
}

function validatePlaneReferences(plane: ParsedPlane): void {
  const vertices = new Set(plane.vertices.map((vertex) => vertex.id));
  const edges = new Map(plane.edges.map((edge) => [edge.id, edge] as const));
  for (const edge of plane.edges) {
    if (
      edge.startVertexId === edge.endVertexId ||
      !vertices.has(edge.startVertexId) ||
      !vertices.has(edge.endVertexId)
    ) {
      fail("DECK_GEOMETRY_REFERENCE_INVALID");
    }
  }
  for (const surface of plane.surfaces) {
    if (surface.boundary === null) {
      if ([...surface.vertexIds].some((id) => !vertices.has(id))) {
        fail("DECK_GEOMETRY_REFERENCE_INVALID");
      }
      continue;
    }
    const loops = [surface.boundary.outerLoop, ...surface.boundary.holeLoops];
    for (const loop of loops) {
      const seen = new Set<string>();
      for (let index = 0; index < loop.length; index += 1) {
        const reference = loop[index]!;
        const edge = edges.get(reference.edgeId);
        const next = loop[(index + 1) % loop.length]!;
        if (
          !edge ||
          seen.has(reference.edgeId) ||
          !vertices.has(reference.startVertexId) ||
          !vertices.has(reference.endVertexId) ||
          reference.startVertexId === reference.endVertexId ||
          !(
            (edge.startVertexId === reference.startVertexId &&
              edge.endVertexId === reference.endVertexId) ||
            (edge.startVertexId === reference.endVertexId &&
              edge.endVertexId === reference.startVertexId)
          ) ||
          reference.endVertexId !== next.startVertexId
        ) {
          fail("DECK_GEOMETRY_REFERENCE_INVALID");
        }
        seen.add(reference.edgeId);
      }
    }
  }
}

function parseLevelConnection(value: unknown): ParsedLevelConnection {
  const source = record(value);
  const stair = parseStair(source.stairConfig);
  if (stair === null) fail("DECK_GEOMETRY_REFERENCE_INVALID");
  return {
    kind: "level_stair",
    id: sourceId(source.id),
    upperLevelId: sourceId(source.upperLevelId),
    lowerLevelId: sourceId(source.lowerLevelId),
    upperEdgeId: sourceId(source.upperEdgeId),
    lowerEdgeId: sourceId(source.lowerEdgeId),
    stair,
  };
}

function parseSurfaceConnection(value: unknown): ParsedSurfaceConnection {
  const source = record(value);
  const transitionKind = source.kind;
  if (transitionKind !== "riser" && transitionKind !== "steps") {
    fail("DECK_GEOMETRY_SOURCE_DATA_INVALID");
  }
  const widthInches = finiteNumber(source.widthInches);
  const runPerStepInches = finiteNumber(source.runPerStepInches);
  if (widthInches <= 0 || runPerStepInches <= 0) {
    fail("DECK_GEOMETRY_SOURCE_DATA_INVALID");
  }
  return {
    kind: "surface_transition",
    id: sourceId(source.id),
    levelId:
      source.levelId === undefined || source.levelId === null
        ? null
        : sourceId(source.levelId),
    edgeId: sourceId(source.edgeId),
    upperSurfaceId: sourceId(source.upperSurfaceId),
    lowerSurfaceId: sourceId(source.lowerSurfaceId),
    transitionKind,
    widthInches,
    runPerStepInches,
  };
}

function parseComponentWitnesses(
  value: unknown
): ParsedComponentWitness[] | null {
  if (value === undefined || value === null) return null;
  const rows = array(value);
  const witnesses: ParsedComponentWitness[] = [];
  for (const rawRow of rows) {
    const row = record(rawRow);
    if (
      row.component_type !== "deck_board" &&
      row.component_type !== "railing"
    ) {
      continue;
    }
    const metadata = record(row.metadata);
    const measurementKey =
      row.component_type === "deck_board" ? "sqft" : "linear_feet";
    const sourceKey =
      row.component_type === "deck_board" ? "surface_id" : "edge_id";
    if (
      metadata[sourceKey] === undefined ||
      metadata[measurementKey] === undefined
    ) {
      fail("DECK_GEOMETRY_COMPONENT_WITNESS_MISMATCH");
    }
    witnesses.push({
      componentType: row.component_type,
      sourceId: sourceId(metadata[sourceKey]),
      levelId:
        metadata.level_id === undefined || metadata.level_id === null
          ? null
          : sourceId(metadata.level_id),
      measurementKey,
      value: finiteNumber(metadata[measurementKey]),
    });
  }
  return witnesses;
}

export function parseDeckGeometrySource(
  sourceJson: string
): ParsedDeckGeometrySource {
  if (
    typeof sourceJson !== "string" ||
    UTF8_ENCODER.encode(sourceJson).length > DECK_GEOMETRY_MAX_SOURCE_BYTES
  ) {
    fail("DECK_GEOMETRY_SOURCE_TOO_LARGE");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(sourceJson) as unknown;
  } catch {
    fail("DECK_GEOMETRY_SOURCE_JSON_INVALID");
  }
  const root = record(decoded);
  const rawLevels = array(root.levels);
  const rawPlanes =
    rawLevels.length > 0 ? rawLevels.map((level) => record(level)) : [root];
  const rawLevelConnections = array(root.levelConnections);
  const rawSurfaceConnections = array(root.surfaceConnections);
  const counts = rawPlanes.reduce<{
    vertices: number;
    edges: number;
    surfaces: number;
    directed: number;
  }>(
    (total, plane) => ({
      vertices: total.vertices + array(plane.vertices).length,
      edges: total.edges + array(plane.edges).length,
      surfaces: total.surfaces + array(plane.surfaces).length,
      directed: total.directed + rawBoundaryReferenceCount(plane),
    }),
    { vertices: 0, edges: 0, surfaces: 0, directed: 0 }
  );
  const connectionCount =
    rawLevelConnections.length + rawSurfaceConnections.length;
  if (
    rawPlanes.length > DECK_GEOMETRY_MAX_PLANES ||
    counts.vertices > DECK_GEOMETRY_MAX_VERTICES ||
    counts.edges > DECK_GEOMETRY_MAX_EDGES ||
    counts.surfaces > DECK_GEOMETRY_MAX_SURFACES ||
    connectionCount > DECK_GEOMETRY_MAX_CONNECTIONS ||
    counts.directed > DECK_GEOMETRY_MAX_DIRECTED_BOUNDARY_REFS
  ) {
    fail("DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED");
  }

  const overallElevationFeet = optionalFiniteNumber(root.overallElevation);
  const singleLevelWeldTolerance = drawingCoincidenceTolerance(root);
  const multiLevelWeldTolerance = deckKitCoincidenceTolerance(
    DEFAULT_ENDPOINT_SNAP_RADIUS
  );
  const planes = rawPlanes.map((plane, index) => {
    if (rawLevels.length === 0) {
      return parsePlane({
        value: plane,
        sourceId: "base",
        sortOrder: 0,
        elevationFeet: overallElevationFeet,
        overallElevationFeet,
        weldTolerance: singleLevelWeldTolerance,
      });
    }
    return parsePlane({
      value: plane,
      sourceId: sourceId(plane.id),
      sortOrder: plane.sortOrder == null ? index : integer(plane.sortOrder),
      elevationFeet: optionalFiniteNumber(plane.elevation),
      overallElevationFeet,
      weldTolerance: multiLevelWeldTolerance,
    });
  });
  uniqueById(planes.map((plane) => ({ id: plane.sourceId })));
  planes.forEach(validatePlaneReferences);

  const levelConnections = rawLevelConnections.map(parseLevelConnection);
  const surfaceConnections = rawSurfaceConnections.map(parseSurfaceConnection);
  uniqueById([...levelConnections, ...surfaceConnections]);
  const planeById = new Map(planes.map((plane) => [plane.sourceId, plane]));
  for (const connection of levelConnections) {
    const upper = planeById.get(connection.upperLevelId);
    const lower = planeById.get(connection.lowerLevelId);
    if (
      !upper ||
      !lower ||
      upper.sourceId === lower.sourceId ||
      !upper.edges.some((edge) => edge.id === connection.upperEdgeId) ||
      !lower.edges.some((edge) => edge.id === connection.lowerEdgeId)
    ) {
      fail("DECK_GEOMETRY_REFERENCE_INVALID");
    }
  }
  for (const connection of surfaceConnections) {
    const plane =
      connection.levelId === null
        ? rawLevels.length === 0
          ? planes[0]
          : null
        : planeById.get(connection.levelId);
    if (
      !plane ||
      !plane.edges.some((edge) => edge.id === connection.edgeId) ||
      !plane.surfaces.some(
        (surface) => surface.id === connection.upperSurfaceId
      ) ||
      !plane.surfaces.some(
        (surface) => surface.id === connection.lowerSurfaceId
      ) ||
      connection.upperSurfaceId === connection.lowerSurfaceId
    ) {
      fail("DECK_GEOMETRY_REFERENCE_INVALID");
    }
  }

  const topologyUnits =
    planes.length +
    counts.vertices +
    counts.edges +
    counts.surfaces +
    connectionCount +
    counts.directed;
  if (topologyUnits > DECK_GEOMETRY_MAX_TOPOLOGY_UNITS) {
    fail("DECK_GEOMETRY_TOPOLOGY_LIMIT_EXCEEDED");
  }

  const scaleFactor = optionalFiniteNumber(root.scaleFactor);
  return {
    schema_version: parseSchemaVersion(root.schemaVersion),
    scale_factor: scaleFactor !== null && scaleFactor > 0 ? scaleFactor : 2,
    topology_units: topologyUnits,
    planes,
    level_connections: levelConnections,
    surface_connections: surfaceConnections,
    component_witnesses: parseComponentWitnesses(root.components),
  };
}

interface ResolvedSurface {
  readonly sourceId: string;
  readonly componentSourceId: string;
  readonly outerVertexIds: readonly string[];
  readonly holeVertexIds: readonly (readonly string[])[];
  readonly outerReferences: readonly ParsedBoundaryReference[];
  readonly holeReferences: readonly (readonly ParsedBoundaryReference[])[];
  readonly finishFamily: string | null;
  readonly elevationFeet: number;
}

interface Face {
  readonly vertexIds: readonly string[];
  readonly positions: readonly Point[];
  readonly holeVertexIds: readonly (readonly string[])[];
  readonly holePositions: readonly (readonly Point[])[];
}

interface WeldedPlaneGeometry {
  readonly vertices: readonly ParsedVertex[];
  readonly edges: readonly ParsedEdge[];
  readonly survivorByVertexId: ReadonlyMap<string, string>;
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function deckKitWeldedPlaneGeometry(plane: ParsedPlane): WeldedPlaneGeometry {
  const tolerance = plane.weldTolerance;
  if (tolerance <= 0 || plane.vertices.length <= 1) {
    return {
      vertices: plane.vertices,
      edges: plane.edges,
      survivorByVertexId: new Map(),
    };
  }

  // Preserve DeckKit's authored-work priority, then use the MCP local-ref
  // revision's source-ID tie break so array-only reorder cannot retarget a
  // projected edge or surface.
  const ordered = [...plane.vertices].sort(
    (left, right) =>
      Number(right.carriesAuthoredWork) - Number(left.carriesAuthoredWork) ||
      left.id.localeCompare(right.id)
  );
  const cellKey = (point: Point): string =>
    `${Math.floor(point.x / tolerance)}|${Math.floor(point.y / tolerance)}`;
  const buckets = new Map<string, string[]>();
  const chosen = new Map<string, Point>();
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
          const distance = pointDistance(vertex.position, candidate);
          if (
            distance <= tolerance &&
            distance < (best?.distance ?? Infinity)
          ) {
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
    return {
      vertices: plane.vertices,
      edges: plane.edges,
      survivorByVertexId,
    };
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

function signedArea(points: readonly Point[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

function polygonArea(points: readonly Point[]): number {
  return Math.abs(signedArea(points));
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
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

function interiorProbe(polygon: readonly Point[]): Point | null {
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

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  return Math.abs(value) <= 1e-10 ? 0 : value > 0 ? 1 : -1;
}

function pointOnSegment(a: Point, b: Point, point: Point): boolean {
  return (
    point.x <= Math.max(a.x, b.x) + 1e-10 &&
    point.x + 1e-10 >= Math.min(a.x, b.x) &&
    point.y <= Math.max(a.y, b.y) + 1e-10 &&
    point.y + 1e-10 >= Math.min(a.y, b.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
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

function isSelfIntersecting(points: readonly Point[]): boolean {
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
          points[secondNext]!
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function detectedFaces(
  plane: ParsedPlane,
  welded: WeldedPlaneGeometry
): Face[] {
  if (welded.vertices.length < 3 || welded.edges.length < 3) return [];
  const vertexById = new Map(
    welded.vertices.map((vertex) => [vertex.id, vertex] as const)
  );
  const adjacency = new Map<string, Set<string>>(
    welded.vertices.map((vertex) => [vertex.id, new Set<string>()])
  );
  for (const edge of welded.edges) {
    if (edge.startVertexId === edge.endVertexId) continue;
    adjacency.get(edge.startVertexId)!.add(edge.endVertexId);
    adjacency.get(edge.endVertexId)!.add(edge.startVertexId);
  }
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
          leftPoint.x - center.x
        );
        const rightAngle = Math.atan2(
          rightPoint.y - center.y,
          rightPoint.x - center.x
        );
        return leftAngle - rightAngle || left.localeCompare(right);
      })
    );
  }

  const walkable = welded.edges.filter(
    (edge) => coreIds.has(edge.startVertexId) && coreIds.has(edge.endVertexId)
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
      if (
        outerIndices.has(face.index) ||
        face.absArea <= 0.5 ||
        seen.has(key)
      ) {
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
          pointInPolygon(probe, container.positions)
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
              candidates[left]!.absArea - candidates[right]!.absArea
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

function referencesForVertexLoop(
  plane: ParsedPlane,
  vertexIds: readonly string[],
  survivorByVertexId: ReadonlyMap<string, string>
): ParsedBoundaryReference[] {
  const survivor = (id: string): string => survivorByVertexId.get(id) ?? id;
  return vertexIds.map((startVertexId, index) => {
    const endVertexId = vertexIds[(index + 1) % vertexIds.length]!;
    const candidates = plane.edges
      .filter(
        (edge) =>
          (survivor(edge.startVertexId) === startVertexId &&
            survivor(edge.endVertexId) === endVertexId) ||
          (survivor(edge.startVertexId) === endVertexId &&
            survivor(edge.endVertexId) === startVertexId)
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const edge = candidates[0];
    if (!edge) fail("DECK_GEOMETRY_REFERENCE_INVALID");
    return { edgeId: edge.id, startVertexId, endVertexId };
  });
}

function vertexSetKey(ids: Iterable<string>): string {
  return [...ids].sort().join("|");
}

function resolvedSurfaces(plane: ParsedPlane): ResolvedSurface[] {
  const welded = deckKitWeldedPlaneGeometry(plane);
  const survivor = (id: string): string =>
    welded.survivorByVertexId.get(id) ?? id;
  const projectedBoundaryReference = (
    reference: ParsedBoundaryReference
  ): ParsedBoundaryReference => ({
    edgeId: reference.edgeId,
    startVertexId: survivor(reference.startVertexId),
    endVertexId: survivor(reference.endVertexId),
  });
  const projectedVertexSetKey = (ids: Iterable<string>): string =>
    vertexSetKey([...ids].map(survivor));
  const explicit = plane.surfaces
    .filter(
      (
        surface
      ): surface is ParsedSurface & {
        readonly boundary: NonNullable<ParsedSurface["boundary"]>;
      } => surface.boundary !== null
    )
    .map((surface) => ({
      sourceId: surface.id,
      componentSourceId: surface.id,
      outerVertexIds: surface.boundary.outerLoop.map(
        (reference) => reference.startVertexId
      ),
      holeVertexIds: surface.boundary.holeLoops.map((loop) =>
        loop.map((reference) => reference.startVertexId)
      ),
      outerReferences: surface.boundary.outerLoop.map(
        projectedBoundaryReference
      ),
      holeReferences: surface.boundary.holeLoops.map((loop) =>
        loop.map(projectedBoundaryReference)
      ),
      finishFamily: surface.finishFamily,
      elevationFeet: surface.elevationFeet,
    }));
  const detected = detectedFaces(plane, welded);
  const claimed = new Set<string>();
  for (const surface of explicit) {
    claimed.add(projectedVertexSetKey(surface.outerVertexIds));
    claimed.add(
      projectedVertexSetKey([
        ...surface.outerVertexIds,
        ...surface.holeVertexIds.flat(),
      ])
    );
    surface.holeVertexIds.forEach((hole) =>
      claimed.add(projectedVertexSetKey(hole))
    );
  }
  const unmatched = detected.filter(
    (face) =>
      !claimed.has(projectedVertexSetKey(face.vertexIds)) &&
      !claimed.has(
        projectedVertexSetKey([...face.vertexIds, ...face.holeVertexIds.flat()])
      )
  );
  const boundarylessSurfaces = plane.surfaces
    .filter((surface) => surface.boundary === null)
    .sort((left, right) => left.id.localeCompare(right.id));
  const claimedPayloadIds = new Set<string>();
  const resolvedDetected = unmatched.map((face) => {
    const detectedSet = new Set([
      ...face.vertexIds,
      ...face.holeVertexIds.flat(),
    ]);
    let payload: ParsedSurface | null = null;
    let bestOverlap = -1;
    for (const candidate of boundarylessSurfaces) {
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
        candidateSet.has(id)
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
    const stableFaceId = `detected:${vertexSetKey(detectedSet)}`;
    return {
      sourceId: payload?.id ?? stableFaceId,
      componentSourceId:
        payload?.id ??
        (plane.surfaces.length === 0 ? "footprint" : stableFaceId),
      outerVertexIds: face.vertexIds,
      holeVertexIds: face.holeVertexIds,
      outerReferences: referencesForVertexLoop(
        plane,
        face.vertexIds,
        welded.survivorByVertexId
      ),
      holeReferences: face.holeVertexIds.map((hole) =>
        referencesForVertexLoop(plane, hole, welded.survivorByVertexId)
      ),
      finishFamily: payload?.finishFamily ?? null,
      elevationFeet: payload?.elevationFeet ?? 0,
    };
  });
  return [...explicit, ...resolvedDetected].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId)
  );
}

function singleCycleVertexIds(plane: ParsedPlane): string[] | null {
  if (plane.vertices.length < 3 || plane.edges.length < 3) return null;
  const adjacency = new Map<string, string[]>(
    plane.vertices.map((vertex) => [vertex.id, []])
  );
  for (const edge of plane.edges) {
    adjacency.get(edge.startVertexId)!.push(edge.endVertexId);
    adjacency.get(edge.endVertexId)!.push(edge.startVertexId);
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
  return adjacency.get(current)!.includes(start) ? ordered : null;
}

function positionsFor(
  plane: ParsedPlane,
  vertexIds: readonly string[]
): Point[] {
  const byId = new Map(
    plane.vertices.map((vertex) => [vertex.id, vertex.position] as const)
  );
  return vertexIds.map((id) => byId.get(id)!);
}

function physicalBaseElevationFeet(plane: ParsedPlane): number {
  if (plane.elevationFeet !== null) return plane.elevationFeet;
  const values = plane.vertices
    .map((vertex) => vertex.elevationFeet)
    .filter((value): value is number => value !== null);
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function areaCalculation(input: {
  readonly source: ParsedDeckGeometrySource;
  readonly surfacesByPlane: ReadonlyMap<string, readonly ResolvedSurface[]>;
}): {
  readonly value: number | null;
  readonly state: "authoritative" | "invalid" | "unavailable";
  readonly warning: "closed_surface_unavailable" | "self_intersection" | null;
} {
  let totalCanvasArea = 0;
  let anySurface = false;
  for (const plane of input.source.planes) {
    const surfaces = input.surfacesByPlane.get(plane.sourceId) ?? [];
    if (surfaces.length > 0) {
      for (const surface of surfaces) {
        const outer = positionsFor(plane, surface.outerVertexIds);
        const holes = surface.holeVertexIds.map((hole) =>
          positionsFor(plane, hole)
        );
        if (
          isSelfIntersecting(outer) ||
          holes.some((hole) => isSelfIntersecting(hole))
        ) {
          return {
            value: null,
            state: "invalid",
            warning: "self_intersection",
          };
        }
        const regionArea =
          polygonArea(outer) -
          holes.reduce((total, hole) => total + polygonArea(hole), 0);
        if (!Number.isFinite(regionArea) || regionArea <= 0) {
          return {
            value: null,
            state: "invalid",
            warning: "self_intersection",
          };
        }
        totalCanvasArea += regionArea;
        anySurface = true;
      }
      continue;
    }
    const fallback = singleCycleVertexIds(plane);
    if (fallback) {
      const positions = positionsFor(plane, fallback);
      if (isSelfIntersecting(positions)) {
        return { value: null, state: "invalid", warning: "self_intersection" };
      }
      const area = polygonArea(positions);
      if (area > 0) {
        totalCanvasArea += area;
        anySurface = true;
      }
    }
  }
  if (!anySurface || totalCanvasArea <= 0) {
    return {
      value: null,
      state: "unavailable",
      warning: "closed_surface_unavailable",
    };
  }
  return {
    value:
      totalCanvasArea / (input.source.scale_factor * input.source.scale_factor),
    state: "authoritative",
    warning: null,
  };
}

interface InternalMetric {
  readonly value: number | null;
  readonly state: "authoritative" | "invalid" | "unavailable";
  readonly warning: string | null;
}

function isPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function flatGuardCalculations(source: ParsedDeckGeometrySource): {
  readonly flat: InternalMetric;
  readonly parapet: InternalMetric;
} {
  let flatInches = 0;
  let parapetInches = 0;
  let flatUnavailable = false;
  let parapetUnavailable = false;
  for (const plane of source.planes) {
    for (const edge of plane.edges) {
      if (edge.edgeType !== "deck_edge" || edge.railingFamily === null) {
        continue;
      }
      const parapet = edge.railingFamily === "parapet_wall";
      const dimensionValid =
        isPositive(edge.dimension) && edge.dimensionStale === false;
      const stairOpening = edge.stair === null ? 0 : edge.stair.width;
      const openingValid =
        edge.stair === null ||
        (stairOpening !== null &&
          Number.isFinite(stairOpening) &&
          stairOpening > 0);
      if (!dimensionValid || !openingValid) {
        if (parapet) parapetUnavailable = true;
        else flatUnavailable = true;
        continue;
      }
      const net = Math.max(
        0,
        edge.dimension - (stairOpening ?? 0) - edge.gateCount * 36
      );
      if (parapet) parapetInches += net;
      else flatInches += net;
    }
  }
  return {
    flat: flatUnavailable
      ? {
          value: null,
          state: "unavailable",
          warning: "flat_dimension_unavailable",
        }
      : { value: flatInches, state: "authoritative", warning: null },
    parapet: parapetUnavailable
      ? {
          value: null,
          state: "unavailable",
          warning: "parapet_dimension_unavailable",
        }
      : { value: parapetInches, state: "authoritative", warning: null },
  };
}

function owningSurfaceRise(
  plane: ParsedPlane,
  edge: ParsedEdge
): number | null {
  const candidates = plane.surfaces.filter((surface) =>
    surface.boundary
      ? [surface.boundary.outerLoop, ...surface.boundary.holeLoops]
          .flat()
          .some((reference) => reference.edgeId === edge.id)
      : false
  );
  if (candidates.length === 0) return null;
  const base = physicalBaseElevationFeet(plane);
  const highest = Math.max(
    ...candidates.map((surface) => base + surface.elevationFeet)
  );
  return highest > 0 ? highest * 12 : null;
}

function endpointRise(plane: ParsedPlane, edge: ParsedEdge): number | null {
  const vertexById = new Map(
    plane.vertices.map((vertex) => [vertex.id, vertex] as const)
  );
  const start = vertexById.get(edge.startVertexId);
  const end = vertexById.get(edge.endVertexId);
  if (!start || !end) return null;
  const startElevation =
    start.elevationFeet ?? plane.elevationFeet ?? plane.overallElevationFeet;
  const endElevation =
    end.elevationFeet ?? plane.elevationFeet ?? plane.overallElevationFeet;
  if (startElevation === null || endElevation === null) return null;
  const midpoint = ((startElevation + endElevation) / 2) * 12;
  return midpoint > 0 ? midpoint : null;
}

interface ResolvedStairStringer {
  readonly rise: number;
  readonly treadCount: number;
  readonly runPerTread: number;
  readonly length: number;
}

function resolvedStairStringer(input: {
  readonly rise: number | null;
  readonly stair: ParsedStair;
}): ResolvedStairStringer | null {
  if (!isPositive(input.rise) || !isPositive(input.stair.runPerTread)) {
    return null;
  }
  const treadCount =
    input.stair.treadCount ??
    (isPositive(input.stair.risePerStep)
      ? Math.ceil(input.rise / input.stair.risePerStep)
      : 0);
  if (!Number.isSafeInteger(treadCount) || treadCount <= 0) return null;
  const totalRun = treadCount * input.stair.runPerTread;
  const length = Math.hypot(input.rise, totalRun);
  return Number.isFinite(length) && length > 0
    ? {
        rise: input.rise,
        treadCount,
        runPerTread: input.stair.runPerTread,
        length,
      }
    : null;
}

function stairStringerLength(input: {
  readonly rise: number | null;
  readonly stair: ParsedStair;
}): number | null {
  return resolvedStairStringer(input)?.length ?? null;
}

function projectedStairWidth(stair: ParsedStair) {
  return isPositive(stair.width)
    ? ({ state: "recorded", inches: stair.width } as const)
    : ({ state: "not_recorded" } as const);
}

function projectedStairStringer(input: {
  readonly rise: number | null;
  readonly stair: ParsedStair;
}) {
  const stringer = resolvedStairStringer(input);
  return stringer === null
    ? ({
        state: "unavailable",
        warning: "stair_geometry_unavailable",
      } as const)
    : ({
        state: "authoritative",
        rise_inches: stringer.rise,
        tread_count: stringer.treadCount,
        run_per_tread_inches: stringer.runPerTread,
      } as const);
}

function stairGuardCalculation(
  source: ParsedDeckGeometrySource
): InternalMetric {
  let total = 0;
  let unavailable = false;
  for (const plane of source.planes) {
    for (const edge of plane.edges) {
      if (edge.stair === null) continue;
      const rise =
        (isPositive(edge.stair.totalRiseInches)
          ? edge.stair.totalRiseInches
          : null) ??
        owningSurfaceRise(plane, edge) ??
        endpointRise(plane, edge);
      const stringer = stairStringerLength({ rise, stair: edge.stair });
      if (stringer === null) unavailable = true;
      else total += 2 * stringer;
    }
  }
  const planeById = new Map(
    source.planes.map((plane) => [plane.sourceId, plane] as const)
  );
  for (const connection of source.level_connections) {
    const upper = planeById.get(connection.upperLevelId)!;
    const lower = planeById.get(connection.lowerLevelId)!;
    const rise =
      upper.elevationFeet !== null && lower.elevationFeet !== null
        ? (upper.elevationFeet - lower.elevationFeet) * 12
        : null;
    const stringer = stairStringerLength({ rise, stair: connection.stair });
    if (stringer === null) unavailable = true;
    else total += 2 * stringer;
  }
  return unavailable
    ? {
        value: null,
        state: "unavailable",
        warning: "stair_geometry_unavailable",
      }
    : { value: total, state: "authoritative", warning: null };
}

function roundPublic(value: number): number {
  return Number(value.toFixed(2));
}

function publicMetric(
  metric: InternalMetric,
  divisor: number
):
  | {
      readonly state: "authoritative";
      readonly value: number;
      readonly warning: null;
    }
  | { readonly state: "invalid" | "unavailable"; readonly warning: string } {
  return metric.state === "authoritative" && metric.value !== null
    ? {
        state: "authoritative",
        value: roundPublic(metric.value / divisor),
        warning: null,
      }
    : {
        state: metric.state === "authoritative" ? "invalid" : metric.state,
        warning: metric.warning ?? "invalid_topology",
      };
}

function witnessSortKey(witness: ParsedComponentWitness): string {
  return [
    witness.componentType,
    witness.levelId ?? "",
    witness.sourceId,
    witness.measurementKey,
    witness.value.toFixed(8),
  ].join("|");
}

function recomputedComponentWitnesses(input: {
  readonly source: ParsedDeckGeometrySource;
  readonly surfacesByPlane: ReadonlyMap<string, readonly ResolvedSurface[]>;
}): ParsedComponentWitness[] {
  const output: ParsedComponentWitness[] = [];
  const multiLevel = input.source.planes.some(
    (plane) => plane.sourceId !== "base"
  );
  for (const plane of input.source.planes) {
    const levelId = multiLevel ? plane.sourceId : null;
    for (const edge of plane.edges) {
      if (
        edge.edgeType !== "deck_edge" ||
        edge.railingFamily === null ||
        !isPositive(edge.dimension)
      ) {
        continue;
      }
      const stairOpening = edge.stair?.width ?? 0;
      if (!Number.isFinite(stairOpening) || stairOpening < 0) continue;
      output.push({
        componentType: "railing",
        sourceId: edge.id,
        levelId,
        measurementKey: "linear_feet",
        value: roundPublic(
          Math.max(0, edge.dimension - stairOpening - edge.gateCount * 36) / 12
        ),
      });
    }
    const resolved = input.surfacesByPlane.get(plane.sourceId) ?? [];
    if (plane.surfaces.length === 0) {
      const welded = deckKitWeldedPlaneGeometry(plane);
      const fallback = singleCycleVertexIds({
        ...plane,
        vertices: welded.vertices,
        edges: welded.edges,
      });
      if (fallback === null) continue;
      const outer = positionsFor(plane, fallback);
      if (outer.length < 3 || isSelfIntersecting(outer)) continue;
      const canvasArea = polygonArea(outer);
      if (!Number.isFinite(canvasArea) || canvasArea <= 0) continue;
      output.push({
        componentType: "deck_board",
        sourceId: "footprint",
        levelId,
        measurementKey: "sqft",
        value: roundPublic(
          canvasArea /
            (input.source.scale_factor * input.source.scale_factor) /
            144
        ),
      });
      continue;
    }
    const persistedSurfaceIds = new Set(
      plane.surfaces.map((surface) => surface.id)
    );
    for (const surface of resolved) {
      if (!persistedSurfaceIds.has(surface.componentSourceId)) continue;
      const outer = positionsFor(plane, surface.outerVertexIds);
      const holes = surface.holeVertexIds.map((ids) =>
        positionsFor(plane, ids)
      );
      if (
        outer.length < 3 ||
        isSelfIntersecting(outer) ||
        holes.some((hole) => isSelfIntersecting(hole))
      ) {
        continue;
      }
      const canvasArea =
        polygonArea(outer) -
        holes.reduce((total, hole) => total + polygonArea(hole), 0);
      if (!Number.isFinite(canvasArea) || canvasArea <= 0) continue;
      output.push({
        componentType: "deck_board",
        sourceId: surface.componentSourceId,
        levelId,
        measurementKey: "sqft",
        value: roundPublic(
          canvasArea /
            (input.source.scale_factor * input.source.scale_factor) /
            144
        ),
      });
    }
  }
  return output.sort((left, right) =>
    witnessSortKey(left).localeCompare(witnessSortKey(right))
  );
}

function assertComponentWitnesses(input: {
  readonly source: ParsedDeckGeometrySource;
  readonly surfacesByPlane: ReadonlyMap<string, readonly ResolvedSurface[]>;
}): "authoritative" | "components_absent_legacy" {
  if (input.source.component_witnesses === null) {
    return "components_absent_legacy";
  }
  const persisted = [...input.source.component_witnesses].sort((left, right) =>
    witnessSortKey(left).localeCompare(witnessSortKey(right))
  );
  const recomputed = recomputedComponentWitnesses(input);
  if (
    persisted.length !== recomputed.length ||
    persisted.some((row, index) => {
      const expected = recomputed[index]!;
      return (
        row.componentType !== expected.componentType ||
        row.sourceId !== expected.sourceId ||
        row.levelId !== expected.levelId ||
        row.measurementKey !== expected.measurementKey ||
        Math.abs(row.value - expected.value) > 1e-9
      );
    })
  ) {
    fail("DECK_GEOMETRY_COMPONENT_WITNESS_MISMATCH");
  }
  return "authoritative";
}

function edgeDirection(
  reference: ParsedBoundaryReference,
  edge: ParsedEdge,
  survivorByVertexId: ReadonlyMap<string, string>
): "forward" | "reverse" {
  const startVertexId =
    survivorByVertexId.get(edge.startVertexId) ?? edge.startVertexId;
  const endVertexId =
    survivorByVertexId.get(edge.endVertexId) ?? edge.endVertexId;
  if (
    startVertexId === reference.startVertexId &&
    endVertexId === reference.endVertexId
  ) {
    return "forward";
  }
  if (
    endVertexId === reference.startVertexId &&
    startVertexId === reference.endVertexId
  ) {
    return "reverse";
  }
  fail("DECK_GEOMETRY_REFERENCE_INVALID");
}

function requiredLocalReference(
  references: ReadonlyMap<string, string>,
  sourceKey: string
): string {
  const reference = references.get(sourceKey);
  if (!reference) fail("DECK_GEOMETRY_REFERENCE_INVALID");
  return reference;
}

function projectTopology(input: {
  readonly source: ParsedDeckGeometrySource;
  readonly surfacesByPlane: ReadonlyMap<string, readonly ResolvedSurface[]>;
}): {
  readonly topology: DeckDesignGeometryTopology;
  readonly witnesses: DeckGeometryCalculation["local_reference_witnesses"];
} {
  const sortedPlanes = [...input.source.planes].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.sourceId.localeCompare(right.sourceId)
  );
  const witnesses: Array<
    DeckGeometryCalculation["local_reference_witnesses"][number]
  > = [];
  const planeRefById = new Map<string, string>();
  const edgeRefByScopedId = new Map<string, string>();
  const surfaceRefByScopedId = new Map<string, string>();
  const planes = sortedPlanes.map((plane, planeIndex) => {
    const welded = deckKitWeldedPlaneGeometry(plane);
    const planeRef = `plane:${planeIndex + 1}`;
    planeRefById.set(plane.sourceId, planeRef);
    witnesses.push({
      kind: "plane",
      source_id: plane.sourceId,
      local_ref: planeRef,
    });
    const sortedVertices = [...plane.vertices].sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    const vertexRefById = new Map<string, string>();
    const vertices = sortedVertices.map((vertex, vertexIndex) => {
      const vertexRef = `${planeRef}:vertex:${vertexIndex + 1}`;
      vertexRefById.set(vertex.id, vertexRef);
      witnesses.push({
        kind: "vertex",
        source_id: `${plane.sourceId}:${vertex.id}`,
        local_ref: vertexRef,
      });
      return { vertex_ref: vertexRef, position: vertex.position };
    });
    const sortedEdges = [...plane.edges].sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    const edgeById = new Map(
      sortedEdges.map((edge) => [edge.id, edge] as const)
    );
    const edges = sortedEdges.map((edge, edgeIndex) => {
      const edgeRef = `${planeRef}:edge:${edgeIndex + 1}`;
      const projectedStartVertexId =
        welded.survivorByVertexId.get(edge.startVertexId) ?? edge.startVertexId;
      const projectedEndVertexId =
        welded.survivorByVertexId.get(edge.endVertexId) ?? edge.endVertexId;
      const preserveRawEndpoints =
        projectedStartVertexId === projectedEndVertexId;
      edgeRefByScopedId.set(`${plane.sourceId}:${edge.id}`, edgeRef);
      witnesses.push({
        kind: "edge",
        source_id: `${plane.sourceId}:${edge.id}`,
        local_ref: edgeRef,
      });
      return {
        edge_ref: edgeRef,
        start_vertex_ref: vertexRefById.get(
          preserveRawEndpoints ? edge.startVertexId : projectedStartVertexId
        )!,
        end_vertex_ref: vertexRefById.get(
          preserveRawEndpoints ? edge.endVertexId : projectedEndVertexId
        )!,
        edge_type: edge.edgeType,
        boundary_role: {
          value: edge.boundaryRole,
          content_kind: "untrusted_business_data" as const,
        },
        dimension: isPositive(edge.dimension)
          ? {
              state: "recorded" as const,
              inches: edge.dimension,
              source: edge.dimensionSource,
              stale: edge.dimensionStale,
            }
          : { state: "not_recorded" as const },
        railing:
          edge.railingFamily === null
            ? { state: "not_configured" as const }
            : {
                state: "configured" as const,
                family: {
                  value: edge.railingFamily,
                  content_kind: "untrusted_business_data" as const,
                },
              },
        stair:
          edge.stair === null
            ? ({ state: "not_configured" } as const)
            : {
                state: "configured" as const,
                width: projectedStairWidth(edge.stair),
                stringer: projectedStairStringer({
                  rise:
                    (isPositive(edge.stair.totalRiseInches)
                      ? edge.stair.totalRiseInches
                      : null) ??
                    owningSurfaceRise(plane, edge) ??
                    endpointRise(plane, edge),
                  stair: edge.stair,
                }),
              },
      };
    });
    const sortedSurfaces = [
      ...(input.surfacesByPlane.get(plane.sourceId) ?? []),
    ].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    const surfaces = sortedSurfaces.map((surface, surfaceIndex) => {
      const surfaceRef = `${planeRef}:surface:${surfaceIndex + 1}`;
      surfaceRefByScopedId.set(
        `${plane.sourceId}:${surface.sourceId}`,
        surfaceRef
      );
      witnesses.push({
        kind: "surface",
        source_id: `${plane.sourceId}:${surface.sourceId}`,
        local_ref: surfaceRef,
      });
      const projectLoop = (loop: readonly ParsedBoundaryReference[]) =>
        loop.map((reference) => {
          const edge = edgeById.get(reference.edgeId)!;
          return {
            edge_ref: edgeRefByScopedId.get(
              `${plane.sourceId}:${reference.edgeId}`
            )!,
            direction: edgeDirection(
              reference,
              edge,
              welded.survivorByVertexId
            ),
          };
        });
      return {
        surface_ref: surfaceRef,
        finish_family:
          surface.finishFamily === null
            ? null
            : {
                value: surface.finishFamily,
                content_kind: "untrusted_business_data" as const,
              },
        outer_loop: projectLoop(surface.outerReferences),
        hole_loops: surface.holeReferences.map(projectLoop),
      };
    });
    return {
      plane_ref: planeRef,
      level:
        plane.sourceId === "base"
          ? ({ state: "base" } as const)
          : ({
              state: "level",
              sort_order: plane.sortOrder,
              elevation_inches: physicalBaseElevationFeet(plane) * 12,
            } as const),
      vertices,
      edges,
      surfaces,
    };
  });

  const planeById = new Map(
    input.source.planes.map((plane) => [plane.sourceId, plane] as const)
  );
  const sortedConnections = [
    ...input.source.level_connections,
    ...input.source.surface_connections,
  ].sort((left, right) => left.id.localeCompare(right.id));
  const connections = sortedConnections.map((connection, index) => {
    const connectionRef = `connection:${index + 1}`;
    witnesses.push({
      kind: "connection",
      source_id: connection.id,
      local_ref: connectionRef,
    });
    if (connection.kind === "level_stair") {
      const upper = planeById.get(connection.upperLevelId)!;
      const lower = planeById.get(connection.lowerLevelId)!;
      const rise =
        upper.elevationFeet !== null && lower.elevationFeet !== null
          ? (upper.elevationFeet - lower.elevationFeet) * 12
          : null;
      return {
        kind: "level_stair" as const,
        connection_ref: connectionRef,
        upper_plane_ref: requiredLocalReference(
          planeRefById,
          connection.upperLevelId
        ),
        lower_plane_ref: requiredLocalReference(
          planeRefById,
          connection.lowerLevelId
        ),
        upper_edge_ref: requiredLocalReference(
          edgeRefByScopedId,
          `${connection.upperLevelId}:${connection.upperEdgeId}`
        ),
        lower_edge_ref: requiredLocalReference(
          edgeRefByScopedId,
          `${connection.lowerLevelId}:${connection.lowerEdgeId}`
        ),
        stair: {
          width: projectedStairWidth(connection.stair),
          stringer: projectedStairStringer({
            rise,
            stair: connection.stair,
          }),
        },
      };
    }
    const planeId = connection.levelId ?? "base";
    return {
      kind: "surface_transition" as const,
      connection_ref: connectionRef,
      plane_ref: requiredLocalReference(planeRefById, planeId),
      edge_ref: requiredLocalReference(
        edgeRefByScopedId,
        `${planeId}:${connection.edgeId}`
      ),
      upper_surface_ref: requiredLocalReference(
        surfaceRefByScopedId,
        `${planeId}:${connection.upperSurfaceId}`
      ),
      lower_surface_ref: requiredLocalReference(
        surfaceRefByScopedId,
        `${planeId}:${connection.lowerSurfaceId}`
      ),
      transition_kind: connection.transitionKind,
      width_inches: connection.widthInches,
      run_per_step_inches: connection.runPerStepInches,
    };
  });
  const directedBoundaryCount = planes.reduce(
    (planeTotal, plane) =>
      planeTotal +
      plane.surfaces.reduce(
        (surfaceTotal, surface) =>
          surfaceTotal +
          surface.outer_loop.length +
          surface.hole_loops.reduce(
            (holeTotal, hole) => holeTotal + hole.length,
            0
          ),
        0
      ),
    0
  );
  const vertexCount = planes.reduce(
    (total, plane) => total + plane.vertices.length,
    0
  );
  const edgeCount = planes.reduce(
    (total, plane) => total + plane.edges.length,
    0
  );
  const surfaceCount = planes.reduce(
    (total, plane) => total + plane.surfaces.length,
    0
  );
  if (
    planes.length > DECK_GEOMETRY_MAX_PLANES ||
    vertexCount > DECK_GEOMETRY_MAX_VERTICES ||
    edgeCount > DECK_GEOMETRY_MAX_EDGES ||
    surfaceCount > DECK_GEOMETRY_MAX_SURFACES ||
    connections.length > DECK_GEOMETRY_MAX_CONNECTIONS ||
    directedBoundaryCount > DECK_GEOMETRY_MAX_DIRECTED_BOUNDARY_REFS
  ) {
    fail("DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED");
  }
  const topologyUnits =
    planes.length +
    vertexCount +
    edgeCount +
    surfaceCount +
    connections.length +
    directedBoundaryCount;
  if (topologyUnits > DECK_GEOMETRY_MAX_TOPOLOGY_UNITS) {
    fail("DECK_GEOMETRY_TOPOLOGY_LIMIT_EXCEEDED");
  }
  const topology = DeckDesignGeometryTopologySchema.parse({
    topology_units: topologyUnits,
    planes,
    connections,
  });
  return {
    topology,
    witnesses: Object.freeze(
      witnesses.sort((left, right) =>
        `${left.kind}:${left.source_id}`.localeCompare(
          `${right.kind}:${right.source_id}`
        )
      )
    ),
  };
}

export function calculateDeckGeometryFromSourceJson(
  sourceJson: string
): DeckGeometryCalculation {
  const source = parseDeckGeometrySource(sourceJson);
  const surfacesByPlane = new Map(
    source.planes.map(
      (plane) => [plane.sourceId, resolvedSurfaces(plane)] as const
    )
  );
  const area = areaCalculation({ source, surfacesByPlane });
  const flatGuard = flatGuardCalculations(source);
  const stair = stairGuardCalculation(source);
  const combined: InternalMetric = [
    flatGuard.flat,
    stair,
    flatGuard.parapet,
  ].every((metric) => metric.state === "authoritative")
    ? {
        value: flatGuard.flat.value! + stair.value! + flatGuard.parapet.value!,
        state: "authoritative",
        warning: null,
      }
    : {
        value: null,
        state: "unavailable",
        warning: "guard_subtype_unavailable",
      };
  const componentWitness = assertComponentWitnesses({
    source,
    surfacesByPlane,
  });
  const measurements = DeckDesignGeometryMeasurementsSchema.parse({
    area_square_feet: publicMetric(area, 144),
    flat_railing_linear_feet: publicMetric(flatGuard.flat, 12),
    stair_railing_linear_feet: publicMetric(stair, 12),
    parapet_linear_feet: publicMetric(flatGuard.parapet, 12),
    combined_guard_linear_feet: publicMetric(combined, 12),
    component_witness:
      componentWitness === "authoritative"
        ? { state: "authoritative", warning: null }
        : {
            state: "unavailable",
            warning: "components_absent_legacy",
          },
  });
  const projection = projectTopology({ source, surfacesByPlane });
  return Object.freeze({
    drawing_schema_version: source.schema_version,
    topology: projection.topology,
    measurements,
    full_precision: Object.freeze({
      area_square_inches: area.value,
      flat_railing_inches: flatGuard.flat.value,
      stair_railing_inches: stair.value,
      parapet_inches: flatGuard.parapet.value,
      combined_guard_inches: combined.value,
    }),
    local_reference_witnesses: projection.witnesses,
  });
}
