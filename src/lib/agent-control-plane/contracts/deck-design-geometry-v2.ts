import { z } from "zod-v4";
import {
  DECK_GEOMETRY_MAX_CONNECTIONS,
  DECK_GEOMETRY_MAX_EDGES,
  DeckDesignGeometryResultSchema,
  DECK_GEOMETRY_LOCAL_REF_REVISION,
  assertNoDeckGeometryForbiddenFields,
  DeckDesignGeometryTopologySchema,
  refineDeckGeometryTopology,
} from "./deck-design-geometry";

export const DECK_GEOMETRY_CALCULATOR_V2_REVISION =
  "deck-geometry-calculator:2026-09-10.v2" as const;
export const DECK_GEOMETRY_RESULT_V2_REVISION =
  "deck-geometry-result:2026-09-10.v2" as const;

const LegacyConnectionSchema =
  DeckDesignGeometryTopologySchema.shape.connections.element;
const LevelStairV2Schema = z
  .object({
    ...LegacyConnectionSchema.options[0].shape,
    // Null means the lower plane's footprint is the destination. It never
    // means that the stair was removed or a matching edge was fabricated.
    lower_edge_ref:
      LegacyConnectionSchema.options[0].shape.lower_edge_ref.nullable(),
  })
  .strict()
  .refine(
    (c) => c.upper_plane_ref !== c.lower_plane_ref,
    "DECK_GEOMETRY_CONNECTION_PLANE_CONFLICT"
  );
export const DeckDesignGeometryTopologyV2Schema = z
  .object({
    ...DeckDesignGeometryTopologySchema.shape,
    connections: z
      .array(
        z.discriminatedUnion("kind", [
          LevelStairV2Schema,
          LegacyConnectionSchema.options[1],
        ])
      )
      .max(DECK_GEOMETRY_MAX_CONNECTIONS),
  })
  .strict()
  .superRefine(refineDeckGeometryTopology);
export type DeckDesignGeometryTopologyV2 = z.infer<
  typeof DeckDesignGeometryTopologyV2Schema
>;

const EdgeRef = z.string().regex(/^plane:[1-9][0-9]*:edge:[1-9][0-9]*$/);
const StairRef = z
  .string()
  .regex(/^(?:plane:[1-9][0-9]*:edge:[1-9][0-9]*|connection:[1-9][0-9]*)$/);
const Amount = z.number().finite().nonnegative();
const Rounded = Amount.refine(
  (v) => Math.abs(v - Number(v.toFixed(2))) <= Number.EPSILON * Math.max(1, v)
);
const Point = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
export const DeckStairPlacementSchema = z
  .object({
    stair_ref: StairRef,
    alignment: z.enum(["left", "center", "right"]),
    offset_inches: z.number().finite(),
    flip_direction: z.boolean(),
    connection_position: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("full") }).strict(),
        z
          .object({
            kind: z.literal("partial"),
            offset_inches: Amount,
            width_inches: z.number().finite().positive(),
          })
          .strict(),
      ])
      .nullable(),
    lower_destination: z
      .discriminatedUnion("basis", [
        z
          .object({
            basis: z.enum(["lower_edge_midpoint", "lower_plane_vertex_mean"]),
            position: Point,
            vertex_refs: z
              .array(z.string().regex(/^plane:[1-9][0-9]*:vertex:[1-9][0-9]*$/))
              .min(1)
              .max(160),
          })
          .strict(),
        z
          .object({ basis: z.literal("unavailable"), position: z.null() })
          .strict(),
      ])
      .nullable(),
  })
  .strict();
export type DeckStairPlacement = z.infer<typeof DeckStairPlacementSchema>;

export const DeckRailingEstimateIssueSchema = z.enum([
  "dimension_missing",
  "dimension_stale",
  "boundary_unresolved",
  "shared_boundary_ambiguous",
  "overlapping_level_boundaries",
  "landing_opening_unlocated",
  "gate_width_unrecorded",
  "stair_width_missing",
  "opening_exceeds_edge",
  "multiple_stair_openings",
  "stair_geometry_unavailable",
  "surface_transition_geometry_unavailable",
  "stair_layout_conflict",
  "stair_defaults_used",
]);
export type DeckRailingEstimateIssue = z.infer<
  typeof DeckRailingEstimateIssueSchema
