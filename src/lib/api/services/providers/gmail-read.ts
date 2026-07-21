import { ProviderApiError, type ProviderReadPolicy } from "../email-provider";

const GMAIL_READ_MAX_ATTEMPTS = 4;
const GMAIL_READ_INITIAL_BACKOFF_MS = 1_000;
const GMAIL_READ_MAX_BACKOFF_MS = 8_000;
const GMAIL_READ_JITTER_MS = 1_000;
const GMAIL_READ_DEFAULT_DEADLINE_MS = 45_000;

export const GMAIL_READ_CONCURRENCY = 5;
export const GMAIL_READ_BATCH_DELAY_MS = 250;

const RETRYABLE_GMAIL_READ_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_GMAIL_403_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

type GmailReadRequestInit = Omit<RequestInit, "body" | "method">;

export type GmailReadPolicy = ProviderReadPolicy;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function combineReadSignals(
  callerSignal: AbortSignal | null | undefined,
  deadlineSignal: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  if (!callerSignal) {
    return { signal: deadlineSignal, cleanup: () => undefined };
  }

  const controller = new AbortController();
  const forwardAbort = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  const onCallerAbort = () => forwardAbort(callerSignal);
  const onDeadlineAbort = () => forwardAbort(deadlineSignal);

  if (callerSignal.aborted) {
    forwardAbort(callerSignal);
  } else {
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }
  if (deadlineSignal.aborted) {
    forwardAbort(deadlineSignal);
  } else {
    deadlineSignal.addEventListener("abort", onDeadlineAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      callerSignal.removeEventListener("abort", onCallerAbort);
      deadlineSignal.removeEventListener("abort", onDeadlineAbort);
    },
  };
}

function retryAfterMilliseconds(response: Response): number | null {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const retryAt = Date.parse(raw);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - Date.now());
}

function retryDelayMilliseconds(response: Response | null, attempt: number) {
  const exponential = Math.min(
    GMAIL_READ_INITIAL_BACKOFF_MS * 2 ** attempt,
    GMAIL_READ_MAX_BACKOFF_MS
  );
  const jitter = Math.floor(Math.random() * GMAIL_READ_JITTER_MS);
  const retryAfter = response ? retryAfterMilliseconds(response) : null;
  return Math.max(exponential + jitter, retryAfter ?? 0);
}

function defaultContext(input: string | URL): string {
  try {
    const url = new URL(String(input));
    return `GET ${url.pathname}${url.search}`;
  } catch {
    return `GET ${String(input)}`;
  }
}

async function readProviderBody(response: Response): Promise<unknown> {
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    if (isGmailReadDeadlineError(error)) throw error;
    raw = "";
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function providerMessage(body: unknown, status: number): string {
  const message = (
    body as {
      error?: { message?: string };
    }
  )?.error?.message;
  return message ?? `read failed (status ${status})`;
}

async function throwRetryableResponse(
  response: Response,
  context: string
): Promise<never> {
  const body = await readProviderBody(response);
  throw new ProviderApiError(
    `Gmail ${context}: ${providerMessage(body, response.status)}`,
    response.status,
    body
  );
}

function readDeadlineError(
  context: string,
  deadlineAt: number
): ProviderApiError {
  return new ProviderApiError(`Gmail ${context}: read deadline exceeded`, 504, {
    reason: "gmail_read_deadline_exceeded",
    deadlineAt,
  });
}

function throwReadDeadline(context: string, deadlineAt: number): never {
  throw readDeadlineError(context, deadlineAt);
}

function assertReadDeadline(policy: GmailReadPolicy, fallbackContext: string) {
  if (policy.deadlineAt === undefined) return;
  if (Date.now() >= policy.deadlineAt) {
    throwReadDeadline(policy.context ?? fallbackContext, policy.deadlineAt);
  }
}

function remainingDeadlineMilliseconds(policy: GmailReadPolicy): number | null {
  if (policy.deadlineAt === undefined) return null;
  return policy.deadlineAt - Date.now();
}

function throwRetryableNetworkError(error: unknown, context: string): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new ProviderApiError(`Gmail ${context}: ${message}`, 503, {
    cause: message,
  });
}

