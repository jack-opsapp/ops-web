import "server-only";

import { P2_MAX_SERIALIZED_CHARACTERS } from "@/lib/agent-control-plane/contracts";
import {
  CompanyContextResultSchema,
  assertNoCompanyOperationsForbiddenFields,
  type CompanyContextResult,
} from "@/lib/agent-control-plane/contracts/company-operations";
import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../shared/repository-boundary";
import { measureP2SerializedCharacters } from "../shared/result-budget";
import {
  isAuthorizedCompanyContextRead,
  type AuthorizedCompanyContextRead,
} from "./company-authorization";
import {
  companyContextProofMaterial,
  companyContextProofRef,
  type CompanyContextProofBinding,
} from "./company-proof";
import {
  isTrustedCompanyContextRepository,
  type CompanyContextRepository,
  type CompanyContextRepositoryResult,
} from "./company-repository";

export class CompanyContextReadError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "TEMPORARILY_UNAVAILABLE"
    | "RESULT_TOO_LARGE"
    | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: CompanyContextReadError["code"];
    readonly requestId: string;
    readonly cause?: unknown;
  }) {
    const messages = {
      NOT_FOUND: "Company context was not found.",
      TEMPORARILY_UNAVAILABLE: "Company context is temporarily unavailable.",
      RESULT_TOO_LARGE: "Company context is too large to return safely.",
      INTERNAL: "Company context could not be read.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "CompanyContextReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.code === "TEMPORARILY_UNAVAILABLE";
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

function parseRepositoryResult(raw: unknown): CompanyContextRepositoryResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("COMPANY_CONTEXT_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort((left, right) =>
    left.localeCompare(right)
  );
  if (record.state === "not_found") {
    if (keys.length !== 1 || keys[0] !== "state") {
      throw new TypeError("COMPANY_CONTEXT_REPOSITORY_RESULT_INVALID");
    }
    return deepFreeze({ state: "not_found" });
  }
  if (
    record.state !== "found" ||
    keys.length !== 3 ||
    keys[0] !== "proofBinding" ||
    keys[1] !== "state" ||
    keys[2] !== "value" ||
    typeof record.proofBinding !== "object" ||
    record.proofBinding === null ||
    Array.isArray(record.proofBinding)
  ) {
    throw new TypeError("COMPANY_CONTEXT_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: CompanyContextResultSchema.parse(record.value),
    proofBinding: record.proofBinding as CompanyContextProofBinding,
  });
}

function validateResult(input: {
  readonly authorization: AuthorizedCompanyContextRead;
  readonly value: CompanyContextResult;
  readonly proofBinding: CompanyContextProofBinding;
}): CompanyContextResult {
  const value = CompanyContextResultSchema.parse(input.value);
  assertNoCompanyOperationsForbiddenFields(value);
  const { proof, ...payload } = value;
  const expected = companyContextProofRef(
    companyContextProofMaterial({
      authorization: input.authorization,
      readAt: proof.read_at,
      sourceRevisions: input.proofBinding.sourceRevisions,
      sourceInspected: input.proofBinding.sourceInspected,
      result: payload,
    })
  );
  if (expected !== proof.proof_ref) {
    throw new TypeError("COMPANY_CONTEXT_PROOF_INVALID");
  }
  if (measureP2SerializedCharacters(value) > P2_MAX_SERIALIZED_CHARACTERS) {
    throw new CompanyContextReadError({
      code: "RESULT_TOO_LARGE",
      requestId: input.authorization.actorContext.requestId,
    });
  }
  return deepFreeze(value);
}

export async function getCompanyContext(input: {
  readonly authorization: AuthorizedCompanyContextRead;
  readonly repository: CompanyContextRepository;
  readonly signal?: AbortSignal;
}): Promise<CompanyContextResult> {
  const authorization = input.authorization;
  if (!isAuthorizedCompanyContextRead(authorization)) {
    throw new CompanyContextReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedCompanyContextRepository(input.repository)) {
    throw new CompanyContextReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
    });
  }

  let repositoryResult: CompanyContextRepositoryResult;
  try {
    repositoryResult = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedCompanyContextRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.read({
          authorization,
          ...(signal ? { signal } : {}),
        }),
      parse: parseRepositoryResult,
    });
  } catch (error) {
    throw new CompanyContextReadError({
      code:
        error instanceof P2RepositoryBoundaryError
          ? "TEMPORARILY_UNAVAILABLE"
          : "INTERNAL",
      requestId: authorization.actorContext.requestId,
      cause: error,
    });
  }

  if (repositoryResult.state === "not_found") {
    throw new CompanyContextReadError({
      code: "NOT_FOUND",
      requestId: authorization.actorContext.requestId,
    });
  }

  try {
    return validateResult({
      authorization,
      value: repositoryResult.value,
      proofBinding: repositoryResult.proofBinding,
    });
  } catch (error) {
    if (error instanceof CompanyContextReadError) throw error;
    throw new CompanyContextReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      cause: error,
    });
  }
}