>;
export const DeckRailingEstimateSchema = z
  .object({
    basis: z.literal("measured_perimeter_scenario"),
    unit: z.literal("linear_feet"),
    order_ready: z.literal(false),
    edges: z
      .array(
        z
          .object({
            edge_ref: EdgeRef,
            disposition: z.enum(["included", "excluded", "unresolved"]),
            reason: z.enum([
              "outer_boundary",
              "hole_boundary",
              "house",
              "wall",
              "shared_boundary",
              "not_perimeter",
              "boundary_unresolved",
            ]),
            gross_inches: Amount.nullable(),
            deductions: z
              .array(
                z
                  .object({
                    kind: z.enum([
                      "edge_stair",
                      "level_stair",
                      "surface_transition",
                      "gate",
                    ]),
                    inches: Amount.nullable(),
                  })
                  .strict()
              )
              .max(DECK_GEOMETRY_MAX_CONNECTIONS + 2),
            net_linear_feet: Rounded.nullable(),
            issues: z.array(DeckRailingEstimateIssueSchema).max(16),
          })
          .strict()
      )
      .max(DECK_GEOMETRY_MAX_EDGES),
    flat: z
      .object({
        state: z.enum(["estimated", "partial", "unavailable"]),
        known_linear_feet: Rounded,
        total_linear_feet: Rounded.nullable(),
      })
      .strict(),
    configured_flat_edge_refs: z.array(EdgeRef).max(DECK_GEOMETRY_MAX_EDGES),
    stairs: z
      .array(
        z
          .object({
            stair_ref: StairRef,
            state: z.enum(["estimated", "unavailable"]),
            rail_assignment: z.enum(["configured", "not_configured"]),
            assumed_sides: z.literal(2),
            one_side_linear_feet: Rounded.nullable(),
            two_sides_linear_feet: Rounded.nullable(),
            issues: z.array(DeckRailingEstimateIssueSchema).max(16),
          })
          .strict()
      )
      .max(DECK_GEOMETRY_MAX_EDGES + DECK_GEOMETRY_MAX_CONNECTIONS),
    assumptions: z.tuple([
      z.literal(
        "open_boundaries_are_candidates_not_confirmed_guard_requirements"
      ),
      z.literal("saved_dimensions_are_inches_coordinates_are_drawing_units"),
      z.literal("sloped_stair_rails_assume_two_sides_without_extensions"),
      z.literal("configured_measurements_are_not_perimeter_coverage"),
    ]),
    missing_facts: z.tuple([
      z.literal("site_boundary_roles_and_guard_requirement"),
      z.literal("gate_and_landing_opening_dimensions_and_locations"),
      z.literal("stair_rail_sides_handrails_returns_and_extensions"),
      z.literal("rail_system_waste_stock_pricing_and_order_quantities"),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const unique = (refs: string[]) => new Set(refs).size === refs.length;
    const unresolved =
      value.edges.length === 0 ||
      value.edges.some((e) => e.disposition === "unresolved");
    const included = value.edges.filter((e) => e.disposition === "included");
    const expectedState = unresolved
      ? included.length
        ? "partial"
        : "unavailable"
      : "estimated";
    if (
      !unique(value.edges.map((e) => e.edge_ref)) ||
      !unique(value.stairs.map((e) => e.stair_ref)) ||
      !unique(value.configured_flat_edge_refs) ||
      value.flat.state !== expectedState ||
      (value.flat.total_linear_feet === null) !== unresolved ||
      (!unresolved &&
        value.flat.total_linear_feet !== value.flat.known_linear_feet)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "DECK_ESTIMATE_COVERAGE_INVALID",
      });
    }
    for (const edge of value.edges) {
      if (
        (edge.disposition === "included") !== (edge.net_linear_feet !== null) ||
        (edge.disposition === "included" &&
          (edge.gross_inches === null ||
            edge.issues.length ||
            edge.deductions.some((d) => d.inches === null)))
      ) {
        ctx.addIssue({
          code: "custom",
          message: "DECK_ESTIMATE_EDGE_STATE_INVALID",
        });
      }
      if (edge.disposition === "included" && edge.gross_inches !== null) {
        const net =
          edge.gross_inches -
          edge.deductions.reduce((s, d) => s + (d.inches ?? 0), 0);
        if (net < 0 || Number((net / 12).toFixed(2)) !== edge.net_linear_feet)
          ctx.addIssue({
            code: "custom",
            message: "DECK_ESTIMATE_EDGE_QUANTITY_INVALID",
          });
      }
    }
    const known = included.reduce(
      (s, e) =>
        s +
        (e.gross_inches! - e.deductions.reduce((n, d) => n + d.inches!, 0)) /
          12,
      0
    );
    if (Number(known.toFixed(2)) !== value.flat.known_linear_feet)
      ctx.addIssue({ code: "custom", message: "DECK_ESTIMATE_TOTAL_INVALID" });
    for (const stair of value.stairs) {
      if (
        (stair.state === "estimated") !==
          (stair.one_side_linear_feet !== null &&
            stair.two_sides_linear_feet !== null) ||
        (stair.state === "unavailable" &&
          (stair.one_side_linear_feet !== null ||
            stair.two_sides_linear_feet !== null)) ||
        (stair.one_side_linear_feet !== null &&
          stair.two_sides_linear_feet !== null &&
          Math.abs(
            stair.two_sides_linear_feet - 2 * stair.one_side_linear_feet
          ) > 0.011)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "DECK_ESTIMATE_STAIR_STATE_INVALID",
        });
      }
    }
  });
