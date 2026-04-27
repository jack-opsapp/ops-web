/**
 * OPS Web — OneSignal REST push helper.
 *
 * Server-side only. Wraps the OneSignal Create Notification endpoint with:
 *   - Retry: exponential backoff 1s → 5s on 5xx / network errors.
 *   - Structured error categorization: 4xx are non-retryable (logged, swallowed).
 *     5xx and network errors trigger up to 3 attempts.
 *   - Empty-list guard: returns immediately if playerIds is empty.
 *   - Env guard: logs a warning and returns if ONESIGNAL_APP_ID or
 *     ONESIGNAL_REST_API_KEY are absent (safe for local dev without keys).
 *
 * Callers rely on the web notification rail as the authoritative record.
 * Push is best-effort: failures are logged, never re-thrown.
 */

import "server-only";

const ONESIGNAL_API_URL = "https://onesignal.com/api/v1/notifications";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SendOneSignalPushParams {
  /** OneSignal subscription IDs (`onesignal_player_id` column on users). */
  playerIds: string[];
  /** Push title. Keep under 60 characters for all-device readability. */
  title: string;
  /** Push body. Keep under 100 characters. */
  body: string;
  /** Custom data payload delivered to the app. */
  data: Record<string, unknown>;
  /** iOS badge increment (default: 1). Pass 0 to skip badge update. */
  iosBadgeIncrement?: number;
}

export type OneSignalErrorCategory =
  | "non_retryable"   // 4xx — bad request, invalid player_ids, auth failure
  | "retryable"       // 5xx — OneSignal server error
  | "network"         // fetch threw — DNS, timeout, connection refused
  | "env_missing";    // env vars absent

export interface OneSignalResult {
  ok: boolean;
  category?: OneSignalErrorCategory;
  status?: number;
  message?: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Retry with exponential delay: 1s, 5s between attempts (1s * 5^i).
 * Only retries on `retryable` or `network` categories.
 * Returns the final result regardless of outcome.
 */
async function withRetry(
  fn: () => Promise<OneSignalResult>,
  attempts = 3
): Promise<OneSignalResult> {
  let last: OneSignalResult = { ok: false, category: "retryable" };
  for (let i = 0; i < attempts; i++) {
    last = await fn().catch((e): OneSignalResult => ({
      ok: false,
      category: "network",
      message: errorMessage(e),
    }));
    if (last.ok) return last;
    if (last.category === "non_retryable" || last.category === "env_missing") {
      return last; // no retry for these
    }
    if (i < attempts - 1) {
      const waitMs = Math.pow(5, i) * 1000; // 1s, 5s
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return last;
}

async function postToOneSignal(
  params: SendOneSignalPushParams,
  appId: string,
  apiKey: string
): Promise<OneSignalResult> {
  const badgeIncrement = params.iosBadgeIncrement ?? 1;
  const body: Record<string, unknown> = {
    app_id: appId,
    include_player_ids: params.playerIds,
    headings: { en: params.title },
    contents: { en: params.body },
    data: params.data,
  };
  if (badgeIncrement > 0) {
    body.ios_badgeType = "Increase";
    body.ios_badgeCount = badgeIncrement;
  }

  let res: Response;
  try {
    res = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, category: "network", message: errorMessage(e) };
  }

  if (res.ok) return { ok: true, status: res.status };

  const errorText = await res.text().catch(() => "");
  const category: OneSignalErrorCategory =
    res.status >= 500 ? "retryable" : "non_retryable";

  return {
    ok: false,
    category,
    status: res.status,
    message: errorText.slice(0, 300), // truncate for structured logging
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a push notification to one or more OneSignal subscribers.
 *
 * Always resolves — never throws. Failures are logged with category context
 * so callers can triage 4xx (bad player_ids) vs 5xx (OneSignal outage) vs
 * network errors separately in logs.
 *
 * @returns OneSignalResult — inspectable by callers that want to log outcomes.
 */
export async function sendOneSignalPush(
  params: SendOneSignalPushParams
): Promise<OneSignalResult> {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey) {
    console.warn(
      "[onesignal] ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY missing — push skipped"
    );
    return { ok: false, category: "env_missing", message: "env vars absent" };
  }

  if (params.playerIds.length === 0) {
    return { ok: true }; // no-op, not an error
  }

  const result = await withRetry(() => postToOneSignal(params, appId, apiKey));

  if (!result.ok) {
    console.error(
      `[onesignal] push failed [${result.category}] status=${result.status ?? "N/A"}: ${result.message ?? ""}`
    );
  }

  return result;
}
