import "server-only";

import {
  CONTRACT_VERSION,
  type AgentError,
  type SourceVersion,
} from "@/lib/agent-control-plane/contracts";
import {
  CustomerDiscoveryResultSchema,
  DISCOVERY_PROMPT_SAFETY_DIRECTIVE,
  DISCOVERY_RESULT_BUDGET_WARNING,
  MAX_DISCOVERY_OUTPUT_CHARACTERS,
  discoveryPromptSerializedLength,
  type CustomerDiscoveryResult,
} from "@/lib/agent-control-plane/contracts/discovery";
import {
  isAuthorizedCustomerDiscoveryRead,
  type AuthorizedCustomerDiscoveryRead,
} from "./customer-discovery-authorization";
import {
  CustomerDiscoveryRepositoryError,
  isTrustedCustomerDiscoveryRepository,
  type CustomerDiscoveryRepository,
  type CustomerDiscoverySnapshot,
} from "./customer-discovery-repository";

function safeMessage(code: CustomerDiscoveryReadError["code"]): string {
  if (code === "NOT_FOUND") {
    return "Customer discovery results were not found.";
  }
  if (code === "STALE_CONTEXT") {
    return "Customer discovery results changed during pagination.";
  }
  if (code === "TEMPORARILY_UNAVAILABLE") {
    return "Customer discovery is temporarily unavailable.";
  }
  if (code === "RESULT_TOO_LARGE") {
    return "Customer discovery result is too large.";
  }
  return "Customer discovery could not be read.";
}

