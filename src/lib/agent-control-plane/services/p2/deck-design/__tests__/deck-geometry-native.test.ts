import { nativeDrawing } from "./deck-geometry-native-fixtures";
import { describe, expect, it } from "vitest";
import {
  calculateDeckGeometryFromSourceJson,
  parseDeckGeometrySource,
} from "../deck-geometry-calculator";

for (const producer of ["ops-ios", "ops-decks-ios"]) {
  describe(`${producer} native optional stair destination`, () => {
    for (const mode of ["absent", "null"] as const) {
      it(`preserves the real connection and measured stairs with ${mode} lower edge`, () => {
        const drawing = nativeDrawing(producer);
        if (mode === "null") drawing.levelConnections[0].lowerEdgeId = null;
        const before = JSON.stringify(drawing);
        const parsed = parseDeckGeometrySource(before);
        expect(parsed.level_connections[0]?.lowerEdgeId).toBeNull();
        const result = calculateDeckGeometryFromSourceJson(before);
        expect(result.topology.connections).toHaveLength(1);
        expect(result.topology.connections[0]).toMatchObject({
          kind: "level_stair",
          lower_edge_ref: null,
          stair: {
            width: { state: "recorded", inches: 48 },
            stringer: {
              state: "authoritative",
              rise_inches: 48,
              tread_count: 7,
              run_per_tread_inches: 10,
            },
          },
        });
        expect(result.full_precision.stair_railing_inches).toBeCloseTo(
          2 * Math.hypot(48, 70),
          10
        );
        expect(result.measurements.flat_railing_linear_feet).toEqual({
          state: "authoritative",
          value: 0,
          warning: null,
        });
        expect(JSON.stringify(drawing)).toBe(before);
      });
    }
    for (const invalid of ["missing-edge", "upper-e1", "", 42, {}]) {
      it(`rejects an invalid named lower edge ${JSON.stringify(invalid)}`, () => {
        const drawing = nativeDrawing(producer);
        drawing.levelConnections[0].lowerEdgeId = invalid;
        expect(() => parseDeckGeometrySource(JSON.stringify(drawing))).toThrow(
          "DECK_GEOMETRY_REFERENCE_INVALID"
        );
      });
    }
  });
}
