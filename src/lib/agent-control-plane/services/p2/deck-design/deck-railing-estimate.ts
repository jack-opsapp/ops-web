import {
  DeckRailingEstimateSchema,
  DeckStairPlacementSchema,
  type DeckDesignGeometryTopologyV2,
  type DeckRailingEstimate,
  type DeckRailingEstimateIssue,
  type DeckStairPlacement,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry-v2";
import type {
  DeckGeometryCalculation,
  ParsedDeckGeometrySource,
  ParsedStair,
} from "./deck-geometry-calculator";

type TopologyPlane = DeckDesignGeometryTopologyV2["planes"][number];
type TopologyEdge = TopologyPlane["edges"][number];
const positive = (n: number | null): n is number =>
  n !== null && Number.isFinite(n) && n > 0;
const rounded = (n: number) => Number(n.toFixed(2));

// Coordinates identify topology only. All quantity arithmetic below uses
// persisted inches, never the length of these canvas segments.
function collinearOverlap(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number }
): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) return false;
  const cross = (p: typeof a) => ((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
  if (Math.abs(cross(c)) > 1e-7 || Math.abs(cross(d)) > 1e-7) return false;
  const project = (p: typeof a) =>
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / length;
  return (
    Math.min(length, Math.max(project(c), project(d))) -
      Math.max(0, Math.min(project(c), project(d))) >
    1e-7
  );
}
function endpoints(plane: TopologyPlane, edge: TopologyEdge) {
  return [
    plane.vertices.find((v) => v.vertex_ref === edge.start_vertex_ref)!
      .position,
    plane.vertices.find((v) => v.vertex_ref === edge.end_vertex_ref)!.position,
  ] as const;
}
type CanvasPoint = { x: number; y: number };
function cross(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function onSegment(a: CanvasPoint, b: CanvasPoint, p: CanvasPoint) {
  return (
    Math.abs(cross(a, b, p)) <= 1e-7 &&
    p.x >= Math.min(a.x, b.x) - 1e-7 &&
    p.x <= Math.max(a.x, b.x) + 1e-7 &&
    p.y >= Math.min(a.y, b.y) - 1e-7 &&
    p.y <= Math.max(a.y, b.y) + 1e-7
  );
}
function intersects(
  a: CanvasPoint,
  b: CanvasPoint,
  c: CanvasPoint,
  d: CanvasPoint
) {
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 &&
      cross(c, d, a) * cross(c, d, b) < 0) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}
function inside(p: CanvasPoint, polygon: CanvasPoint[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (onSegment(a, b, p)) return false;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}
function selfCrossing(plane: TopologyPlane): boolean {
  const surfacePolygons = plane.surfaces.map((surface) =>
    [surface.outer_loop, ...surface.hole_loops].map((loop) =>
      loop.map((r) => {
        const edge = plane.edges.find((e) => e.edge_ref === r.edge_ref)!;
        return endpoints(plane, edge)[r.direction === "forward" ? 0 : 1];
      })
    )
  );
  for (const polygons of surfacePolygons) {
    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i++)
        for (let j = i + 1; j < polygon.length; j++) {
          if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
          if (
            intersects(
              polygon[i],
              polygon[(i + 1) % polygon.length],
              polygon[j],
              polygon[(j + 1) % polygon.length]
            )
          )
            return true;
        }
    }
    for (let i = 0; i < polygons.length; i++)
      for (let j = i + 1; j < polygons.length; j++) {
        const a = polygons[i],
          b = polygons[j];
        for (let x = 0; x < a.length; x++)
          for (let y = 0; y < b.length; y++)
            if (
              intersects(
                a[x],
                a[(x + 1) % a.length],
                b[y],
                b[(y + 1) % b.length]
              )
            )
              return true;
        if (i === 0 ? !inside(b[0], a) : inside(a[0], b) || inside(b[0], a))
          return true;
      }
  }
  // Adjacent faces may share boundary segments; overlapping face interiors
  // cannot establish an outside perimeter even when every loop is closed.
  for (let i = 0; i < surfacePolygons.length; i++)
    for (let j = i + 1; j < surfacePolygons.length; j++) {
      const a = surfacePolygons[i][0],
        b = surfacePolygons[j][0];
      const inSurface = (p: CanvasPoint, loops: CanvasPoint[][]) =>
        inside(p, loops[0]) && !loops.slice(1).some((h) => inside(p, h));
      if (
        a.some((p) => inSurface(p, surfacePolygons[j])) ||
        b.some((p) => inSurface(p, surfacePolygons[i])) ||
        (a.length === b.length &&
          a.every((p) => b.some((q) => p.x === q.x && p.y === q.y)))
      )
        return true;
      for (let x = 0; x < a.length; x++)
        for (let y = 0; y < b.length; y++) {
          const c = a[(x + 1) % a.length],
            d = b[(y + 1) % b.length];
          if (
            cross(a[x], c, b[y]) * cross(a[x], c, d) < 0 &&
            cross(b[y], d, a[x]) * cross(b[y], d, c) < 0
          )
            return true;
        }
    }
  return false;
}

