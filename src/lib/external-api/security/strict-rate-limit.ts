import "server-only";

import type { CredentialGrant } from "../contracts/common";

export type ExternalApiRateLimitWindow = Readonly<{
  name: "burst" | "minute" | "day";
  limit: number;
  durationMs: number;
}>;

export type ExternalApiRateLimitDecision = Readonly<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}>;

export const PRE_AUTH_WINDOWS = Object.freeze([
  Object.freeze({ name: "burst", limit: 30, durationMs: 10_000 }),
  Object.freeze({ name: "minute", limit: 120, durationMs: 60_000 }),
]) satisfies readonly ExternalApiRateLimitWindow[];

export const AUTHENTICATED_PRINCIPAL_WINDOWS = Object.freeze({
  intake: Object.freeze([
    Object.freeze({ name: "burst", limit: 20, durationMs: 10_000 }),
    Object.freeze({ name: "minute", limit: 120, durationMs: 60_000 }),
    Object.freeze({ name: "day", limit: 5_000, durationMs: 86_400_000 }),
  ]),
  analytics: Object.freeze([
    Object.freeze({ name: "burst", limit: 10, durationMs: 10_000 }),
    Object.freeze({ name: "minute", limit: 60, durationMs: 60_000 }),
    Object.freeze({ name: "day", limit: 2_000, durationMs: 86_400_000 }),
  ]),
}) satisfies Readonly<
  Record<
    CredentialGrant["credentialClass"],
    readonly ExternalApiRateLimitWindow[]
  >
>;

export const AUTHENTICATED_COMPANY_WINDOWS = Object.freeze([
  Object.freeze({ name: "burst", limit: 60, durationMs: 10_000 }),
  Object.freeze({ name: "minute", limit: 300, durationMs: 60_000 }),
  Object.freeze({ name: "day", limit: 12_000, durationMs: 86_400_000 }),
]) satisfies readonly ExternalApiRateLimitWindow[];

const REDIS_ATOMIC_WINDOW_SCRIPT = `
local now = redis.call("TIME")
local now_ms = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
local output = {}
for index = 1, #KEYS do
  local duration_ms = tonumber(ARGV[index])
  local bucket = math.floor(now_ms / duration_ms)
  local key = KEYS[index] .. ":" .. bucket
  local count = redis.call("INCR", key)
  if count == 1 then
    redis.call("PEXPIRE", key, duration_ms)
  end
  local ttl = redis.call("PTTL", key)
  table.insert(output, count)
  table.insert(output, ttl)
end
return output
`.trim();

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

type RateLimitCheck = Readonly<{
  scope: string;
  identity: string;
  windows: readonly ExternalApiRateLimitWindow[];
}>;

export class RateLimitUnavailableError extends Error {
  readonly code = "rate_limit_unavailable" as const;
  readonly status = 503;

  constructor() {
    super("rate_limit_unavailable");
    this.name = "RateLimitUnavailableError";
  }
}

export interface StrictExternalApiRateLimiter {
  checkPreAuth(input: {
    networkFingerprint: string;
    presentedPrefix: string;
  }): Promise<ExternalApiRateLimitDecision>;
  checkAuthenticated(input: {
    credentialClass: CredentialGrant["credentialClass"];
    principalIdentity: string;
    companyIdentity: string;
  }): Promise<ExternalApiRateLimitDecision>;
}

function safeIdentity(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,160}$/.test(value);
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function responseClassIsJson(response: Response): boolean {
  return (
    response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json") ?? false
  );
}

export function createStrictRateLimiter(config: {
  url: string | undefined;
  token: string | undefined;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
}): StrictExternalApiRateLimiter {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 1_500;

  async function check(
    checks: readonly RateLimitCheck[]
  ): Promise<ExternalApiRateLimitDecision> {
    const url = config.url ? safeUrl(config.url) : null;
    if (
      !url ||
      !config.token ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 10_000 ||
      checks.length < 1
    ) {
      throw new RateLimitUnavailableError();
    }

    const keys: string[] = [];
    const limits: number[] = [];
    const durations: number[] = [];
    for (const checkItem of checks) {
      if (
        !safeIdentity(checkItem.scope) ||
        !safeIdentity(checkItem.identity) ||
        checkItem.windows.length < 1
      ) {
        throw new RateLimitUnavailableError();
      }
      for (const window of checkItem.windows) {
        if (
          !Number.isInteger(window.limit) ||
          window.limit < 1 ||
          !Number.isInteger(window.durationMs) ||
          window.durationMs < 1_000
        ) {
          throw new RateLimitUnavailableError();
        }
        keys.push(
          `ops:external:v1:${checkItem.scope}:${checkItem.identity}:${window.name}`
        );
        limits.push(window.limit);
        durations.push(window.durationMs);
      }
    }

    const command: string[] = [
      "EVAL",
      REDIS_ATOMIC_WINDOW_SCRIPT,
      String(keys.length),
      ...keys,
    ];
    command.push(...durations.map(String));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(command),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      throw new RateLimitUnavailableError();
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok || !responseClassIsJson(response)) {
      throw new RateLimitUnavailableError();
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RateLimitUnavailableError();
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray((payload as { result?: unknown }).result)
    ) {
      throw new RateLimitUnavailableError();
    }
    const result = (payload as { result: unknown[] }).result;
    if (result.length !== keys.length * 2) {
      throw new RateLimitUnavailableError();
    }

    let allowed = true;
    let remaining = Number.POSITIVE_INFINITY;
    let retryAfterMs = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const count = Number(result[index * 2]);
      const ttl = Number(result[index * 2 + 1]);
      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        !Number.isFinite(ttl) ||
        ttl < 0
      ) {
        throw new RateLimitUnavailableError();
      }
      const windowRemaining = Math.max(0, limits[index] - count);
      remaining = Math.min(remaining, windowRemaining);
      if (count > limits[index]) {
        allowed = false;
        retryAfterMs = Math.max(retryAfterMs, ttl);
      }
    }

    return Object.freeze({
      allowed,
      remaining: remaining === Number.POSITIVE_INFINITY ? 0 : remaining,
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
    });
  }

  const limiter: StrictExternalApiRateLimiter = {
    checkPreAuth(input) {
      const combinedIdentity = `${input.networkFingerprint}.${input.presentedPrefix}`;
      return check([
        {
          scope: "preauth_network",
          identity: input.networkFingerprint,
          windows: PRE_AUTH_WINDOWS,
        },
        {
          scope: "preauth_prefix",
          identity: combinedIdentity,
          windows: PRE_AUTH_WINDOWS,
        },
      ]);
    },
    checkAuthenticated(input) {
      return check([
        {
          scope: "principal",
          identity: input.principalIdentity,
          windows: AUTHENTICATED_PRINCIPAL_WINDOWS[input.credentialClass],
        },
        {
          scope: "company",
          identity: input.companyIdentity,
          windows: AUTHENTICATED_COMPANY_WINDOWS,
        },
      ]);
    },
  };
  return Object.freeze(limiter);
}

export function createConfiguredStrictRateLimiter(): StrictExternalApiRateLimiter {
  return createStrictRateLimiter({
    url: process.env.EXTERNAL_API_REDIS_REST_URL,
    token: process.env.EXTERNAL_API_REDIS_REST_TOKEN,
  });
}
