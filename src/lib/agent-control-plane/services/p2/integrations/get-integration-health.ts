import "server-only";

import { P2_MAX_SERIALIZED_CHARACTERS } from "@/lib/agent-control-plane/contracts";
import {
  GetIntegrationHealthResultSchema,
  assertNoCompanyOperationsForbiddenFields,
  type GetIntegrationHealthResult,
} from "@/lib/agent-control-plane/contracts/company-operations";
import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../shared/repository-boundary";
import { measureP2SerializedCharacters } from "../shared/result-budget";
import {
  isAuthorizedIntegrationHealthRead,
  type AuthorizedIntegrationHealthRead,
} from "./integration-authorization";
import {
  integrationHealthCollectionProofRef,
  integrationHealthEntityProofRef,
  integrationHealthEvidenceRef,
  integrationHealthProofContext,
} from "./integration-proof";
import {
  isTrustedIntegrationHealthRepository,
  type IntegrationHealthProofBinding,
  type IntegrationHealthRepository,
  type IntegrationHealthRepositoryResult,
} from "./integration-repository";

export class IntegrationHealthReadError extends Error {
  readonly code: "INTERNAL" | "RESULT_TOO_LARGE" | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: IntegrationHealthReadError["code"];
    readonly requestId: string;
    readonly cause?: unknown;
  }) {
    const messages = {
      INTERNAL: "Integration health couldn't be read. Try again.",
      RESULT_TOO_LARGE: "Integration health is too large to return safely.",
      TEMPORARILY_UNAVAILABLE:
        "Integration health is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "IntegrationHealthReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.code === "TEMPORARILY_UNAVAILABLE";
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function parseRepositoryResult(
  raw: unknown
): IntegrationHealthRepositoryResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("INTEGRATION_HEALTH_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (record.state === "source_bound" || record.state === "source_invalid") {
    if (Object.keys(record).length !== 1) {
      throw new TypeError("INTEGRATION_HEALTH_REPOSITORY_RESULT_INVALID");
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
    throw new TypeError("INTEGRATION_HEALTH_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: GetIntegrationHealthResultSchema.parse(record.value),
    proofBinding: record.proofBinding as IntegrationHealthProofBinding,
  });
}

function validateResult(input: {
  readonly authorization: AuthorizedIntegrationHealthRead;
  readonly value: GetIntegrationHealthResult;
  readonly proofBinding: IntegrationHealthProofBinding;
}) {
  const value = GetIntegrationHealthResultSchema.parse(input.value);
  assertNoCompanyOperationsForbiddenFields(value);
  if (
    value.items.length !== input.authorization.query.integrations.length ||
    value.items.some(
      (item, index) =>
        item.integration_type !==
          input.authorization.query.integrations[index]?.integration_type ||
        item.provider !==
          input.authorization.query.integrations[index]?.provider
    )
  ) {
    throw new TypeError("INTEGRATION_HEALTH_SELECTION_BINDING_INVALID");
  }
  const context = integrationHealthProofContext({
    authorization: input.authorization,
    readAt: value.collection_proof.read_at,
    sourceRevisions: value.collection_proof.source_revisions,
    sourceInspected: input.proofBinding.sourceInspected,
  });
  const children = value.items.map((item, index) => {
    const selection = input.authorization.query.integrations[index]!;
    if (
      value.item_proofs[index]?.proof_ref !==
        integrationHealthEntityProofRef({ context, item }) ||
      value.evidence[index]?.evidence_ref !==
        integrationHealthEvidenceRef({ context, selection })
    ) {
      throw new TypeError("INTEGRATION_HEALTH_PROOF_INVALID");
    }
    return {
      selection,
      proof_ref: value.item_proofs[index]!.proof_ref,
      evidence_ref: value.evidence[index]!.evidence_ref,
    };
  });
  if (
    value.collection_proof.proof_ref !==
    integrationHealthCollectionProofRef({ context, children })
  ) {
    throw new TypeError("INTEGRATION_HEALTH_PROOF_INVALID");
  }
  if (measureP2SerializedCharacters(value) > P2_MAX_SERIALIZED_CHARACTERS) {
    throw new IntegrationHealthReadError({
      code: "RESULT_TOO_LARGE",
      requestId: input.authorization.actorContext.requestId,
    });
  }
  return deepFreeze(value);
}

export async function getIntegrationHealth(input: {
  readonly authorization: AuthorizedIntegrationHealthRead;
  readonly repository: IntegrationHealthRepository;
  readonly signal?: AbortSignal;
}): Promise<GetIntegrationHealthResult> {
  const authorization = input.authorization;
  if (!isAuthorizedIntegrationHealthRead(authorization)) {
    throw new IntegrationHealthReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedIntegrationHealthRepository(input.repository)) {
    throw new IntegrationHealthReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
    });
  }
  let result: IntegrationHealthRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedIntegrationHealthRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.read({
          authorization,
          ...(signal ? { signal } : {}),
        }),
      parse: parseRepositoryResult,
    });
  } catch (error) {
    throw new IntegrationHealthReadError({
      code:
        error instanceof P2RepositoryBoundaryError
          ? "TEMPORARILY_UNAVAILABLE"
          : "INTERNAL",
      requestId: authorization.actorContext.requestId,
      cause: error,
    });
  }
  if (result.state === "source_bound") {
    throw new IntegrationHealthReadError({
      code: "RESULT_TOO_LARGE",
      requestId: authorization.actorContext.requestId,
    });
  }
  if (result.state === "source_invalid") {
    throw new IntegrationHealthReadError({
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
    if (error instanceof IntegrationHealthReadError) throw error;
    throw new IntegrationHealthReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      cause: error,
    });
  }
}
