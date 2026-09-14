import { describe, expect, it } from "vitest";
import {
  DeckDesignGeometryResultV2Schema,
  type DeckDesignGeometryResultV2,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry-v2";
import { DeckDesignGeometryResultSchema } from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import { getDeckDesignGeometry } from "../deck-geometry-reads";
import { createSupabaseDeckGeometryReadRepository } from "../deck-geometry-repository";
import { deckGeometryDrawingContentHash } from "../deck-geometry-proof";
import {
  deckGeometryAuthorization,
  deckGeometryRawSnapshot,
} from "./deck-geometry-service-fixtures";
import { nativeDrawing } from "./deck-geometry-native-fixtures";

async function fixture(drawing = nativeDrawing(), state?: string) {
  const authorization = await deckGeometryAuthorization();
  const drawing_source = JSON.stringify(drawing);
  const repository = createSupabaseDeckGeometryReadRepository({
    rpc: async () => ({
      data: state
        ? null
        : deckGeometryRawSnapshot(authorization, {
            drawing_source,
            drawing_content_hash:
              deckGeometryDrawingContentHash(drawing_source),
          }),
      error: state
        ? {
            not_found: {
              code: "P0002",
              message: "agent_deck_geometry_not_found_or_not_visible",
            },
            stale: { code: "40001", message: "agent_deck_geometry_read_stale" },
            source_bound: {
              code: "54000",
              message: "agent_deck_geometry_source_bound",
            },
          }[state]
        : null,
    }),
  });
  return { authorization, repository };
}
describe("authorized versioned deck read", () => {
  it("returns v2 through the real authorized source boundary with intact native stairs", async () => {
    const result = await getDeckDesignGeometry({
      ...(await fixture()),
      resultRevision: "v2",
    });
    expect(DeckDesignGeometryResultV2Schema.parse(result)).toEqual(result);
    expect(result.result_revision).toBe("deck-geometry-result:2026-09-10.v2");
    expect(result.topology.connections[0]).toMatchObject({
      lower_edge_ref: null,
    });
    expect(result.railing_estimate.configured_flat_edge_refs).toEqual([]);
    expect(Object.isFrozen(result.railing_estimate)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /upper-e|lower-v|drawing_data|railingConfig|assignedItems/
    );
  });
  it("keeps v1 representable output strict and changes both proof and fence for v2", async () => {
    const drawing = nativeDrawing();
    drawing.levelConnections[0].lowerEdgeId = "lower-e1";
    const input = await fixture(drawing);
    const v1 = await getDeckDesignGeometry(input);
    const v2 = await getDeckDesignGeometry({ ...input, resultRevision: "v2" });
    expect(DeckDesignGeometryResultSchema.parse(v1)).toEqual(v1);
    expect(v1).not.toHaveProperty("railing_estimate");
    expect(v1.measurements).toEqual(v2.measurements);
    expect(v1.proof.proof_ref).not.toBe(v2.proof.proof_ref);
    expect(v1.geometry_source_fence).not.toBe(v2.geometry_source_fence);
    expect(v1.evidence).toEqual(v2.evidence);
    expect(DeckDesignGeometryResultSchema.safeParse(v2).success).toBe(false);
  });
  it("reports a server-version limitation for a valid v1 request without blaming its reference", async () => {
    const input = await fixture();
    const error = await getDeckDesignGeometry(input).catch((e) => e);
    expect(error.code).toBe("DECK_GEOMETRY_RESULT_REVISION_UNSUPPORTED");
    expect(error.toAgentError()).toMatchObject({
      code: "INTERNAL",
      retryable: false,
      message: expect.stringContaining("connection version"),
    });
    expect(error.toAgentError()).not.toHaveProperty("details.field_issues");
  });
  it("reports malformed saved references as persistent source faults, never transient outages", async () => {
    const drawing = nativeDrawing();
    drawing.levelConnections[0].lowerEdgeId = "not-an-edge";
    const error = await getDeckDesignGeometry({
      ...(await fixture(drawing)),
      resultRevision: "v2",
    }).catch((e) => e);
    expect(error.code).toBe("INVALID_GEOMETRY");
    expect(error.toAgentError()).toMatchObject({
      code: "INTERNAL",
      retryable: false,
      message: expect.stringContaining("saved"),
    });
  });
  it("rejects forged authorization and unknown result revisions", async () => {
    const input = await fixture();
    await expect(
      getDeckDesignGeometry({
        ...input,
        authorization: { ...input.authorization },
        resultRevision: "v2",
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
    await expect(
      getDeckDesignGeometry({ ...input, resultRevision: "v99" as "v2" })
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
  it.each(["not_found", "stale", "source_bound"])(
    "retains source boundary %s in both projections",
    async (state) => {
      const input = await fixture(nativeDrawing(), state);
      for (const resultRevision of ["v1", "v2"] as const) {
        await expect(
          getDeckDesignGeometry({ ...input, resultRevision })
        ).rejects.toMatchObject({
          code: {
            not_found: "NOT_FOUND",
            stale: "STALE_CONTEXT",
            source_bound: "RESULT_TOO_LARGE",
          }[state],
        });
      }
    }
  );
});

describe("v2 result integrity", () => {
  it("preserves native landing endpoints even when the topology welds a nearby vertex", async () => {
    const drawing = nativeDrawing();
    drawing.levelConnections[0].lowerEdgeId = "lower-e1";
    drawing.levels[1].vertices.push({ id: "lower-v0", position: [0.01, 260] });
    const result = await getDeckDesignGeometry({
      ...(await fixture(drawing)),
      resultRevision: "v2",
    });
    expect(result.stair_placements[0].lower_destination).toMatchObject({
      basis: "lower_edge_midpoint",
      position: { x: 120, y: 260 },
    });
    expect(DeckDesignGeometryResultV2Schema.parse(result)).toEqual(result);
  });
  it.each([
    (r: DeckDesignGeometryResultV2) => {
      r.railing_estimate.edges.pop();
    },
    (r: DeckDesignGeometryResultV2) => {
      r.railing_estimate.flat.known_linear_feet += 1;
    },
    (r: DeckDesignGeometryResultV2) => {
      r.railing_estimate.configured_flat_edge_refs.push("plane:1:edge:1");
    },
    (r: DeckDesignGeometryResultV2) => {
      const connection = r.topology.connections[0];
      if (connection.kind === "level_stair")
        connection.lower_edge_ref = "plane:2:edge:1";
    },
    (r: DeckDesignGeometryResultV2) => {
      const destination = r.stair_placements[0].lower_destination;
      if (destination?.basis !== "unavailable" && destination)
        destination.position.x += 1;
    },
    (r: DeckDesignGeometryResultV2) => {
      Object.assign(r.design, {
        calculator_revision: "deck-geometry-calculator:2026-08-22.v1",
      });
    },
    (r: DeckDesignGeometryResultV2) => {
      r.proof.read_at = "2026-09-09T00:00:00.000Z";
    },
    (r: DeckDesignGeometryResultV2) => {
      r.railing_estimate.stairs[0].one_side_linear_feet = null;
    },
  ])("rejects inconsistent result mutation %#", async (mutate) => {
    const result = structuredClone(
      await getDeckDesignGeometry({
        ...(await fixture()),
        resultRevision: "v2",
      })
    );
    mutate(result);
    expect(DeckDesignGeometryResultV2Schema.safeParse(result).success).toBe(
      false
    );
  });
});