function generatedAt(now?: () => Date): string | null {
  try {
    return (now?.() ?? new Date()).toISOString();
  } catch {
    return null;
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

export class CustomerDiscoveryReadError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE"
    | "RESULT_TOO_LARGE"
    | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;
  readonly currentSourceVersion: SourceVersion | null;

  constructor(input: {
    readonly code: CustomerDiscoveryReadError["code"];
    readonly requestId: string;
    readonly retryable: boolean;
    readonly currentSourceVersion?: SourceVersion | null;
    readonly cause?: unknown;
  }) {
    super(safeMessage(input.code), { cause: input.cause });
    this.name = "CustomerDiscoveryReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
    this.currentSourceVersion = input.currentSourceVersion ?? null;
  }

  toAgentError(): AgentError {
    const base = {
      contract_version: CONTRACT_VERSION,
      request_id: this.requestId,
      message: this.message,
      retryable: this.retryable,
    } as const;
    if (this.code === "STALE_CONTEXT") {
      return {
        ...base,
        code: "STALE_CONTEXT",
        details: { current_source_versions: [this.currentSourceVersion!] },
      };
    }
    if (this.code === "NOT_FOUND") return { ...base, code: "NOT_FOUND" };
    if (this.code === "TEMPORARILY_UNAVAILABLE") {
      return { ...base, code: "TEMPORARILY_UNAVAILABLE" };
    }
    if (this.code === "RESULT_TOO_LARGE") {
      return { ...base, code: "RESULT_TOO_LARGE" };
    }
    return { ...base, code: "INTERNAL" };
  }
}

function mapRepositoryError(
  error: unknown,
  authorization: AuthorizedCustomerDiscoveryRead
): never {
  if (error instanceof CustomerDiscoveryRepositoryError) {
    if (error.code === "CUSTOMER_DISCOVERY_NOT_FOUND") {
      throw new CustomerDiscoveryReadError({
        code: "NOT_FOUND",
        requestId: authorization.actorContext.requestId,
        retryable: false,
        cause: error,
      });
    }
    if (
      error.code === "CUSTOMER_DISCOVERY_STALE" &&
      error.currentSourceVersion
    ) {
      throw new CustomerDiscoveryReadError({
        code: "STALE_CONTEXT",
        requestId: authorization.actorContext.requestId,
        retryable: true,
        currentSourceVersion: error.currentSourceVersion,
        cause: error,
      });
    }
    if (error.code === "CUSTOMER_DISCOVERY_READ_FAILED") {
      throw new CustomerDiscoveryReadError({
        code: "TEMPORARILY_UNAVAILABLE",
        requestId: authorization.actorContext.requestId,
        retryable: true,
        cause: error,
      });
    }
  }
  throw new CustomerDiscoveryReadError({
    code: "INTERNAL",
    requestId: authorization.actorContext.requestId,
    retryable: false,
    cause: error,
  });
}

function resultCandidate(input: {
  readonly authorization: AuthorizedCustomerDiscoveryRead;
  readonly snapshot: CustomerDiscoverySnapshot;
  readonly generatedAt: string;
  readonly retainedCount: number;
  readonly characterBounded: boolean;
}) {
  const retainedClaims = input.snapshot.match_claims.slice(
    0,
    input.retainedCount
  );
  const omittedCount =
    input.snapshot.match_claims.length - retainedClaims.length;
  const hasMore = input.characterBounded || input.snapshot.page.has_more;
  const nextCursor = input.characterBounded
    ? retainedClaims.length > 0
      ? input.snapshot.boundary_cursors[retainedClaims.length - 1]!
      : null
    : input.snapshot.page.next_cursor;

  return {
    contract_version: CONTRACT_VERSION,
    request_id: input.authorization.actorContext.requestId,
    generated_at: input.generatedAt,
    company_id: input.snapshot.company_id,
    actor: {
      user_id: input.authorization.actorContext.actorUserId,
      permission_snapshot_revision:
        input.authorization.actorContext.permissionSnapshotRevision,
    },
    freshness: {
      read_at: input.snapshot.read_at,
      source_versions: [
        input.snapshot.source_fence,
        input.snapshot.collection_claim.source_version,
        ...retainedClaims.map((claim) => claim.source_version),
      ],
      stale_after: null,
    },
    data: {
      prompt_safety_directive: DISCOVERY_PROMPT_SAFETY_DIRECTIVE,
      gaps: input.snapshot.gaps,
      matches: retainedClaims.map((claim) => claim.raw),
      returned_match_count: retainedClaims.length,
      result_budget_omitted_count: omittedCount,
    },
    evidence: [
      ...input.snapshot.collection_claim.evidence,
      ...retainedClaims.flatMap((claim) => claim.evidence),
    ],
    page: { next_cursor: hasMore ? nextCursor : null, has_more: hasMore },
    warnings: input.characterBounded ? [DISCOVERY_RESULT_BUDGET_WARNING] : [],
  };
}

function parseResult(candidate: unknown): CustomerDiscoveryResult {
  return deepFreeze(CustomerDiscoveryResultSchema.parse(candidate));
}

function reduceToBudget(input: {
  readonly authorization: AuthorizedCustomerDiscoveryRead;
  readonly snapshot: CustomerDiscoverySnapshot;
  readonly generatedAt: string;
}): CustomerDiscoveryResult {
  const full = resultCandidate({
    ...input,
    retainedCount: input.snapshot.match_claims.length,
    characterBounded: false,
  });
  if (
    discoveryPromptSerializedLength(full) <= MAX_DISCOVERY_OUTPUT_CHARACTERS
  ) {
    return parseResult(full);
  }

  let lower = 0;
  let upper = input.snapshot.match_claims.length - 1;
  let best: CustomerDiscoveryResult | null = null;
  let bestCount = -1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const candidate = resultCandidate({
      ...input,
      retainedCount: middle,
      characterBounded: true,
    });
    if (
      middle > 0 &&
      candidate.page.next_cursor !== null &&
      discoveryPromptSerializedLength(candidate) <=
        MAX_DISCOVERY_OUTPUT_CHARACTERS
    ) {
      best = parseResult(candidate);
      bestCount = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  if (best === null || bestCount <= 0) {
    throw new CustomerDiscoveryReadError({
      code: "RESULT_TOO_LARGE",
      requestId: input.authorization.actorContext.requestId,
      retryable: false,
    });
  }
  return best;
}

export async function searchCustomers(input: {
  readonly authorization: AuthorizedCustomerDiscoveryRead;
  readonly repository: CustomerDiscoveryRepository;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<CustomerDiscoveryResult> {
  const authorization = input.authorization;
  if (!isAuthorizedCustomerDiscoveryRead(authorization)) {
    throw new CustomerDiscoveryReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
      retryable: false,
    });
  }
  const repository = input.repository;
  if (!isTrustedCustomerDiscoveryRepository(repository)) {
    throw new CustomerDiscoveryReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const timestamp = generatedAt(input.now);
  if (timestamp === null) {
    throw new CustomerDiscoveryReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }

  let snapshot: CustomerDiscoverySnapshot;
  try {
    snapshot = await repository.read({
      authorization,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    mapRepositoryError(error, authorization);
  }

  try {
    return reduceToBudget({
      authorization,
      snapshot: snapshot!,
      generatedAt: timestamp,
    });
  } catch (error) {
    if (error instanceof CustomerDiscoveryReadError) throw error;
    throw new CustomerDiscoveryReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
      cause: error,
    });
  }
}
