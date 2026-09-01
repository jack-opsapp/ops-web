import { describe, expect, it } from "vitest";

import {
  P2_MAX_SERIALIZED_CHARACTERS,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import {
  DeckDesignGeometryResultSchema,
  type DeckDesignGeometryResult,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import { measureP2SerializedCharacters } from "../../shared/result-budget";
import {
  DeckGeometryReadError,
  assertDeckGeometrySerializedCharacterBudget,
  getDeckDesignGeometry,
} from "../deck-geometry-reads";
import { createSupabaseDeckGeometryReadRepository } from "../deck-geometry-repository";
import { deckGeometryDrawingContentHash } from "../deck-geometry-proof";
import {
  DECK_GEOMETRY_DECK_REF,
  DECK_GEOMETRY_DRAWING_SOURCE,
  deckGeometryAuthorization,
  deckGeometryRawSnapshot,
} from "./deck-geometry-service-fixtures";

interface StubResponse {
  readonly data: unknown;
  readonly error: unknown;
}

class StubRpcClient {
  private readonly response: StubResponse;

  constructor(response: StubResponse) {
    this.response = response;
  }

  rpc() {
    return Promise.resolve(this.response);
  }
}

function generatedSerializerBoundaryCandidate(input: {
  readonly base: DeckDesignGeometryResult;
  readonly boundaryValues: readonly string[];
  readonly railingValues: readonly string[];
}) {
  const edgeCount = input.boundaryValues.length;
  if (edgeCount !== input.railingValues.length) {
    throw new TypeError("DECK_GEOMETRY_TEST_VECTOR_LENGTH_MISMATCH");
  }
  const planeRef = "plane:1" as const;
  const vertices = Array.from({ length: edgeCount }, (_, index) => ({
    vertex_ref: `${planeRef}:vertex:${index + 1}`,
    position: { x: index, y: index % 2 },
  }));
  const edges = Array.from({ length: edgeCount }, (_, index) => ({
    edge_ref: `${planeRef}:edge:${index + 1}`,
    start_vertex_ref: `${planeRef}:vertex:${index + 1}`,
    end_vertex_ref: `${planeRef}:vertex:${((index + 1) % edgeCount) + 1}`,
    edge_type: "deck_edge" as const,
    boundary_role: {
      value: input.boundaryValues[index]!,
      content_kind: "untrusted_business_data" as const,
    },
    dimension: { state: "not_recorded" as const },
    railing: {
      state: "configured" as const,
      family: {
        value: input.railingValues[index]!,
        content_kind: "untrusted_business_data" as const,
      },
    },
    stair: { state: "not_configured" as const },
  }));
  const directedBoundary = Array.from({ length: edgeCount }, (_, index) => ({
    edge_ref: `${planeRef}:edge:${index + 1}`,
    direction: "forward" as const,
  }));
  return {
    ...input.base,
    topology: {
      topology_units: 1 + edgeCount + edgeCount + 1 + edgeCount,
      planes: [
        {
          plane_ref: planeRef,
          level: { state: "base" as const },
          vertices,
          edges,
          surfaces: [
            {
              surface_ref: `${planeRef}:surface:1`,
              finish_family: null,
              outer_loop: directedBoundary,
              hole_loops: [],
            },
          ],
        },
      ],
      connections: [],
    },
  };
}

describe("P2 authoritative deck-geometry read", () => {
  it("returns renderable local geometry and measurements without raw source identity", async () => {
    const authorization = await deckGeometryAuthorization();
    const repository = createSupabaseDeckGeometryReadRepository(
      new StubRpcClient({
        data: deckGeometryRawSnapshot(authorization),
        error: null,
      })
    );

    const result = await getDeckDesignGeometry({ authorization, repository });

    expect(DeckDesignGeometryResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      deck_design_ref: DECK_GEOMETRY_DECK_REF,
      design: {
        title: {
          text: "Rear deck",
          content_kind: "untrusted_business_data",
        },
        drawing_schema_version: 9,
        calculator_revision: "deck-geometry-calculator:2026-08-22.v1",
        local_ref_revision: "deck-local-ref:2026-08-22.v1",
      },
      measurements: {
        area_square_feet: { state: "authoritative", value: 120 },
        flat_railing_linear_feet: { state: "authoritative", value: 6 },
        stair_railing_linear_feet: {
          state: "authoritative",
          value: 12.21,
        },
        parapet_linear_feet: { state: "authoritative", value: 10 },
        combined_guard_linear_feet: {
          state: "authoritative",
          value: 28.21,
        },
      },
      evidence: [
        expect.objectContaining({
          source_domain: "deck_designs",
          source_type: "deck_design_geometry",
        }),
      ],
      proof: {
        proof_ref: expect.stringMatching(/^ops_proof:v1:[0-9a-f]{64}$/),
      },
      geometry_source_fence: expect.stringMatching(
        /^ops_deck_geometry_fence:v1:[A-Za-z0-9_-]{43}$/
      ),
    });
    expect(result.topology.planes[0]?.edges[0]).toMatchObject({
      edge_ref: "plane:1:edge:1",
      stair: expect.objectContaining({ state: "configured" }),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /single-v1|single-e1|drawing_data|components|assigned_items|product_id|storage_path/
    );
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("maps malformed source geometry to one privacy-safe invalid state", async () => {
    const authorization = await deckGeometryAuthorization();
    const drawing = JSON.parse(DECK_GEOMETRY_DRAWING_SOURCE) as Record<
      string,
      unknown
    >;
    const components = drawing.components as Array<Record<string, unknown>>;
    const railing = components.find(
      (component) => component.component_type === "railing"
    )!;
    (railing.metadata as Record<string, unknown>).linear_feet = 999;
    const invalidSource = JSON.stringify(drawing);
    const repository = createSupabaseDeckGeometryReadRepository(
      new StubRpcClient({
        data: deckGeometryRawSnapshot(authorization, {
          drawing_source: invalidSource,
          drawing_content_hash: deckGeometryDrawingContentHash(invalidSource),
        }),
        error: null,
      })
    );

    await expect(
      getDeckDesignGeometry({ authorization, repository })
    ).rejects.toMatchObject({
      code: "INVALID_GEOMETRY",
      message: "Deck geometry could not be validated.",
      retryable: false,
    });
  });

  it("maps exact repository terminal states without disclosing existence", async () => {
    const authorization = await deckGeometryAuthorization();
    for (const [error, code] of [
      [
        {
          code: "P0002",
          message: "agent_deck_geometry_not_found_or_not_visible",
        },
        "NOT_FOUND",
      ],
      [
        { code: "54000", message: "agent_deck_geometry_source_bound" },
        "RESULT_TOO_LARGE",
      ],
      [
        { code: "40001", message: "agent_deck_geometry_read_stale" },
        "STALE_CONTEXT",
      ],
    ] as const) {
      const repository = createSupabaseDeckGeometryReadRepository(
        new StubRpcClient({ data: null, error })
      );
      await expect(
        getDeckDesignGeometry({ authorization, repository })
      ).rejects.toMatchObject({ code });
    }
  });

  it("rejects reconstructed authority and untrusted repositories", async () => {
    const authorization = await deckGeometryAuthorization();
    const repository = createSupabaseDeckGeometryReadRepository(
      new StubRpcClient({
        data: deckGeometryRawSnapshot(authorization),
        error: null,
      })
    );
    await expect(
      getDeckDesignGeometry({
        authorization: { ...authorization } as never,
        repository,
      })
    ).rejects.toMatchObject({ code: "INTERNAL", requestId: "unknown-request" });
    await expect(
      getDeckDesignGeometry({
        authorization,
        repository: {
          get: async () => ({ state: "not_found" as const }),
        } as never,
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("pins the exact serializer boundary with schema-valid generated geometry", async () => {
    const authorization = await deckGeometryAuthorization();
    const repository = createSupabaseDeckGeometryReadRepository(
      new StubRpcClient({
        data: deckGeometryRawSnapshot(authorization),
        error: null,
      })
    );
    const base = await getDeckDesignGeometry({ authorization, repository });
    const edgeCount = 100;
    const boundaryValues = Array.from({ length: edgeCount }, () => "x");
    const railingValues = Array.from({ length: edgeCount }, () => "x");
    const initial = DeckDesignGeometryResultSchema.parse(
      generatedSerializerBoundaryCandidate({
        base,
        boundaryValues,
        railingValues,
      })
    );
    let remaining =
      P2_MAX_SERIALIZED_CHARACTERS - measureP2SerializedCharacters(initial);
    expect(remaining).toBeGreaterThanOrEqual(0);

    for (const values of [boundaryValues, railingValues]) {
      for (let index = 0; index < values.length && remaining > 0; index += 1) {
        const extra = Math.min(127, remaining);
        values[index] += "x".repeat(extra);
        remaining -= extra;
      }
    }
    expect(remaining).toBe(0);

    const exact = DeckDesignGeometryResultSchema.parse(
      generatedSerializerBoundaryCandidate({
        base,
        boundaryValues,
        railingValues,
      })
    );
    expect(measureP2SerializedCharacters(exact)).toBe(
      P2_MAX_SERIALIZED_CHARACTERS
    );
    expect(assertDeckGeometrySerializedCharacterBudget(exact)).toBe(
      P2_MAX_SERIALIZED_CHARACTERS
    );

    const overBoundaryValues = [...boundaryValues];
    const overRailingValues = [...railingValues];
    const boundaryIndex = overBoundaryValues.findIndex(
      (value) => value.length < 128
    );
    if (boundaryIndex >= 0) {
      overBoundaryValues[boundaryIndex] += "x";
    } else {
      const railingIndex = overRailingValues.findIndex(
        (value) => value.length < 128
      );
      expect(railingIndex).toBeGreaterThanOrEqual(0);
      overRailingValues[railingIndex] += "x";
    }
    const over = DeckDesignGeometryResultSchema.parse(
      generatedSerializerBoundaryCandidate({
        base,
        boundaryValues: overBoundaryValues,
        railingValues: overRailingValues,
      })
    );
    expect(measureP2SerializedCharacters(over)).toBe(
      P2_MAX_SERIALIZED_CHARACTERS + 1
    );
    expect(() => assertDeckGeometrySerializedCharacterBudget(over)).toThrow(
      "DECK_GEOMETRY_RESULT_BUDGET_EXCEEDED"
    );
  });

  it("rejects a result whose proof revisions cannot retain the exact vector", async () => {
    const authorization = await deckGeometryAuthorization();
    const repository = createSupabaseDeckGeometryReadRepository(
      new StubRpcClient({
        data: deckGeometryRawSnapshot(authorization, {
          source_revisions: [
            { domain: "artifacts", source_revision: 1 },
            { domain: "deck_designs", source_revision: 2 },
            { domain: "legacy_operational", source_revision: 3 },
          ] as P2DomainRevision[],
        }),
        error: null,
      })
    );
    await expect(
      getDeckDesignGeometry({ authorization, repository })
    ).rejects.toBeInstanceOf(DeckGeometryReadError);
  });
});
