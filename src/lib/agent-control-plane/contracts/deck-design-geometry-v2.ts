import { z } from "zod-v4";
import { DeckDesignGeometryTopologySchema, refineDeckGeometryTopology } from "./deck-design-geometry";

export const DECK_GEOMETRY_CALCULATOR_V2_REVISION = "deck-geometry-calculator:2026-09-10.v2" as const;
export const DECK_GEOMETRY_RESULT_V2_REVISION = "deck-geometry-result:2026-09-10.v2" as const;

const LegacyConnectionSchema = DeckDesignGeometryTopologySchema.shape.connections.element;
const LevelStairV2Schema = LegacyConnectionSchema.options[0].safeExtend({
  // Null means the lower plane's footprint is the destination. It never
  // means that the stair was removed or a matching edge was fabricated.
  lower_edge_ref: LegacyConnectionSchema.options[0].shape.lower_edge_ref.nullable(),
});
export const DeckDesignGeometryTopologyV2Schema = z.object({
  ...DeckDesignGeometryTopologySchema.shape,
  connections: z.array(z.discriminatedUnion("kind", [LevelStairV2Schema, LegacyConnectionSchema.options[1]])).max(32),
}).strict().superRefine(refineDeckGeometryTopology);
export type DeckDesignGeometryTopologyV2 = z.infer<typeof DeckDesignGeometryTopologyV2Schema>;
