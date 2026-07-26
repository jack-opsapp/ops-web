import { describe, expect, it, vi } from "vitest";

import {
  AUTHENTICATED_COMPANY_WINDOWS,
  AUTHENTICATED_PRINCIPAL_WINDOWS,
  PRE_AUTH_WINDOWS,
  RateLimitUnavailableError,
  createStrictRateLimiter,
} from "@/lib/external-api/security/strict-rate-limit";

function redisResponse(result: number[]): Response {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("strict external API rate limiting", () => {
  it("atomically evaluates every principal and company burst/minute/day window", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        redisResponse([
          1, 10_000, 2, 60_000, 3, 86_400_000, 4, 10_000, 5, 60_000, 6,
          86_400_000,
        ])
      );
    const limiter = createStrictRateLimiter({
      url: "https://redis.example",
      token: "redis-token",
      fetchImpl,
      timeoutMs: 100,
    });

    const decision = await limiter.checkAuthenticated({
      credentialClass: "intake",
      principalIdentity: "principal-safe-digest",
      companyIdentity: "company-safe-digest",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterSeconds).toBe(0);
    expect(decision.remaining).toBeGreaterThanOrEqual(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const command = JSON.parse(String(init.body)) as unknown[];
    expect(command[0]).toBe("EVAL");
    expect(command[2]).toBe("6");
    expect(String(command)).not.toContain("redis-token");
    expect(String(command)).toContain("principal-safe-digest");
    expect(String(command)).toContain("company-safe-digest");
    expect(AUTHENTICATED_PRINCIPAL_WINDOWS.intake).toHaveLength(3);
    expect(AUTHENTICATED_COMPANY_WINDOWS).toHaveLength(3);
  });

  it("uses only the network fingerprint and presented non-secret prefix before auth", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        redisResponse([2, 10_000, 3, 60_000, 2, 10_000, 3, 60_000])
      );
    const limiter = createStrictRateLimiter({
      url: "https://redis.example",
      token: "redis-token",
      fetchImpl,
      timeoutMs: 100,
    });

    await limiter.checkPreAuth({
      networkFingerprint: "fingerprint-safe-digest",
      presentedPrefix: "opsx_1_abcdefghijkl",
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const serialized = String(init.body);
    expect(PRE_AUTH_WINDOWS).toHaveLength(2);
    expect(serialized).toContain("fingerprint-safe-digest");
    expect(serialized).toContain("opsx_1_abcdefghijkl");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("raw-secret");
  });

  it("returns one safe denied decision without exposing limiter identities", async () => {
    const firstWindowLimit = PRE_AUTH_WINDOWS[0].limit;
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        redisResponse([
          firstWindowLimit + 1,
          9_500,
          1,
          59_000,
          1,
          9_500,
          1,
          59_000,
        ])
      );
    const limiter = createStrictRateLimiter({
      url: "https://redis.example",
      token: "redis-token",
      fetchImpl,
      timeoutMs: 100,
    });

    const decision = await limiter.checkPreAuth({
      networkFingerprint: "fingerprint-safe-digest",
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

  it.each([
    {
      name: "missing configuration",
      limiter: () =>
        createStrictRateLimiter({
          url: "",
          token: "",
          fetchImpl: vi.fn(),
          timeoutMs: 50,
        }),
    },
    {
      name: "Redis HTTP error",
      limiter: () =>
        createStrictRateLimiter({
          url: "https://redis.example",
          token: "redis-token",
          fetchImpl: vi
            .fn()
            .mockResolvedValue(
              new Response("provider detail", { status: 500 })
            ),
          timeoutMs: 50,
        }),
    },
    {
      name: "malformed Redis response",
      limiter: () =>
        createStrictRateLimiter({
          url: "https://redis.example",
          token: "redis-token",
          fetchImpl: vi
            .fn()
            .mockResolvedValue(
              new Response('{"result":["bad"]}', { status: 200 })
            ),
          timeoutMs: 50,
        }),
    },
    {
      name: "Redis exception",
      limiter: () =>
        createStrictRateLimiter({
          url: "https://redis.example",
          token: "redis-token",
          fetchImpl: vi.fn().mockRejectedValue(new Error("socket secret")),
          timeoutMs: 50,
        }),
    },
  ])(
    "fails closed for $name without a memory fallback",
    async ({ limiter }) => {
      await expect(
        limiter().checkPreAuth({
          networkFingerprint: "fingerprint-safe-digest",
          presentedPrefix: "missing",
        })
      ).rejects.toBeInstanceOf(RateLimitUnavailableError);
    }
  );

  it("fails closed when Redis exceeds the bounded timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    const limiter = createStrictRateLimiter({
      url: "https://redis.example",
      token: "redis-token",
      fetchImpl,
      timeoutMs: 10,
    });

    await expect(
      limiter.checkPreAuth({
        networkFingerprint: "fingerprint-safe-digest",
        presentedPrefix: "missing",
      })
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });
});
