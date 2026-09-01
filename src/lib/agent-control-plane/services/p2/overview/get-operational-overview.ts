import "server-only";

import { P2_MAX_SERIALIZED_CHARACTERS } from "@/lib/agent-control-plane/contracts/p2-common";
import {
  GetOperationalOverviewResultSchema,
  assertNoOperationalOverviewForbiddenFields,
  type OperationalOverviewResult,
} from "@/lib/agent-control-plane/contracts/operational-overview";
import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../shared/repository-boundary";
import { toP2ReadAgentError } from "../shared/read-error-transport";
import { measureP2SerializedCharacters } from "../shared/result-budget";
import {
  isAuthorizedOperationalOverviewRead,
  type AuthorizedOperationalOverviewRead,
} from "./overview-authorization";
import {
  operationalOverviewCollectionProofRef,
  operationalOverviewEntityProofRef,
  operationalOverviewEvidenceRef,
  operationalOverviewProofContext,
} from "./overview-proof";
import {
  isTrustedOperationalOverviewRepository,
  type OperationalOverviewProofBinding,
  type OperationalOverviewRepository,
  type OperationalOverviewRepositoryResult,
} from "./overview-repository";

export class OperationalOverviewReadError extends Error {
  readonly code: "INTERNAL" | "RESULT_TOO_LARGE" | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: OperationalOverviewReadError["code"];
    readonly requestId: string;
    readonly cause?: unknown;
  }) {
    const messages = {
      INTERNAL: "Overview couldn't be read. Try again.",
      RESULT_TOO_LARGE:
        "Overview is too large. Select fewer components and try again.",
      TEMPORARILY_UNAVAILABLE:
        "Overview is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "OperationalOverviewReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.code === "TEMPORARILY_UNAVAILABLE";
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

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function parseRepositoryResult(
  raw: unknown
): OperationalOverviewRepositoryResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("OPERATIONAL_OVERVIEW_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (record.state === "source_bound" || record.state === "source_invalid") {
    if (Object.keys(record).length !== 1) {
      throw new TypeError("OPERATIONAL_OVERVIEW_REPOSITORY_RESULT_INVALID");
    }
    return deepFreeze({ state: record.state });
  }
  if (
    record.state !== "found" ||
    Object.keys(record).length !== 3 ||
    typeof record.proofBinding !== "object" ||
    record.proofBinding === null ||
    Array.isArray(record.proofBinding)
  ) {
    throw new TypeError("OPERATIONAL_OVERVIEW_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: GetOperationalOverviewResultSchema.parse(record.value),
    proofBinding: record.proofBinding as OperationalOverviewProofBinding,
  });
}

function validateResult(input: {
  readonly authorization: AuthorizedOperationalOverviewRead;
  readonly value: OperationalOverviewResult;
  readonly proofBinding: OperationalOverviewProofBinding;
}) {
  const value = GetOperationalOverviewResultSchema.parse(input.value);
  assertNoOperationalOverviewForbiddenFields(value);
  if (
    value.items.length !== input.authorization.authorizedComponents.length ||
    value.items.some(
      (item, index) =>
        item.component !==
        input.authorization.authorizedComponents[index]?.component
    ) ||
    JSON.stringify(value.warnings) !==
      JSON.stringify(input.authorization.warnings)
  ) {
    throw new TypeError("OPERATIONAL_OVERVIEW_SELECTION_BINDING_INVALID");
  }

  const context = operationalOverviewProofContext({
    authorization: input.authorization,
    readAt: value.collection_proof.read_at,
    componentSourceInspected: input.proofBinding.componentSourceInspected,
  });
  const children = value.items.map((item, index) => {
    const proof = value.item_proofs[index]!;
    const evidence = value.evidence[index]!;
    if (
      proof.proof_ref !==
        operationalOverviewEntityProofRef({
          context,
          item,
          sourceInspected:
            input.proofBinding.componentSourceInspected[index]!
              .source_inspected,
          sourceRevisions: proof.source_revisions,
        }) ||
      evidence.evidence_ref !==
        operationalOverviewEvidenceRef({
          context,
          component: item.component,
          sourceInspected:
            input.proofBinding.componentSourceInspected[index]!
              .source_inspected,
          sourceRevisions: proof.source_revisions,
        })
    ) {
      throw new TypeError("OPERATIONAL_OVERVIEW_PROOF_INVALID");
    }
    return {
      component: item.component,
      proof_ref: proof.proof_ref,
      evidence_ref: evidence.evidence_ref,
      source_inspected:
        input.proofBinding.componentSourceInspected[index]!.source_inspected,
      source_revisions: proof.source_revisions,
    };
  });
  if (
    value.collection_proof.proof_ref !==
    operationalOverviewCollectionProofRef({
      context,
      sourceRevisions: value.collection_proof.source_revisions,
      children,
    })
  ) {
    throw new TypeError("OPERATIONAL_OVERVIEW_PROOF_INVALID");
  }
  if (measureP2SerializedCharacters(value) > P2_MAX_SERIALIZED_CHARACTERS) {
    throw new OperationalOverviewReadError({
      code: "RESULT_TOO_LARGE",
      requestId: input.authorization.actorContext.requestId,
    });
  }
  return deepFreeze(value);
}

export async function getOperationalOverview(input: {
  readonly authorization: AuthorizedOperationalOverviewRead;
  readonly repository: OperationalOverviewRepository;
  readonly signal?: AbortSignal;
}): Promise<OperationalOverviewResult> {
  const authorization = input.authorization;
  if (!isAuthorizedOperationalOverviewRead(authorization)) {
    throw new OperationalOverviewReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedOperationalOverviewRepository(input.repository)) {
    throw new OperationalOverviewReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
    });
  }

  let result: OperationalOverviewRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedOperationalOverviewRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.read({
          authorization,
          ...(signal ? { signal } : {}),
        }),
      parse: parseRepositoryResult,
    });
  } catch (error) {
    throw new OperationalOverviewReadError({
      code:
        error instanceof P2RepositoryBoundaryError
          ? "TEMPORARILY_UNAVAILABLE"
          : "INTERNAL",
      requestId: authorization.actorContext.requestId,
      cause: error,
    });
  }
  if (result.state === "source_bound") {
    throw new OperationalOverviewReadError({
      code: "RESULT_TOO_LARGE",
      requestId: authorization.actorContext.requestId,
    });
  }
  if (result.state === "source_invalid") {
    throw new OperationalOverviewReadError({
      code: "TEMPORARILY_UNAVAILABLE",
      requestId: authorization.actorContext.requestId,
    });
  }
  try {
    return validateResult({
      authorization,
      value: result.value,
      proofBinding: result.proofBinding,
    });
  } catch (error) {
    if (error instanceof OperationalOverviewReadError) throw error;
    throw new OperationalOverviewReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      cause: error,
    });
  }
}