export type DeckRailingEstimate = z.infer<typeof DeckRailingEstimateSchema>;

export type DeckGeometryResultRevision = "v1" | "v2";
export const DeckDesignGeometryResultV2Schema = z
  .object({
    ...DeckDesignGeometryResultSchema.shape,
    result_revision: z.literal(DECK_GEOMETRY_RESULT_V2_REVISION),
    design: z
      .object({
        ...DeckDesignGeometryResultSchema.shape.design.shape,
        calculator_revision: z.literal(DECK_GEOMETRY_CALCULATOR_V2_REVISION),
        local_ref_revision: z.literal(DECK_GEOMETRY_LOCAL_REF_REVISION),
      })
      .strict(),
    topology: DeckDesignGeometryTopologyV2Schema,
    measurement_basis: z
      .object({
        flat_railing_linear_feet: z.literal("configured_edges_only"),
        parapet_linear_feet: z.literal("configured_wall_edges_only"),
        stair_railing_linear_feet: z.literal("native_two_sided_stair_geometry"),
        combined_guard_linear_feet: z.literal(
          "configured_flat_plus_native_stairs_plus_parapet"
        ),
      })
      .strict(),
    railing_estimate: DeckRailingEstimateSchema,
    stair_placements: z
      .array(DeckStairPlacementSchema)
      .max(DECK_GEOMETRY_MAX_EDGES + DECK_GEOMETRY_MAX_CONNECTIONS),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (
      result.evidence[0]?.occurred_at !== result.proof.read_at ||
      result.evidence[0]?.source_domain !== "deck_designs" ||
      result.evidence[0]?.source_type !== "deck_design_geometry" ||
      result.proof.source_revisions.map((r) => r.domain).join("|") !==
        "artifacts|deck_designs|legacy_operational|site_visits"
    )
      ctx.addIssue({
        code: "custom",
        message: "DECK_GEOMETRY_PROOF_NOT_COUPLED",
      });
    const edges = result.topology.planes.flatMap((p) => p.edges);
    const edgeRefs = edges.map((e) => e.edge_ref);
    const expectedStairs = [
      ...edges
        .filter((e) => e.stair.state === "configured")
        .map((e) => e.edge_ref),
      ...result.topology.connections
        .filter(
          (c) => c.kind === "level_stair" || c.transition_kind === "steps"
        )
        .map((c) => c.connection_ref),
    ];
    const placementRefs = result.stair_placements.map((p) => p.stair_ref);
    const expectedPlacements = [
      ...edges
        .filter((e) => e.stair.state === "configured")
        .map((e) => e.edge_ref),
      ...result.topology.connections
        .filter((c) => c.kind === "level_stair")
        .map((c) => c.connection_ref),
    ];
    const same = (a: string[], b: string[]) =>
      a.length === b.length &&
      new Set(a).size === a.length &&
      a.every((ref) => b.includes(ref));
    const configured = edges
      .filter(
        (e) =>
          e.edge_type === "deck_edge" &&
          e.railing.state === "configured" &&
          e.railing.family.value !== "parapet_wall"
      )
      .map((e) => e.edge_ref);
    if (
      !same(
        edgeRefs,
        result.railing_estimate.edges.map((e) => e.edge_ref)
      ) ||
      !same(
        expectedStairs,
        result.railing_estimate.stairs.map((s) => s.stair_ref)
      ) ||
      !same(expectedPlacements, placementRefs) ||
      !same(configured, result.railing_estimate.configured_flat_edge_refs)
    )
      ctx.addIssue({
        code: "custom",
        message: "DECK_ESTIMATE_TOPOLOGY_COVERAGE_INVALID",
      });
    for (const row of result.railing_estimate.edges) {
      const edge = edges.find((e) => e.edge_ref === row.edge_ref);
      if (!edge) continue;
      const gross =
        edge.dimension.state === "recorded" ? edge.dimension.inches : null;
      if (
        gross !== row.gross_inches ||
        (edge.dimension.state === "recorded" &&
          edge.dimension.stale &&
          row.disposition === "included")
      )
        ctx.addIssue({
          code: "custom",
          message: "DECK_ESTIMATE_DIMENSION_NOT_COUPLED",
        });
    }
    for (const placement of result.stair_placements) {
      const connection = result.topology.connections.find(
        (c) => c.connection_ref === placement.stair_ref
      );
      if (!connection) {
        if (
          placement.lower_destination !== null ||
          placement.connection_position !== null
        )
          ctx.addIssue({
            code: "custom",
            message: "DECK_STAIR_PLACEMENT_INVALID",
          });
      } else if (connection.kind === "level_stair") {
        const expectedBasis =
          connection.lower_edge_ref === null
            ? "lower_plane_vertex_mean"
            : "lower_edge_midpoint";
        const lower = result.topology.planes.find(
          (p) => p.plane_ref === connection.lower_plane_ref
        )!;
        const refs =
          placement.lower_destination &&
          placement.lower_destination.basis !== "unavailable"
            ? placement.lower_destination.vertex_refs
            : [];
        const vertices = lower.vertices.filter((v) =>
          refs.includes(v.vertex_ref)
        );
        // Public edge endpoints can be welded. Native landing references retain
        // the original vertices; the source-bound proof attests their edge link.
        if (
          new Set(refs).size !== refs.length ||
          refs.length !== vertices.length ||
          (connection.lower_edge_ref === null
            ? refs.length !== lower.vertices.length
            : refs.length !== 2)
        ) {
          ctx.addIssue({
            code: "custom",
            message: "DECK_STAIR_DESTINATION_INVALID",
          });
        }
        if (
          placement.connection_position === null ||
          placement.lower_destination === null ||
          (vertices.length > 0
            ? placement.lower_destination.basis !== expectedBasis
            : placement.lower_destination.basis !== "unavailable")
        )
          ctx.addIssue({
            code: "custom",
            message: "DECK_STAIR_DESTINATION_INVALID",
          });
        if (vertices.length && placement.lower_destination?.position) {
          const mean = {
            x: vertices.reduce((s, v) => s + v.position.x / vertices.length, 0),
            y: vertices.reduce((s, v) => s + v.position.y / vertices.length, 0),
          };
          if (
            Math.abs(placement.lower_destination.position.x - mean.x) > 1e-7 ||
            Math.abs(placement.lower_destination.position.y - mean.y) > 1e-7
          )
            ctx.addIssue({
              code: "custom",
              message: "DECK_STAIR_DESTINATION_INVALID",
            });
        }
      }
    }
    try {
      assertNoDeckGeometryForbiddenFields(result);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "DECK_GEOMETRY_FORBIDDEN_FIELD",
      });
    }
  });
export type DeckDesignGeometryResultV2 = z.infer<
  typeof DeckDesignGeometryResultV2Schema
>;