async function isRetryableGmailReadResponse(
  response: Response
): Promise<boolean> {
  if (RETRYABLE_GMAIL_READ_STATUSES.has(response.status)) return true;
  if (response.status !== 403) return false;

  try {
    const body = (await response.clone().json()) as {
      error?: { errors?: Array<{ reason?: string }> };
    };
    return Boolean(
      body.error?.errors?.some((entry) =>
        entry.reason ? RETRYABLE_GMAIL_403_REASONS.has(entry.reason) : false
      )
    );
  } catch {
    return false;
  }
}

function isRetryableGmailReadError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  return error.name !== "AbortError" && error.name !== "TimeoutError";
}

export function isGmailReadDeadlineError(error: unknown): boolean {
  return (
    error instanceof ProviderApiError &&
    error.providerStatus === 504 &&
    (error.providerBody as { reason?: string } | undefined)?.reason ===
      "gmail_read_deadline_exceeded"
  );
}

function bindResponseBodyToDeadline(
  response: Response,
  deadlineSignal: AbortSignal,
  context: string,
  deadlineAt: number,
  cleanup: () => void
): Response {
  if (response.body === null) {
    cleanup();
    return response;
  }

  const reader = response.body.getReader();
  let finished = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const releaseReader = () => {
    try {
      reader.releaseLock();
    } catch {
      // A pending read owns the lock until cancellation settles.
    }
  };
  const finish = () => {
    if (finished) return false;
    finished = true;
    deadlineSignal.removeEventListener("abort", onDeadline);
    cleanup();
    return true;
  };
  const onDeadline = () => {
    if (!finish()) return;
    controllerRef?.error(readDeadlineError(context, deadlineAt));
    void reader
      .cancel(deadlineSignal.reason)
      .catch(() => undefined)
      .finally(releaseReader);
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      if (deadlineSignal.aborted) {
        onDeadline();
      } else {
        deadlineSignal.addEventListener("abort", onDeadline, { once: true });
      }
    },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (finished) return;
        if (next.done) {
          finish();
          releaseReader();
          controller.close();
          return;
        }
        if (next.value) controller.enqueue(next.value);
      } catch (error) {
        if (!finish()) return;
        releaseReader();
        controller.error(
          deadlineSignal.aborted
            ? readDeadlineError(context, deadlineAt)
            : error
        );
      }
    },
    async cancel(reason) {
      if (!finish()) return;
      try {
        await reader.cancel(reason);
      } finally {
        releaseReader();
      }
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Execute exactly one provider request under an absolute Gmail read deadline.
 * The returned response body remains attached to the same timer until the
 * source stream completes or is cancelled. This helper never retries and is
 * therefore safe for the OAuth refresh POST used to authorize an otherwise-
 * idempotent Gmail read.
 */
export async function fetchGmailOnceWithinDeadline(
  input: string | URL,
  init: RequestInit = {},
  policy: GmailReadPolicy = {}
): Promise<Response> {
  const effectivePolicy: GmailReadPolicy = {
    ...policy,
    deadlineAt:
      policy.deadlineAt ?? Date.now() + GMAIL_READ_DEFAULT_DEADLINE_MS,
  };
  const context = effectivePolicy.context ?? defaultContext(input);

  assertReadDeadline(effectivePolicy, context);
  const remaining = remainingDeadlineMilliseconds(effectivePolicy);
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(
    () =>
      deadlineController.abort(
        new DOMException("Gmail read deadline exceeded", "TimeoutError")
      ),
    Math.max(1, remaining ?? GMAIL_READ_DEFAULT_DEADLINE_MS)
  );
  const combinedSignals = combineReadSignals(
    init.signal,
    deadlineController.signal
  );
  let cleanupTransferred = false;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(deadlineTimer);
    combinedSignals.cleanup();
  };

  try {
    const response = await fetch(input, {
      ...init,
      signal: combinedSignals.signal,
    });
    assertReadDeadline(effectivePolicy, context);
    const boundedResponse = bindResponseBodyToDeadline(
      response,
      deadlineController.signal,
      context,
      effectivePolicy.deadlineAt!,
      cleanup
    );
    cleanupTransferred = true;
    return boundedResponse;
  } catch (error) {
    if (deadlineController.signal.aborted) {
      throwReadDeadline(context, effectivePolicy.deadlineAt!);
    }
    throw error;
  } finally {
    if (!cleanupTransferred) cleanup();
  }
}

