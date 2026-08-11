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

import { createHash } from "crypto";

const ONESIGNAL_API_URL = "https://onesignal.com/api/v1/notifications";

// ─── Types ───────────────────────────────────────────────────────────────────

export type OneSignalPushTarget =
  | {
      /** OneSignal subscription IDs (`onesignal_player_id` column on users). */
      playerIds: string[];
      externalUserIds?: never;
    }
  | {
      /**
       * OneSignal `external_id` aliases. Both clients register the Supabase
       * `users.id` as the external id (iOS `OneSignal.login(userId)`), so this
       * targets users directly without a player-id lookup or staleness risk.
       */
      externalUserIds: string[];
      playerIds?: never;
    };

export type SendOneSignalPushParams = OneSignalPushTarget & {
  /** Push title. Keep under 60 characters for all-device readability. */
  title: string;
  /** Push body. Keep under 100 characters. */
  body: string;
  /** Custom data payload delivered to the app. */
  data: Record<string, unknown>;
  /** iOS badge increment (default: 1). Pass 0 to skip badge update. */
  iosBadgeIncrement?: number;
  /**
   * OneSignal idempotency key — must be UUID-shaped. Reused across the
   * in-helper 5xx/network retries so a delivered-but-unacknowledged send is
   * never duplicated. Derive from a stable seed via
   * `deterministicIdempotencyKey` for cron-fired notifications.
   */
  idempotencyKey?: string;
};

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
    headings: { en: params.title },
    contents: { en: params.body },
    data: params.data,
  };
  if (params.externalUserIds) {
    body.include_aliases = { external_id: params.externalUserIds };
    // Alias targeting requires an explicit delivery channel per the API.
    body.target_channel = "push";
  } else {
    body.include_player_ids = params.playerIds;
  }
  if (params.idempotencyKey) {
    body.idempotency_key = params.idempotencyKey;
  }
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
 * Derive a stable, UUID-shaped OneSignal idempotency key from a seed.
 *
 * OneSignal requires `idempotency_key` to be a UUID, but cron-fired sends need
 * determinism (same logical prompt → same key across retries and re-runs), so
 * this hashes the seed and formats the digest with RFC 9562 version/variant
 * bits rather than generating a random UUID.
 */
export function deterministicIdempotencyKey(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  digest[6] = (digest[6] & 0x0f) | 0x40; // version 4 nibble
  digest[8] = (digest[8] & 0x3f) | 0x80; // RFC 9562 variant
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

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

  const targetCount = params.externalUserIds
    ? params.externalUserIds.length
    : params.playerIds.length;
  if (targetCount === 0) {
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
