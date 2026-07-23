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

// OpenAI populates `code` inconsistently for org/billing quota errors — the
// stable signal is `type: "insufficient_quota"`. Match either field so a
// real exhaustion is never missed (2026-07-22 outage: type-only, code null).
function hasInsufficientQuotaSignal(
  errorLike: Record<string, unknown>
): boolean {
  return (
    errorLike.code === "insufficient_quota" ||
    errorLike.type === "insufficient_quota"
  );
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
  if (!hasInsufficientQuotaSignal(payload.error)) return null;

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
  if (hasInsufficientQuotaSignal(error)) return true;
  return isRecord(error.error) && hasInsufficientQuotaSignal(error.error);
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
