import "server-only";

export class P2RepositoryBoundaryError extends Error {
  readonly code:
    | "P2_REPOSITORY_UNTRUSTED"
    | "P2_REPOSITORY_ABORTED"
    | "P2_REPOSITORY_READ_FAILED"
    | "P2_REPOSITORY_RESULT_INVALID";

  constructor(code: P2RepositoryBoundaryError["code"]) {
    super(code);
    this.name = "P2RepositoryBoundaryError";
    this.code = code;
  }
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new P2RepositoryBoundaryError("P2_REPOSITORY_ABORTED");
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

/**
 * Applies abort, nominal-repository, strict-parse, and error-containment rules
 * without ever minting or weakening a domain repository brand.
 */
export async function readThroughP2RepositoryBoundary<
  TRepository,
  TRaw,
  TResult,
>(input: {
  readonly repository: unknown;
  readonly isTrusted: (value: unknown) => value is TRepository;
  readonly signal?: AbortSignal;
  readonly read: (
    repository: TRepository,
    signal?: AbortSignal
  ) => TRaw | Promise<TRaw>;
  readonly parse: (raw: TRaw) => TResult;
}): Promise<TResult> {
  let repository: TRepository;
  try {
    if (!input.isTrusted(input.repository)) {
      throw new TypeError("untrusted");
    }
    repository = input.repository;
  } catch {
    throw new P2RepositoryBoundaryError("P2_REPOSITORY_UNTRUSTED");
  }
  aborted(input.signal);

  let raw: TRaw;
  try {
    raw = await input.read(repository, input.signal);
  } catch {
    aborted(input.signal);
    throw new P2RepositoryBoundaryError("P2_REPOSITORY_READ_FAILED");
  }
  aborted(input.signal);

  let parsed: TResult;
  try {
    parsed = input.parse(raw);
  } catch {
    aborted(input.signal);
    throw new P2RepositoryBoundaryError("P2_REPOSITORY_RESULT_INVALID");
  }
  aborted(input.signal);
  try {
    return deepFreeze(parsed);
  } catch {
    throw new P2RepositoryBoundaryError("P2_REPOSITORY_RESULT_INVALID");
  }
}
