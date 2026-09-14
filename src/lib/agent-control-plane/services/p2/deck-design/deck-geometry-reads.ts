import "server-only";

import {
  P2_MAX_SERIALIZED_CHARACTERS,
  type P2EntityProof,
  type P2EvidenceIdentity,
} from "@/lib/agent-control-plane/contracts";
import {
  DECK_GEOMETRY_CALCULATOR_REVISION,
  DECK_GEOMETRY_LOCAL_REF_REVISION,
  DeckDesignGeometryResultSchema,
  assertNoDeckGeometryForbiddenFields,
  type DeckDesignGeometryResult,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import {
  DECK_GEOMETRY_CALCULATOR_V2_REVISION,
  DECK_GEOMETRY_RESULT_V2_REVISION,
  DeckDesignGeometryResultV2Schema,
  type DeckDesignGeometryResultV2,
  type DeckGeometryResultRevision,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry-v2";
import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../shared/repository-boundary";
import { toP2ReadAgentError } from "../shared/read-error-transport";
import { measureP2SerializedCharacters } from "../shared/result-budget";
import {
  isAuthorizedDeckDesignGeometryRead,
  type AuthorizedDeckDesignGeometryRead,
} from "./deck-geometry-authorization";
import {
  DeckGeometrySourceError,
  calculateDeckGeometryFromSourceJson,
} from "./deck-geometry-calculator";
import {
  deckGeometryEntityProofRef,
  deckGeometryEvidenceRef,
  deckGeometryProofContext,
  deckGeometrySourceFence,
} from "./deck-geometry-proof";
import {
  isTrustedDeckGeometryReadRepository,
  type DeckGeometryReadRepository,
  type DeckGeometryRepositoryResult,
} from "./deck-geometry-repository";

export class DeckGeometryReadError extends Error {
  readonly code:
    | "INTERNAL"
    | "DECK_GEOMETRY_RESULT_REVISION_UNSUPPORTED"
    | "INVALID_GEOMETRY"
    | "NOT_FOUND"
    | "RESULT_TOO_LARGE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: DeckGeometryReadError["code"];
    readonly requestId: string;
  }) {
    const messages = {
      INTERNAL: "Deck geometry could not be read.",
      INVALID_GEOMETRY:
        "The saved deck geometry is invalid. Open the design in OPS and review its geometry before trying again.",
      DECK_GEOMETRY_RESULT_REVISION_UNSUPPORTED:
        "This connection version cannot represent the saved deck geometry. OPS must release and enable a compatible connection version; the drawing does not need an invented edge.",
      NOT_FOUND: "Deck geometry was not found.",
      RESULT_TOO_LARGE: "Deck geometry is too large to return safely.",
      STALE_CONTEXT: "Deck geometry changed. Start the read again.",
      TEMPORARILY_UNAVAILABLE: "Deck geometry is temporarily unavailable.",
    } as const;
    super(messages[input.code]);
    this.name = "DeckGeometryReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable =
      input.code === "STALE_CONTEXT" ||
      input.code === "TEMPORARILY_UNAVAILABLE";
  }

  toAgentError() {
    return toP2ReadAgentError({
      code: this.code,
      requestId: this.requestId,
      message: this.message,
      retryable: this.retryable,
    });
  }
}

class DeckGeometryResultBudgetError extends Error {
  constructor() {
    super("DECK_GEOMETRY_RESULT_BUDGET_EXCEEDED");
    this.name = "DeckGeometryResultBudgetError";
  }
}

