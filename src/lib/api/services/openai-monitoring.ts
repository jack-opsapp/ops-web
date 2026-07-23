export interface OpenAIQuotaIncidentCapture {
  notificationId: string;
  recipientUserId: string;
  dedupeKey: string;
  incidentVersion: number;
}

export interface OpenAIQuotaErrorMetadata {
  status: number;
  code: string;
  type?: string;
  requestId?: string;
  endpoint?: string;
}

export interface OpenAIQuotaAlertMonitor {
  captureOpenAIQuotaIncident(
    keySource: string
  ): Promise<OpenAIQuotaIncidentCapture | null>;
  reportOpenAIQuotaExhausted(input: {
    keySource: string;
    workload: string;
    errorMetadata?: OpenAIQuotaErrorMetadata;
  }): Promise<void>;
  resolveCapturedOpenAIQuotaIncident(
    capture: OpenAIQuotaIncidentCapture
  ): Promise<void>;
}

interface RecoveryProbeState {
  forceNextLogicalRequest: boolean;
  nextEligibleAt: number;
}

interface CreateMonitoredOpenAIFetchOptions {
  fetchImpl?: typeof fetch;
  keySource: string;
  workload: string;
  monitor?: OpenAIQuotaAlertMonitor;
  now?: () => number;
}

const RECOVERY_PROBE_INTERVAL_MS = 5 * 60 * 1_000;
const recoveryProbeState = new Map<string, RecoveryProbeState>();

const defaultMonitor: OpenAIQuotaAlertMonitor = {
  async captureOpenAIQuotaIncident(keySource) {
    const service =
      await import("@/lib/notifications/openai-quota-alert-service");
    return service.captureOpenAIQuotaIncident(keySource);
  },
  async reportOpenAIQuotaExhausted(input) {
    const service =
      await import("@/lib/notifications/openai-quota-alert-service");
    return service.reportOpenAIQuotaExhausted(input);
  },
  async resolveCapturedOpenAIQuotaIncident(capture) {
    const service =
      await import("@/lib/notifications/openai-quota-alert-service");
    return service.resolveCapturedOpenAIQuotaIncident(capture);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function retryCount(init?: RequestInit): number {
  const raw = new Headers(init?.headers).get("x-stainless-retry-count");
  const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function endpointFor(input: Parameters<typeof fetch>[0]): string | undefined {
  try {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return new URL(raw).pathname;
  } catch {
    return undefined;
  }
}

async function quotaMetadata(
  response: Response,
  input: Parameters<typeof fetch>[0]
): Promise<OpenAIQuotaErrorMetadata | null> {
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return null;
  }

  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  if (payload.error.code !== "insufficient_quota") return null;

  return {
    status: response.status,
    code: "insufficient_quota",
    ...(typeof payload.error.type === "string"
      ? { type: payload.error.type }
      : {}),
    ...(response.headers.get("x-request-id")
      ? { requestId: response.headers.get("x-request-id")! }
      : {}),
    ...(endpointFor(input) ? { endpoint: endpointFor(input) } : {}),
  };
}

function takeRecoveryProbe(
  keySource: string,
  requestRetryCount: number,
  now: number
): boolean {
  // OpenAI's SDK calls fetch again for transport retries. Treat only retry zero
  // as the start of a logical SDK request so a success on an internal retry
  // cannot resolve an incident opened by an earlier attempt of that same call.
  if (requestRetryCount !== 0) return false;

  const state = recoveryProbeState.get(keySource) ?? {
    forceNextLogicalRequest: false,
    nextEligibleAt: 0,
  };
  if (!state.forceNextLogicalRequest && now < state.nextEligibleAt) {
    recoveryProbeState.set(keySource, state);
    return false;
  }

  recoveryProbeState.set(keySource, {
    forceNextLogicalRequest: false,
    nextEligibleAt: now + RECOVERY_PROBE_INTERVAL_MS,
  });
  return true;
}

function forceNextRecoveryProbe(keySource: string): void {
  const state = recoveryProbeState.get(keySource) ?? {
    forceNextLogicalRequest: false,
    nextEligibleAt: 0,
  };
  recoveryProbeState.set(keySource, {
    ...state,
    forceNextLogicalRequest: true,
  });
}

export function isOpenAIInsufficientQuotaError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.code === "insufficient_quota") return true;
  return isRecord(error.error) && error.error.code === "insufficient_quota";
}

