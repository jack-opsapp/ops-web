import "server-only";

import {
  assertP2NoForbiddenFields,
  P2_MAX_SERIALIZED_CHARACTERS,
} from "@/lib/agent-control-plane/contracts";
import {
  CustomerContextResultSchema,
  type CustomerContextResult,
} from "@/lib/agent-control-plane/contracts/customer-context";
import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../shared/repository-boundary";
import { measureP2SerializedCharacters } from "../shared/result-budget";
import {
  isAuthorizedCustomerContextRead,
  type AuthorizedCustomerContextRead,
} from "./customer-context-authorization";
import {
  CustomerContextProofBindingSchema,
  isTrustedCustomerContextRepository,
  type CustomerContextRepository,
  type CustomerContextRepositoryResult,
} from "./customer-context-repository";
import {
  customerContextProofMaterial,
  customerContextProofRef,
  type CustomerContextProofBinding,
} from "./customer-context-proof";

export class CustomerContextReadError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "TEMPORARILY_UNAVAILABLE"
    | "RESULT_TOO_LARGE"
    | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: CustomerContextReadError["code"];
    readonly requestId: string;
    readonly cause?: unknown;
  }) {
    const messages = {
      NOT_FOUND: "Customer context was not found.",
      TEMPORARILY_UNAVAILABLE: "Customer context is temporarily unavailable.",
      RESULT_TOO_LARGE: "Customer context is too large to return safely.",
      INTERNAL: "Customer context could not be read.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "CustomerContextReadError";
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

function parseRepositoryResult(raw: unknown): CustomerContextRepositoryResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("CUSTOMER_CONTEXT_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort((left, right) =>
    left.localeCompare(right)
  );
  if (record.state === "not_found" || record.state === "source_bound") {
    if (keys.length !== 1 || keys[0] !== "state") {
      throw new TypeError("CUSTOMER_CONTEXT_REPOSITORY_RESULT_INVALID");
    }
    return deepFreeze({ state: record.state });
  }
  if (
    record.state !== "found" ||
    keys.length !== 3 ||
    keys[0] !== "proofBinding" ||
    keys[1] !== "state" ||
    keys[2] !== "value"
  ) {
    throw new TypeError("CUSTOMER_CONTEXT_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: CustomerContextResultSchema.parse(record.value),
    proofBinding: CustomerContextProofBindingSchema.parse(record.proofBinding),
  });
}

function parseSafeResult(candidate: unknown): CustomerContextResult {
  const parsed = CustomerContextResultSchema.parse(candidate);
  assertP2NoForbiddenFields(parsed);
  return deepFreeze(parsed);
}

function reproofResult(input: {
  readonly value: CustomerContextResult;
  readonly sections: CustomerContextResult["sections"];
  readonly authorization: AuthorizedCustomerContextRead;
  readonly proofBinding: CustomerContextProofBinding;
}): CustomerContextResult {
  const payload = {
    customer: input.value.customer,
    sections: input.sections,
  };
  return parseSafeResult({
    ...payload,
    proof: {
      ...input.value.proof,
      proof_ref: customerContextProofRef(
        customerContextProofMaterial({
          authorization: input.authorization,
          readAt: input.value.proof.read_at,
          sourceRevisions: input.proofBinding.sourceRevisions,
          sourceInspected: input.proofBinding.sourceInspected,
          result: payload,
        })
      ),
    },
  });
}

function reduceToBudget(input: {
  readonly value: CustomerContextResult;
  readonly authorization: AuthorizedCustomerContextRead;
  readonly proofBinding: CustomerContextProofBinding;
}): CustomerContextResult {
  const value = input.value;
  let candidate = parseSafeResult(value);
  if (
    measureP2SerializedCharacters(candidate) <= P2_MAX_SERIALIZED_CHARACTERS
  ) {
    return candidate;
  }

  const originalDuplicate = candidate.sections.duplicate_state;
  const originalContacts = candidate.sections.contacts;
  let duplicateCount = originalDuplicate?.candidates.length ?? 0;
  let contactCount = originalContacts?.contacts.length ?? 0;

  while (duplicateCount > 0 || contactCount > 0) {
    // Duplicate suggestions are advisory context. Preserve explicitly
    // requested, purpose-bound contact rows for as long as possible.
    if (duplicateCount > 0) duplicateCount -= 1;
    else contactCount -= 1;

    const sections = {
      ...candidate.sections,
      ...(originalDuplicate
        ? {
            duplicate_state: {
              ...originalDuplicate,
              candidates: originalDuplicate.candidates.slice(0, duplicateCount),
              returned_count: duplicateCount,
              result_budget_omitted_count:
                originalDuplicate.source_count - duplicateCount,
            },
          }
        : {}),
      ...(originalContacts
        ? {
            contacts: {
              ...originalContacts,
              contacts: originalContacts.contacts.slice(0, contactCount),
              returned_count: contactCount,
              result_budget_omitted_count:
                originalContacts.source_count - contactCount,
            },
          }
        : {}),
    };
    candidate = reproofResult({
      value,
      sections,
      authorization: input.authorization,
      proofBinding: input.proofBinding,
    });
    if (
      measureP2SerializedCharacters(candidate) <= P2_MAX_SERIALIZED_CHARACTERS
    ) {
      return candidate;
    }
  }

  throw new CustomerContextReadError({
    code: "RESULT_TOO_LARGE",
    requestId: "unknown-request",
  });
}

export async function getCustomerContext(input: {
  readonly authorization: AuthorizedCustomerContextRead;
  readonly repository: CustomerContextRepository;
  readonly signal?: AbortSignal;
}): Promise<CustomerContextResult> {
  const authorization = input.authorization;
  if (!isAuthorizedCustomerContextRead(authorization)) {
    throw new CustomerContextReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedCustomerContextRepository(input.repository)) {
    throw new CustomerContextReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
    });
  }

  let repositoryResult: CustomerContextRepositoryResult;
  try {
    repositoryResult = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedCustomerContextRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.read({
          authorization,
          ...(signal ? { signal } : {}),
        }),
      parse: parseRepositoryResult,
    });
  } catch (error) {
    throw new CustomerContextReadError({
      code:
        error instanceof P2RepositoryBoundaryError
          ? "TEMPORARILY_UNAVAILABLE"
          : "INTERNAL",
      requestId: authorization.actorContext.requestId,
      cause: error,
    });
  }

  if (repositoryResult.state === "not_found") {
    throw new CustomerContextReadError({
      code: "NOT_FOUND",
      requestId: authorization.actorContext.requestId,
    });
  }
  if (repositoryResult.state === "source_bound") {
    throw new CustomerContextReadError({
      code: "RESULT_TOO_LARGE",
      requestId: authorization.actorContext.requestId,
    });
  }

  try {
    return reduceToBudget({
      value: repositoryResult.value,
      authorization,
      proofBinding: repositoryResult.proofBinding,
    });
  } catch (error) {
    if (error instanceof CustomerContextReadError) {
      throw new CustomerContextReadError({
        code: error.code,
        requestId: authorization.actorContext.requestId,
        cause: error,
      });
    }
    throw new CustomerContextReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      cause: error,
    });
  }
}
