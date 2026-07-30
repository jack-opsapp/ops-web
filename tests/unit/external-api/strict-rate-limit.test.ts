import { describe, expect, it, vi } from "vitest";

import {
  AUTHENTICATED_COMPANY_WINDOWS,
  AUTHENTICATED_PRINCIPAL_WINDOWS,
  PRE_AUTH_WINDOWS,
  RateLimitUnavailableError,
  createStrictRateLimiter,
  purgeExpiredExternalApiRateLimitWindows,
} from "@/lib/external-api/security/strict-rate-limit";

function clientReturning(data: unknown) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

const networkIdentity = "A".repeat(43);
const principalIdentity = "B".repeat(43);
const companyIdentity = "C".repeat(43);

describe("strict external API rate limiting", () => {
  it("atomically evaluates the intake principal and company policies in one guarded RPC", async () => {
    const client = clientReturning({
      allowed: true,
      remaining: 119,
      retry_after_seconds: 0,
    });
    const limiter = createStrictRateLimiter({ client, timeoutMs: 100 });

    const decision = await limiter.checkAuthenticated({
      credentialClass: "intake",
      principalIdentity,
      companyIdentity,
    });

    expect(decision).toEqual({
      allowed: true,
      remaining: 119,
      retryAfterSeconds: 0,
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith(
      "consume_external_api_rate_limits_as_system",
      {
        p_checks: [
          {
            scope: "principal_intake",
            identity: principalIdentity,
          },
          {
            scope: "company",
            identity: companyIdentity,
          },
        ],
      }
    );
    expect(AUTHENTICATED_PRINCIPAL_WINDOWS.intake).toHaveLength(3);
    expect(AUTHENTICATED_COMPANY_WINDOWS).toHaveLength(3);
  });

  it("uses only the HMAC network identity and presented non-secret prefix before auth", async () => {
    const client = clientReturning({
      allowed: true,
      remaining: 27,
      retry_after_seconds: 0,
    });
    const limiter = createStrictRateLimiter({ client, timeoutMs: 100 });

    await limiter.checkPreAuth({
      networkFingerprint: networkIdentity,
      presentedPrefix: "opsx_1_abcdefghijkl",
    });

    expect(PRE_AUTH_WINDOWS).toHaveLength(2);
    expect(client.rpc).toHaveBeenCalledWith(
      "consume_external_api_rate_limits_as_system",
      {
        p_checks: [
          {
            scope: "preauth_network",
            identity: networkIdentity,
          },
          {
            scope: "preauth_prefix",
            identity: `${networkIdentity}.opsx_1_abcdefghijkl`,
          },
        ],
      }
    );
    expect(JSON.stringify(client.rpc.mock.calls)).not.toContain("raw-secret");
  });

  it("maps the analytics credential to the stricter analytics policy", async () => {
    const client = clientReturning({
      allowed: true,
      remaining: 9,
      retry_after_seconds: 0,
    });
    const limiter = createStrictRateLimiter({ client, timeoutMs: 100 });

    await limiter.checkAuthenticated({
      credentialClass: "analytics",
      principalIdentity,
      companyIdentity,
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "consume_external_api_rate_limits_as_system",
      {
        p_checks: [
          {
            scope: "principal_analytics",
            identity: principalIdentity,
          },
          {
            scope: "company",
            identity: companyIdentity,
          },
        ],
      }
    );
  });

  it("returns one safe denied decision without exposing limiter identities", async () => {
    const client = clientReturning({
      allowed: false,
      remaining: 0,
      retry_after_seconds: 10,
    });
    const limiter = createStrictRateLimiter({ client, timeoutMs: 100 });

    const decision = await limiter.checkPreAuth({
      networkFingerprint: networkIdentity,
      presentedPrefix: "opsx_1_abcdefghijkl",
    });

    expect(decision).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 10,
    });
    expect(JSON.stringify(decision)).not.toContain("fingerprint");
    expect(JSON.stringify(decision)).not.toContain("opsx");
  });

  it("rejects a raw network address before it can reach the database", async () => {
    const client = clientReturning({
      allowed: true,
      remaining: 1,
      retry_after_seconds: 0,
    });
    const limiter = createStrictRateLimiter({ client, timeoutMs: 100 });

    await expect(
      limiter.checkPreAuth({
        networkFingerprint: "203.0.113.7",
        presentedPrefix: "missing",
      })
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing client",
      client: undefined,
    },
    {
      name: "database error",
      client: {
        rpc: vi
          .fn()
          .mockResolvedValue({
            data: null,
            error: { message: "database detail" },
          }),
      },
    },
    {
      name: "malformed database response",
      client: clientReturning({
        allowed: "yes",
        remaining: -1,
        retry_after_seconds: "secret",
      }),
    },
    {
      name: "database exception",
      client: {
        rpc: vi.fn().mockRejectedValue(new Error("socket secret")),
      },
    },
  ])("fails closed for $name without a memory fallback", async ({ client }) => {
    const limiter = createStrictRateLimiter({ client, timeoutMs: 50 });

    await expect(
      limiter.checkPreAuth({
        networkFingerprint: networkIdentity,
        presentedPrefix: "missing",
      })
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });

  it("fails closed when Supabase exceeds the bounded timeout", async () => {
    const client = {
      rpc: vi.fn(() => new Promise(() => undefined)),
    };
    const limiter = createStrictRateLimiter({ client, timeoutMs: 10 });

    await expect(
      limiter.checkPreAuth({
        networkFingerprint: networkIdentity,
        presentedPrefix: "missing",
      })
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });

  it("purges only a bounded batch of expired windows", async () => {
    const client = clientReturning(37);

    await expect(
      purgeExpiredExternalApiRateLimitWindows(client, { limit: 1000 })
    ).resolves.toBe(37);
    expect(client.rpc).toHaveBeenCalledWith(
      "purge_external_api_rate_limit_windows_as_system",
      { p_limit: 1000 }
    );
  });
});
