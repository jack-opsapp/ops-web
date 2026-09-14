import { analyticsService, type AnalyticsService } from "./analytics-service";

interface SaveOptions {
  step: "identity" | "company";
  data: Record<string, unknown>;
  durationMs: number;
  getToken: () => Promise<string | null>;
  telemetry?: AnalyticsService | null;
  fetcher?: typeof fetch;
}

async function boundedAuthToken(
  getToken: SaveOptions["getToken"]
): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getToken(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Authentication unavailable")),
          15_000
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Browser acknowledgement is separate from server persistence: a lost
 * response means unconfirmed, even if the server committed the company.
 */
export async function saveSetupStep({
  step,
  data,
  durationMs,
  getToken,
  telemetry = analyticsService,
  fetcher = globalThis.fetch,
}: SaveOptions): Promise<boolean> {
  const attemptId = crypto.randomUUID();
  const context = { step, attempt_key: attemptId.replaceAll("-", "") };
  const track = (...args: Parameters<AnalyticsService["track"]>) => {
    try {
      telemetry?.track(...args);
    } catch {
      /* Diagnostics cannot block setup. */
    }
  };
  track("action", "setup_save_attempted", context);
  let sent = false;
  try {
    const token = await boundedAuthToken(getToken);
    if (!token) {
      track("error", "setup_save_failed", {
        ...context,
        outcome: "not_sent",
        reason: "authentication_unavailable",
      });
      return false;
    }
    sent = true;
    const response = await fetcher("/api/setup/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        step,
        data,
        ...(telemetry
          ? { analytics: { attemptId, sessionId: telemetry.sessionId } }
          : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      track("error", "setup_save_failed", {
        ...context,
        outcome: "rejected",
        status_code: response.status,
      });
      return false;
    }
    const acknowledgement: unknown = await response.json().catch(() => null);
    if (
      !acknowledgement ||
      typeof acknowledgement !== "object" ||
      !("success" in acknowledgement) ||
      acknowledgement.success !== true
    ) {
      track("error", "setup_save_failed", {
        ...context,
        outcome: "unconfirmed",
        reason: "invalid_acknowledgement",
        status_code: response.status,
      });
      return false;
    }
    track("action", "setup_save_acknowledged", context);
    track("action", "setup_step_completed", { step }, durationMs);
    return true;
  } catch {
    track("error", "setup_save_failed", {
      ...context,
      outcome: sent ? "unconfirmed" : "not_sent",
      reason: sent ? "network_or_timeout" : "authentication_unavailable",
    });
    return false;
  }
}