const AI_PROVIDER_UNAVAILABLE_ERROR_NAMES = new Set([
  "APIConnectionError",
  "APIConnectionTimeoutError",
]);

const MAX_PROVIDER_CAUSE_DEPTH = 3;

function isProviderOutageStatus(status: unknown): boolean {
  if (typeof status !== "number") return false;
  return (
    status === 429 ||
    status === 401 ||
    status === 403 ||
    (status >= 500 && status <= 599)
  );
}

// `*ContractError` / `*RefusalError` mean the model answered but its answer was
// unusable for one thread; `LifecyclePersistenceError` is our own DB write
// failure. Neither is a provider outage — a node carrying such a name never
// signals unavailability itself, but the walk continues so a genuine provider
// error wrapped as its `.cause` is still surfaced.
function isModelAnsweredOrPersistenceName(name: unknown): boolean {
  return (
    typeof name === "string" &&
    (name === "LifecyclePersistenceError" ||
      name.endsWith("ContractError") ||
      name.endsWith("RefusalError"))
  );
}

/**
 * True when `error` — or a provider error up to three `.cause` links deep —
 * means the OpenAI call did not complete for reasons outside our data:
 * insufficient quota, a provider outage (HTTP 5xx), rate limiting past the SDK's
 * own retries (429), a missing/rejected key (401/403), or an SDK transport
 * failure (`APIConnectionError` / `APIConnectionTimeoutError`, matched by name
 * because `instanceof` is unreliable across the SDK boundary). The sync cycle
 * treats these as deferrable and lets the Gmail cursor advance.
 *
 * Returns false for our own `LifecyclePersistenceError` (a real persistence
 * failure that must hold the cursor for idempotent replay) and for
 * model-answered-but-unusable errors (`*ContractError` / `*RefusalError`). Those
 * names gate a node out of the positive checks but do not stop the walk, so a
 * contract error wrapping a genuine quota cause is still reported unavailable.
 */
export function isAIProviderUnavailableError(error: unknown): boolean {
  let node: unknown = error;
  for (let depth = 0; depth <= MAX_PROVIDER_CAUSE_DEPTH; depth += 1) {
    if (!isRecord(node)) return false;

    if (!isModelAnsweredOrPersistenceName(node.name)) {
      if (isOpenAIInsufficientQuotaError(node)) return true;
      if (isProviderOutageStatus(node.status)) return true;
      if (
        typeof node.name === "string" &&
        AI_PROVIDER_UNAVAILABLE_ERROR_NAMES.has(node.name)
      ) {
        return true;
      }
    }

    node = node.cause;
  }
  return false;
}

export function isOpenAIRetryableRateLimitError(error: unknown): boolean {
  if (isOpenAIInsufficientQuotaError(error)) return false;
  if (isRecord(error) && error.status === 429) return true;
  return (
    error instanceof Error &&
    /rate.?limit|429|tpm|too many requests/i.test(error.message)
  );
}

export function createMonitoredOpenAIFetch({
  fetchImpl = globalThis.fetch,
  keySource,
  workload,
  monitor = defaultMonitor,
  now = Date.now,
}: CreateMonitoredOpenAIFetchOptions): typeof fetch {
  return async (input, init) => {
    let capture: OpenAIQuotaIncidentCapture | null = null;
    if (takeRecoveryProbe(keySource, retryCount(init), now())) {
      try {
        capture = await monitor.captureOpenAIQuotaIncident(keySource);
      } catch {
        forceNextRecoveryProbe(keySource);
        // Monitoring is deliberately fail-open. Model traffic must retain its
        // original success/error semantics when the alert store is unavailable.
      }
    }

    const response = await fetchImpl(input, init);
    if (response.ok) {
      if (capture) {
        try {
          await monitor.resolveCapturedOpenAIQuotaIncident(capture);
        } catch {
          forceNextRecoveryProbe(keySource);
          // The next eligible request retries exact resolution of a still-open
          // incident. Never change a successful OpenAI response into an OPS error.
        }
      }
      return response;
    }

    const metadata = await quotaMetadata(response, input);
    if (!metadata) return response;

    forceNextRecoveryProbe(keySource);
    try {
      await monitor.reportOpenAIQuotaExhausted({
        keySource,
        workload,
        errorMetadata: metadata,
      });
    } catch {
      // Preserve the provider's exact error response for the OpenAI SDK.
    }
    return response;
  };
}

export function resetOpenAIRecoveryProbeStateForTests(): void {
  recoveryProbeState.clear();
}
