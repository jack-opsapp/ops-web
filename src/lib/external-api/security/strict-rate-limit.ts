import "server-only";

import { z } from "zod";

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

type RateLimitScope =
  | "preauth_network"
  | "preauth_prefix"
  | "principal_intake"
  | "principal_analytics"
  | "company";

type RateLimitCheck = Readonly<{
  scope: RateLimitScope;
  identity: string;
}>;

export interface ExternalApiRateLimitRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

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

const decisionSchema = z
  .object({
    allowed: z.boolean(),
    remaining: z.number().int().min(0).max(12_000),
    retry_after_seconds: z.number().int().min(0).max(86_400),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.allowed && value.retry_after_seconds !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retry_after_seconds"],
        message: "Allowed decisions cannot require a retry delay",
      });
    }
    if (!value.allowed && value.retry_after_seconds < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retry_after_seconds"],
        message: "Denied decisions require a retry delay",
      });
    }
  });

function safeIdentity(check: RateLimitCheck): boolean {
  if (check.scope === "preauth_prefix") {
    return /^[A-Za-z0-9_-]{43}\.(?:missing|malformed|opsx_[1-9][0-9]{0,4}_[A-Za-z0-9_-]{12})$/.test(
      check.identity
    );
  }
  return /^[A-Za-z0-9_-]{43}$/.test(check.identity);
}

function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new RateLimitUnavailableError()),
      timeoutMs
    );
    Promise.resolve(operation).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        reject(new RateLimitUnavailableError());
      }
    );
  });
}

export function createStrictRateLimiter(config: {
  client: ExternalApiRateLimitRpcClient | undefined;
  timeoutMs?: number;
}): StrictExternalApiRateLimiter {
  const timeoutMs = config.timeoutMs ?? 1_500;

  async function check(
    checks: readonly RateLimitCheck[]
  ): Promise<ExternalApiRateLimitDecision> {
    if (
      !config.client ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 10_000 ||
      checks.length < 1 ||
      checks.length > 2 ||
      checks.some((item) => !safeIdentity(item))
    ) {
      throw new RateLimitUnavailableError();
    }

    let response: { data: unknown; error: unknown };
    try {
      response = await withTimeout(
        config.client.rpc(
          "consume_external_api_rate_limits_as_system",
          { p_checks: checks }
        ),
        timeoutMs
      );
    } catch {
      throw new RateLimitUnavailableError();
    }
    if (response.error) {
      throw new RateLimitUnavailableError();
    }

    const parsed = decisionSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new RateLimitUnavailableError();
    }
    return Object.freeze({
      allowed: parsed.data.allowed,
      remaining: parsed.data.remaining,
      retryAfterSeconds: parsed.data.retry_after_seconds,
    });
  }

  return Object.freeze({
    checkPreAuth(input) {
      return check([
        {
          scope: "preauth_network",
          identity: input.networkFingerprint,
        },
        {
          scope: "preauth_prefix",
          identity: `${input.networkFingerprint}.${input.presentedPrefix}`,
        },
      ]);
    },
    checkAuthenticated(input) {
      return check([
        {
          scope:
            input.credentialClass === "intake"
              ? "principal_intake"
              : "principal_analytics",
          identity: input.principalIdentity,
        },
        {
          scope: "company",
          identity: input.companyIdentity,
        },
      ]);
    },
  });
}

export function createConfiguredStrictRateLimiter(
  client: ExternalApiRateLimitRpcClient
): StrictExternalApiRateLimiter {
  return createStrictRateLimiter({ client });
}

export async function purgeExpiredExternalApiRateLimitWindows(
  client: ExternalApiRateLimitRpcClient,
  options: { limit?: number; timeoutMs?: number } = {}
): Promise<number> {
  const limit = options.limit ?? 1_000;
  const timeoutMs = options.timeoutMs ?? 1_500;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 5_000 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10_000
  ) {
    throw new RateLimitUnavailableError();
  }

  let response: { data: unknown; error: unknown };
  try {
    response = await withTimeout(
      client.rpc("purge_external_api_rate_limit_windows_as_system", {
        p_limit: limit,
      }),
      timeoutMs
    );
  } catch {
    throw new RateLimitUnavailableError();
  }
  if (
    response.error ||
    typeof response.data !== "number" ||
    !Number.isSafeInteger(response.data) ||
    response.data < 0 ||
    response.data > limit
  ) {
    throw new RateLimitUnavailableError();
  }
  return response.data;
}