function strictlyInteriorEdge(
  plane: TopologyPlane,
  edge: TopologyEdge
): boolean {
  const [a, b] = endpoints(plane, edge);
  return plane.surfaces.some((surface) => {
    const loops = [surface.outer_loop, ...surface.hole_loops].map((loop) =>
      loop.map((ref) => {
        const boundary = plane.edges.find((e) => e.edge_ref === ref.edge_ref)!;
        return endpoints(plane, boundary)[ref.direction === "forward" ? 0 : 1];
      })
    );
    if (
      !inside(a, loops[0]) ||
      !inside(b, loops[0]) ||
      loops.slice(1).some((h) => inside(a, h) || inside(b, h))
    )
      return false;
    return loops.every((loop) =>
      loop.every((c, i) => !intersects(a, b, c, loop[(i + 1) % loop.length]))
    );
  });
}

export function estimateDeckRailing(input: {
  source: ParsedDeckGeometrySource;
  topology: DeckDesignGeometryTopologyV2;
  witnesses: DeckGeometryCalculation["local_reference_witnesses"];
}): {
  railing: DeckRailingEstimate;
  placements: readonly DeckStairPlacement[];
} {
  const { source, topology } = input;
  const local = (kind: string, id: string) =>
    input.witnesses.find((w) => w.kind === kind && w.source_id === id)!
      .local_ref;
  const sourcePlaneByRef = new Map(
    source.planes.map((p) => [local("plane", p.sourceId), p])
  );
  const parsedEdge = (plane: TopologyPlane, edge: TopologyEdge) => {
    const p = sourcePlaneByRef.get(plane.plane_ref)!;
    return p.edges.find(
      (e) => local("edge", `${p.sourceId}:${e.id}`) === edge.edge_ref
    )!;
  };
  const edgeRows: DeckRailingEstimate["edges"] = [];
  const stairs: DeckRailingEstimate["stairs"] = [];
  const placements: DeckStairPlacement[] = [];
  const configured: string[] = [];

  const addStair = (
    ref: string,
    stair: ParsedStair,
    stringer: {
      state: string;
      rise_inches?: number;
      tread_count?: number;
      run_per_tread_inches?: number;
    },
    conflict = false
  ) => {
    const length =
      stringer.state === "authoritative"
        ? Math.hypot(
            stringer.rise_inches!,
            stringer.tread_count! * stringer.run_per_tread_inches!
          )
        : null;
    const available = length !== null && Number.isFinite(length) && !conflict;
    stairs.push({
      stair_ref: ref,
      state: available ? "estimated" : "unavailable",
      rail_assignment: stair.railConfigured ? "configured" : "not_configured",
      assumed_sides: 2,
      one_side_linear_feet: available ? rounded(length / 12) : null,
      two_sides_linear_feet: available ? rounded((2 * length) / 12) : null,
      issues: [
        ...(!available
          ? [
              conflict
                ? ("stair_layout_conflict" as const)
                : ("stair_geometry_unavailable" as const),
            ]
          : []),
        ...(stair.defaultsUsed ? ["stair_defaults_used" as const] : []),
      ],
    });
  };
  const placement = (ref: string, stair: ParsedStair): DeckStairPlacement => ({
    stair_ref: ref,
    alignment: stair.alignment,
    offset_inches: stair.offset,
    flip_direction: stair.flipDirection,
    connection_position: null,
    lower_destination: null,
  });
  for (const plane of topology.planes)
    for (const edge of plane.edges) {
      const parsed = parsedEdge(plane, edge);
      if (edge.stair.state === "configured" && parsed.stair) {
        const conflict = topology.connections.some(
          (c) => c.kind === "level_stair" && c.upper_edge_ref === edge.edge_ref
        );
        addStair(edge.edge_ref, parsed.stair, edge.stair.stringer, conflict);
        placements.push(placement(edge.edge_ref, parsed.stair));
      }
    }
  for (const connection of topology.connections) {
    if (connection.kind === "surface_transition") {
      if (connection.transition_kind === "steps")
        stairs.push({
          stair_ref: connection.connection_ref,
          state: "unavailable",
          rail_assignment: "not_configured",
          assumed_sides: 2,
          one_side_linear_feet: null,
          two_sides_linear_feet: null,
          issues: ["surface_transition_geometry_unavailable"],
        });
      continue;
    }
    const parsed = source.level_connections.find(
      (c) => local("connection", c.id) === connection.connection_ref
    )!;
    const upperPlane = topology.planes.find(
      (p) => p.plane_ref === connection.upper_plane_ref
    )!;
    const upper = upperPlane.edges.find(
      (e) => e.edge_ref === connection.upper_edge_ref
    )!;
    const duplicate =
      topology.connections.filter(
        (c) =>
          c.kind === "level_stair" &&
          c.upper_edge_ref === connection.upper_edge_ref
      ).length > 1;
    addStair(
      connection.connection_ref,
      parsed.stair,
      connection.stair.stringer,
      duplicate || upper.stair.state === "configured"
    );
    const lower = source.planes.find(
      (p) => p.sourceId === parsed.lowerLevelId
    )!;
    const lowerEdge =
      parsed.lowerEdgeId === null
        ? null
        : lower.edges.find((e) => e.id === parsed.lowerEdgeId)!;
    const vertices = lowerEdge
      ? lower.vertices.filter(
          (v) =>
            v.id === lowerEdge.startVertexId || v.id === lowerEdge.endVertexId
        )
      : lower.vertices;
    // Native uses the arithmetic vertex mean, not an invented matching edge
    // or a polygon centroid; the footprint is an unordered vertex list.
    const mean = vertices.length
      ? {
          x: vertices.reduce((s, v) => s + v.position.x / vertices.length, 0),
          y: vertices.reduce((s, v) => s + v.position.y / vertices.length, 0),
        }
      : null;
    placements.push({
      ...placement(connection.connection_ref, parsed.stair),
      connection_position: parsed.position,
      lower_destination: mean
        ? {
            basis: lowerEdge
              ? "lower_edge_midpoint"
              : "lower_plane_vertex_mean",
            position: mean,
            vertex_refs: vertices.map((v) =>
              local("vertex", `${lower.sourceId}:${v.id}`)
            ),
          }
        : { basis: "unavailable", position: null },
    });
  }

  for (const plane of topology.planes) {
    const memberships = new Map<
      string,
      {
        kind: "outer_boundary" | "hole_boundary";
        direction: string;
        surface: string;
      }[]
    >();
    for (const surface of plane.surfaces)
      for (const [index, loop] of [
        surface.outer_loop,
        ...surface.hole_loops,
      ].entries())
        for (const boundary of loop) {
          const rows = memberships.get(boundary.edge_ref) ?? [];
          rows.push({
            kind: index === 0 ? "outer_boundary" : "hole_boundary",
            direction: boundary.direction,
            surface: surface.surface_ref,
          });
          memberships.set(boundary.edge_ref, rows);
        }
    const invalidBoundary = selfCrossing(plane);
    for (const edge of plane.edges) {
      const parsed = parsedEdge(plane, edge);
      if (
        parsed.railingFamily !== null &&
        parsed.railingFamily !== "parapet_wall" &&
        parsed.edgeType === "deck_edge"
      )
        configured.push(edge.edge_ref);
      const member = memberships.get(edge.edge_ref) ?? [];
      const issues: DeckRailingEstimateIssue[] = [];
      const deductions: DeckRailingEstimate["edges"][number]["deductions"] = [];
      let reason: DeckRailingEstimate["edges"][number]["reason"] =
        member[0]?.kind ?? "boundary_unresolved";
      let excluded = false;
      if (parsed.boundaryRole === "house" || parsed.edgeType === "house_edge") {
        reason = "house";
        excluded = true;
      } else if (
        parsed.boundaryRole === "wall" ||
        parsed.railingFamily === "parapet_wall"
      ) {
        reason = "wall";
        excluded = true;
      } else if (
        member.length === 2 &&
        member[0].direction !== member[1].direction
      ) {
        // A surface transition may be a height change. Without public height
        // evidence it is not safe to call that boundary an internal flat join.
        const p = sourcePlaneByRef.get(plane.plane_ref)!;
        const heights = member.map(
          (m) =>
            p.surfaces.find((s) =>
              input.witnesses.some(
                (w) =>
                  w.kind === "surface" &&
                  w.source_id === `${p.sourceId}:${s.id}` &&
                  w.local_ref === m.surface
              )
            )?.elevationFeet ?? 0
        );
        if (heights[0] === heights[1]) {
          reason = "shared_boundary";
          excluded = true;
        } else issues.push("shared_boundary_ambiguous");
      } else if (member.length > 1) issues.push("shared_boundary_ambiguous");
      else if (!member.length && strictlyInteriorEdge(plane, edge)) {
        reason = "not_perimeter";
        excluded = true;
      } else if (!member.length || invalidBoundary)
        issues.push("boundary_unresolved");
      if (invalidBoundary && reason !== "house" && reason !== "wall") {
        excluded = false;
        issues.push("boundary_unresolved");
      }
      if (!excluded) {
        if (!positive(parsed.dimension)) issues.push("dimension_missing");
        if (parsed.dimensionStale) issues.push("dimension_stale");
        const [a, b] = endpoints(plane, edge);
        for (const otherPlane of topology.planes)
          for (const other of otherPlane.edges) {
            if (other.edge_ref === edge.edge_ref) continue;
            const [c, d] = endpoints(otherPlane, other);
            if (collinearOverlap(a, b, c, d)) {
              if (otherPlane.plane_ref !== plane.plane_ref)
                issues.push("overlapping_level_boundaries");
              else issues.push("shared_boundary_ambiguous");
            }
          }
        if (edge.stair.state === "configured")
          deductions.push({
            kind: "edge_stair",
            inches:
              edge.stair.width.state === "recorded"
                ? edge.stair.width.inches
                : null,
          });
        for (const connection of topology.connections) {
          if (connection.kind === "level_stair") {
            if (
              connection.upper_edge_ref === edge.edge_ref ||
              connection.lower_edge_ref === edge.edge_ref
            )
              deductions.push({
                kind: "level_stair",
                inches:
                  connection.stair.width.state === "recorded"
                    ? connection.stair.width.inches
                    : null,
              });
            if (
              connection.lower_plane_ref === plane.plane_ref &&
              connection.lower_edge_ref === null
            )
              issues.push("landing_opening_unlocated");
          } else if (connection.edge_ref === edge.edge_ref)
            deductions.push({
              kind: "surface_transition",
              inches: connection.width_inches,
            });
        }
        if (deductions.length > 1) issues.push("multiple_stair_openings");
        if (deductions.some((d) => d.inches === null))
          issues.push("stair_width_missing");
        if (parsed.gateCount) {
          deductions.push({ kind: "gate", inches: null });
          issues.push("gate_width_unrecorded");
        }
        const deducted = deductions.reduce(
          (sum, d) => sum + (d.inches ?? 0),
          0
        );
        if (positive(parsed.dimension) && deducted > parsed.dimension)
          issues.push("opening_exceeds_edge");
      }
      const uniqueIssues = [...new Set(issues)];
      const disposition = excluded
        ? "excluded"
        : uniqueIssues.length
          ? "unresolved"
          : "included";
      edgeRows.push({
        edge_ref: edge.edge_ref,
        disposition,
        reason,
        gross_inches: positive(parsed.dimension) ? parsed.dimension : null,
        deductions,
        net_linear_feet:
          disposition === "included"
            ? rounded(
                (parsed.dimension! -
                  deductions.reduce((s, d) => s + d.inches!, 0)) /
                  12
              )
            : null,
        issues: uniqueIssues,
      });
    }
  }
  const included = edgeRows.filter((e) => e.disposition === "included");
  const unresolved =
    edgeRows.length === 0 ||
    edgeRows.some((e) => e.disposition === "unresolved");
  const known = rounded(
    included.reduce(
      (s, e) =>
        s +
        (e.gross_inches! - e.deductions.reduce((n, d) => n + d.inches!, 0)) /
          12,
      0
    )
  );
  return {
    railing: DeckRailingEstimateSchema.parse({
      basis: "measured_perimeter_scenario",
      unit: "linear_feet",
      order_ready: false,
      edges: edgeRows,
      flat: {
        state: unresolved
          ? included.length
            ? "partial"
            : "unavailable"
          : "estimated",
        known_linear_feet: known,
        total_linear_feet: unresolved ? null : known,
      },
      configured_flat_edge_refs: configured,
      stairs,
      assumptions: [
        "open_boundaries_are_candidates_not_confirmed_guard_requirements",
        "saved_dimensions_are_inches_coordinates_are_drawing_units",
        "sloped_stair_rails_assume_two_sides_without_extensions",
        "configured_measurements_are_not_perimeter_coverage",
      ],
      missing_facts: [
        "site_boundary_roles_and_guard_requirement",
        "gate_and_landing_opening_dimensions_and_locations",
        "stair_rail_sides_handrails_returns_and_extensions",
        "rail_system_waste_stock_pricing_and_order_quantities",
      ],
    }),
    placements: placements.map((p) => DeckStairPlacementSchema.parse(p)),
  };
}