export function assertDeckGeometrySerializedCharacterBudget(
  value: unknown
): number {
  let serializedCharacters: number;
  try {
    serializedCharacters = measureP2SerializedCharacters(value);
  } catch {
    throw new DeckGeometryResultBudgetError();
  }
  if (serializedCharacters > P2_MAX_SERIALIZED_CHARACTERS) {
    throw new DeckGeometryResultBudgetError();
  }
  return serializedCharacters;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function exactStateRecord(
  raw: unknown,
  terminalStates: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("DECK_GEOMETRY_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (
    terminalStates.includes(String(record.state)) &&
    Object.keys(record).length !== 1
  ) {
    throw new TypeError("DECK_GEOMETRY_REPOSITORY_RESULT_INVALID");
  }
  return record;
}

function parseRepositoryResult(raw: unknown): DeckGeometryRepositoryResult {
  const record = exactStateRecord(raw, ["not_found", "source_bound", "stale"]);
  if (
    record.state === "not_found" ||
    record.state === "source_bound" ||
    record.state === "stale"
  ) {
    return deepFreeze({ state: record.state });
  }
  if (
    record.state !== "found" ||
    Object.keys(record).length !== 2 ||
    typeof record.snapshot !== "object" ||
    record.snapshot === null ||
    Array.isArray(record.snapshot)
  ) {
    throw new TypeError("DECK_GEOMETRY_REPOSITORY_RESULT_INVALID");
  }
  return raw as DeckGeometryRepositoryResult;
}

function readError(
  code: DeckGeometryReadError["code"],
  authorization: AuthorizedDeckDesignGeometryRead
): DeckGeometryReadError {
  return new DeckGeometryReadError({
    code,
    requestId: authorization.actorContext.requestId,
  });
}

function calculationErrorCode(
  error: DeckGeometrySourceError
): "INVALID_GEOMETRY" | "RESULT_TOO_LARGE" {
  return new Set([
    "DECK_GEOMETRY_COLLECTION_LIMIT_EXCEEDED",
    "DECK_GEOMETRY_SOURCE_TOO_LARGE",
    "DECK_GEOMETRY_TOPOLOGY_LIMIT_EXCEEDED",
  ]).has(error.code)
    ? "RESULT_TOO_LARGE"
    : "INVALID_GEOMETRY";
}

function buildResult(input: {
  readonly resultRevision: DeckGeometryResultRevision;
  readonly authorization: AuthorizedDeckDesignGeometryRead;
  readonly snapshot: Extract<
    DeckGeometryRepositoryResult,
    { readonly state: "found" }
  >["snapshot"];
}): DeckDesignGeometryResult | DeckDesignGeometryResultV2 {
  const { authorization, snapshot } = input;
  const calculation = calculateDeckGeometryFromSourceJson(
    snapshot.drawingSource
  );
  const v2 = input.resultRevision === "v2";
  if (
    !v2 &&
    calculation.topology.connections.some(
      (c) => c.kind === "level_stair" && c.lower_edge_ref === null
    )
  )
    throw readError("DECK_GEOMETRY_RESULT_REVISION_UNSUPPORTED", authorization);
  const calculatorRevision = v2
    ? DECK_GEOMETRY_CALCULATOR_V2_REVISION
    : DECK_GEOMETRY_CALCULATOR_REVISION;
  const geometrySourceFence = deckGeometrySourceFence({
    authorization,
    calculatorRevision,
    selectedAuthorization: snapshot.selectedAuthorization,
    designId: snapshot.designId,
    drawingContentHash: snapshot.drawingContentHash,
    authorityPath: snapshot.authorityPath,
    designParents: snapshot.designParents,
    sourceRevisions: snapshot.sourceRevisions,
  });
  const evidence: P2EvidenceIdentity[] = [
    {
      evidence_ref: deckGeometryEvidenceRef({
        companyId: authorization.actorContext.companyId,
        designId: snapshot.designId,
        drawingContentHash: snapshot.drawingContentHash,
      }),
      source_domain: "deck_designs",
      source_type: "deck_design_geometry",
      occurred_at: snapshot.readAt,
    },
  ];
  const baseResult = {
    deck_design_ref: authorization.query.deck_design_ref,
    design: {
      title:
        snapshot.titleText === null
          ? null
          : {
              text: snapshot.titleText,
              content_kind: "untrusted_business_data" as const,
            },
      drawing_schema_version: calculation.drawing_schema_version,
      calculator_revision: calculatorRevision,
      local_ref_revision: DECK_GEOMETRY_LOCAL_REF_REVISION,
    },
    coordinate_system: {
      axes: "x_right_y_down" as const,
      unit: "drawing_unit" as const,
    },
    topology: calculation.topology,
    measurements: calculation.measurements,
    geometry_source_fence: geometrySourceFence,
    evidence,
  };
  const resultWithoutProof = v2
    ? {
        ...baseResult,
        result_revision: DECK_GEOMETRY_RESULT_V2_REVISION,
        railing_estimate: calculation.railing_estimate,
        stair_placements: [...calculation.stair_placements],
        measurement_basis: {
          flat_railing_linear_feet: "configured_edges_only",
          parapet_linear_feet: "configured_wall_edges_only",
          stair_railing_linear_feet: "native_two_sided_stair_geometry",
          combined_guard_linear_feet:
            "configured_flat_plus_native_stairs_plus_parapet",
        } as const,
      }
    : baseResult;
  const proofContext = deckGeometryProofContext({
    authorization,
    calculatorRevision,
    selectedAuthorization: snapshot.selectedAuthorization,
    authorityPath: snapshot.authorityPath,
    designId: snapshot.designId,
    designParents: snapshot.designParents,
    drawingContentHash: snapshot.drawingContentHash,
    readAt: snapshot.readAt,
    sourceRevisions: snapshot.sourceRevisions,
    sourceInspected: snapshot.sourceInspected,
  });
  const proof: P2EntityProof = {
    proof_ref: deckGeometryEntityProofRef({
      context: proofContext,
      result: resultWithoutProof as
        | Omit<DeckDesignGeometryResult, "proof">
        | Omit<DeckDesignGeometryResultV2, "proof">,
    }),
    read_at: snapshot.readAt,
    source_revisions: [...snapshot.sourceRevisions],
  };
  const parsed = (
    v2 ? DeckDesignGeometryResultV2Schema : DeckDesignGeometryResultSchema
  ).parse({
    ...resultWithoutProof,
    proof,
  });
  assertNoDeckGeometryForbiddenFields(parsed);
  assertDeckGeometrySerializedCharacterBudget(parsed);
  return deepFreeze(parsed);
}

interface DeckReadInput {
  readonly resultRevision?: DeckGeometryResultRevision;
  readonly authorization: AuthorizedDeckDesignGeometryRead;
  readonly repository: DeckGeometryReadRepository;
  readonly signal?: AbortSignal;
}
export function getDeckDesignGeometry(
  input: DeckReadInput & { resultRevision: "v2" }
): Promise<DeckDesignGeometryResultV2>;
export function getDeckDesignGeometry(
  input: DeckReadInput & { resultRevision?: "v1" }
): Promise<DeckDesignGeometryResult>;
export function getDeckDesignGeometry(
  input: DeckReadInput
): Promise<DeckDesignGeometryResult | DeckDesignGeometryResultV2>;
export async function getDeckDesignGeometry(
  input: DeckReadInput
): Promise<DeckDesignGeometryResult | DeckDesignGeometryResultV2> {
  const authorization = input.authorization;
  if (!isAuthorizedDeckDesignGeometryRead(authorization)) {
    throw new DeckGeometryReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (
    input.resultRevision !== undefined &&
    input.resultRevision !== "v1" &&
    input.resultRevision !== "v2"
  )
    throw readError("INTERNAL", authorization);
  if (!isTrustedDeckGeometryReadRepository(input.repository)) {
    throw readError("INTERNAL", authorization);
  }

  let result: DeckGeometryRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedDeckGeometryReadRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.get({
          authorization,
          ...(signal ? { signal } : {}),
        }),
      parse: parseRepositoryResult,
    });
  } catch (error) {
    throw readError(
      error instanceof P2RepositoryBoundaryError
        ? "TEMPORARILY_UNAVAILABLE"
        : "INTERNAL",
      authorization
    );
  }
  if (result.state === "not_found") {
    throw readError("NOT_FOUND", authorization);
  }
  if (result.state === "source_bound") {
    throw readError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "stale") {
    throw readError("STALE_CONTEXT", authorization);
  }

  try {
    return buildResult({
      authorization,
      snapshot: result.snapshot,
      resultRevision: input.resultRevision ?? "v1",
    });
  } catch (error) {
    if (error instanceof DeckGeometryReadError) throw error;
    if (error instanceof DeckGeometryResultBudgetError) {
      throw readError("RESULT_TOO_LARGE", authorization);
    }
    if (error instanceof DeckGeometrySourceError) {
      throw readError(calculationErrorCode(error), authorization);
    }
    throw readError("INTERNAL", authorization);
  }
}