/**
 * Execute an idempotent Gmail GET with bounded backoff. This helper cannot
 * accept a method or body by design, so provider mutations and sends never
 * inherit automatic retries.
 */
export async function fetchGmailRead(
  input: string | URL,
  init: GmailReadRequestInit = {},
  policy: GmailReadPolicy = {}
): Promise<Response> {
  const effectivePolicy: GmailReadPolicy = {
    ...policy,
    deadlineAt:
      policy.deadlineAt ?? Date.now() + GMAIL_READ_DEFAULT_DEADLINE_MS,
  };
  const context = effectivePolicy.context ?? defaultContext(input);

  for (let attempt = 0; attempt < GMAIL_READ_MAX_ATTEMPTS; attempt += 1) {
    assertReadDeadline(effectivePolicy, context);

    let response: Response;
    try {
      response = await fetchGmailOnceWithinDeadline(
        input,
        {
          ...init,
          method: "GET",
        },
        effectivePolicy
      );
    } catch (error) {
      if (isGmailReadDeadlineError(error)) throw error;
      if (
        attempt === GMAIL_READ_MAX_ATTEMPTS - 1 ||
        !isRetryableGmailReadError(error)
      ) {
        if (isRetryableGmailReadError(error)) {
          throwRetryableNetworkError(error, context);
        }
        throw error;
      }
      const delay = retryDelayMilliseconds(null, attempt);
      const remaining = remainingDeadlineMilliseconds(effectivePolicy);
      if (remaining !== null && delay >= remaining) {
        throwReadDeadline(context, effectivePolicy.deadlineAt!);
      }
      await sleep(delay);
      continue;
    }

    if (!(await isRetryableGmailReadResponse(response))) {
      assertReadDeadline(effectivePolicy, context);
      return response;
    }

    if (attempt === GMAIL_READ_MAX_ATTEMPTS - 1) {
      return throwRetryableResponse(response, context);
    }

    const delay = retryDelayMilliseconds(response, attempt);
    const remaining = remainingDeadlineMilliseconds(effectivePolicy);
    if (remaining !== null && delay >= remaining) {
      return throwRetryableResponse(response, context);
    }
    await response.body?.cancel().catch(() => undefined);
    await sleep(delay);
  }

  throw new Error("Gmail read retry loop exhausted without a response");
}

/**
 * Map Gmail read work in paced groups. Result order matches input order and no
 * partial result escapes if a mapper fails, preserving cursor safety.
 */
export async function mapGmailReads<T, R>(
  items: readonly T[],
  mapper: (
    item: T,
    index: number,
    policy: Readonly<GmailReadPolicy>
  ) => Promise<R>,
  options: {
    deadlineAt?: number;
    context?: string;
    onBatchComplete?: (
      batchResults: readonly R[],
      completedItems: number
    ) => void | Promise<void>;
  } = {}
): Promise<R[]> {
  const results: R[] = [];
  const policy: Readonly<GmailReadPolicy> = {
    deadlineAt:
      options.deadlineAt ?? Date.now() + GMAIL_READ_DEFAULT_DEADLINE_MS,
    context: options.context,
  };
  const context = options.context ?? "paced read batch";

  for (
    let offset = 0;
    offset < items.length;
    offset += GMAIL_READ_CONCURRENCY
  ) {
    assertReadDeadline(policy, context);
    const batch = items.slice(offset, offset + GMAIL_READ_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => mapper(item, offset + batchIndex, policy))
    );
    results.push(...batchResults);

    await options.onBatchComplete?.(
      batchResults,
      Math.min(offset + batch.length, items.length)
    );

    if (offset + GMAIL_READ_CONCURRENCY < items.length) {
      const remaining = remainingDeadlineMilliseconds(policy);
      if (remaining !== null && GMAIL_READ_BATCH_DELAY_MS >= remaining) {
        throwReadDeadline(context, policy.deadlineAt!);
      }
      await sleep(GMAIL_READ_BATCH_DELAY_MS);
    }
  }

  return results;
}
