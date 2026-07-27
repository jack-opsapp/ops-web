import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ExternalApiRequestActor } from "@/lib/external-api/auth/credential-auth";
import { ExternalApiSafeError } from "@/lib/external-api/contracts/errors";
import {
  createExternalApiRequestBoundary,
  type ExternalApiBoundaryDependencies,
} from "@/lib/external-api/http/boundary";
import { commitExternalApiAuditBase } from "@/lib/external-api/security/audit";
import { RateLimitUnavailableError } from "@/lib/external-api/security/strict-rate-limit";

const publicRequestId = "req_10000000-0000-4000-8000-000000000001";
const auditRequestId = "10000000-0000-4000-8000-000000000001";

const actor: ExternalApiRequestActor = Object.freeze({
  principalId: "10000000-0000-4000-8000-000000000010",
  credentialId: "10000000-0000-4000-8000-000000000011",
  companyId: "10000000-0000-4000-8000-000000000012",
  credentialClass: "intake",
  scopes: Object.freeze(["intake.write"] as const),
  allowedSourceIds: Object.freeze(["10000000-0000-4000-8000-000000000013"]),
  authorizationEpoch: 2,
  digestVersion: 1,
  credentialDigest: `\\x${"ab".repeat(32)}`,
  visiblePrefix: "opsx_1_abcdefghijkl",
});

function request(): Request {
  return new Request("https://app.opsapp.co/v1/intake/submissions", {
    method: "POST",
    headers: {
      authorization: `Bearer opsx_1_abcdefghijkl_${"A".repeat(43)}`,
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.8",
    },
    body: JSON.stringify({ sourceId: "src_test" }),
  });
}

function dependencies(events: string[]): ExternalApiBoundaryDependencies {
  return {
    createRequestIdentity: () => {
      events.push("request_id");
      return { publicRequestId, auditRequestId };
    },
    inspectPresentedPrefix: () => {
      events.push("presentation");
      return "opsx_1_abcdefghijkl";
    },
    createNetworkFingerprint: () => {
      events.push("fingerprint");
      return {
        version: 1,
        digest: Buffer.alloc(32, 1),
        redisIdentity: "fingerprint-safe-digest",
        presentedPrefix: "opsx_1_abcdefghijkl",
      };
    },
    checkPreAuthRateLimit: async () => {
      events.push("pre_auth_limit");
      return { allowed: true, remaining: 9, retryAfterSeconds: 0 };
    },
    authenticate: vi.fn(async () => {
      events.push("bearer_auth");
      return actor;
    }),
    createAuthenticatedRateLimitIdentities: () => ({
      principalIdentity: "principal-safe-digest",
      companyIdentity: "company-safe-digest",
    }),
    checkAuthenticatedRateLimit: async () => {
      events.push("principal_company_limit");
      return { allowed: true, remaining: 49, retryAfterSeconds: 0 };
    },
    audit: {
      recordPreAuth: vi.fn(async () => {
        events.push("audit");
      }),
      finalizeAuthenticated: vi.fn(async () => {
        events.push("audit");
      }),
    },
    now: () => new Date("2026-07-26T20:00:00.000Z"),
  };
}

describe("external API request boundary", () => {
  it("refuses to create a protected route without an explicit scope", () => {
    expect(() =>
      createExternalApiRequestBoundary({
        route: "/v1/intake/submissions",
        method: "POST",
        requiredCredentialClass: "intake",
        requiredScopes: [],
        parseRequest: async () => ({}),
        handler: vi.fn(),
        createResponse: vi.fn(),
        dependencies: dependencies([]),
      })
    ).toThrow("external API boundary requires at least one scope");
  });

  it("snapshots the required scopes before serving requests", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    const requiredScopes: Array<"intake.write"> = ["intake.write"];
    const handle = createExternalApiRequestBoundary({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes,
      parseRequest: async () => ({}),
      handler: async (context) => ({
        result: { accepted: true },
        auditBase: commitExternalApiAuditBase(context.auditRequestId),
        audit: {
          outcome: "accepted",
          idempotencyResult: "not_applicable",
          cacheResult: "not_applicable",
          metricSet: [],
          grouping: [],
          resultSize: 1,
        },
      }),
      createResponse: () => Response.json({ accepted: true }),
      dependencies: deps,
    });
    requiredScopes.length = 0;

    await handle(request());

    expect(deps.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ requiredScopes: ["intake.write"] })
    );
  });

  it("enforces the documented stage order and typed authenticated handler", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    const handle = createExternalApiRequestBoundary({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
      parseRequest: async (incoming) => {
        events.push("bounded_parse");
        return z
          .object({ sourceId: z.string() })
          .strict()
          .parse(await incoming.json());
      },
      handler: async (context) => {
        events.push("handler");
        expect(context.actor).toBe(actor);
        expect(context.requestId).toBe(publicRequestId);
        expect(context.auditRequestId).toBe(auditRequestId);
        expect(context.requestReceivedAt).toBe("2026-07-26T20:00:00.000Z");
        expect(context.route).toBe("/v1/intake/submissions");
        expect(context.method).toBe("POST");
        expect(context.networkFingerprint).toMatchObject({
          version: 1,
          redisIdentity: "fingerprint-safe-digest",
          presentedPrefix: "opsx_1_abcdefghijkl",
        });
        return {
          result: { accepted: true },
          auditBase: commitExternalApiAuditBase(context.auditRequestId),
          audit: {
            outcome: "accepted",
            idempotencyResult: "new",
            cacheResult: "not_applicable",
            metricSet: [],
            grouping: [],
            resultSize: 1,
          },
        };
      },
      createResponse: (result, options) => {
        events.push("response_envelope");
        return Response.json({ requestId: options.requestId, result });
      },
      dependencies: deps,
    });

    const response = await handle(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestId: publicRequestId,
      result: { accepted: true },
    });
    expect(events).toEqual([
      "request_id",
      "bounded_parse",
      "presentation",
      "fingerprint",
      "pre_auth_limit",
      "bearer_auth",
      "principal_company_limit",
      "handler",
      "response_envelope",
      "audit",
    ]);
    expect(deps.audit.finalizeAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({
        base: expect.objectContaining({ requestId: auditRequestId }),
        outcome: "accepted",
        rateLimitResult: "allowed",
      })
    );
  });

  it("accepts a deliberately empty parsed input without skipping the handler", async () => {
    const events: string[] = [];
    const handler = vi.fn(async (context) => {
      expect(context.input).toBeUndefined();
      return {
        result: { accepted: true },
        auditBase: commitExternalApiAuditBase(context.auditRequestId),
        audit: {
          outcome: "accepted" as const,
          idempotencyResult: "not_applicable" as const,
          cacheResult: "not_applicable" as const,
          metricSet: [],
          grouping: [],
          resultSize: 1,
        },
      };
    });
    const handle = createExternalApiRequestBoundary({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
      parseRequest: async () => undefined,
      handler,
      createResponse: (result, options) =>
        Response.json({ requestId: options.requestId, result }),
      dependencies: dependencies(events),
    });

    const response = await handle(request());

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("fails closed with 503 when Redis cannot prove admission", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.checkPreAuthRateLimit = async () => {
      events.push("pre_auth_limit");
      throw new RateLimitUnavailableError();
    };
    const handle = createExternalApiRequestBoundary({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
      parseRequest: async () => {
        events.push("bounded_parse");
        return {};
      },
      handler: vi.fn(),
      createResponse: vi.fn(),
      dependencies: deps,
    });

    const response = await handle(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("rate_limit_unavailable");
    expect(events).toEqual([
      "request_id",
      "bounded_parse",
      "presentation",
      "fingerprint",
      "pre_auth_limit",
      "audit",
    ]);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it("returns only safe retry metadata for 429 and never authenticates", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.checkPreAuthRateLimit = async () => {
      events.push("pre_auth_limit");
      return { allowed: false, remaining: 0, retryAfterSeconds: 17 };
    };
    const handle = createExternalApiRequestBoundary({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
      parseRequest: async () => {
        events.push("bounded_parse");
        return {};
      },
      handler: vi.fn(),
      createResponse: vi.fn(),
      dependencies: deps,
    });

    const response = await handle(request());
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(serialized).not.toContain("203.0.113.8");
    expect(serialized).not.toContain("opsx");
    expect(serialized).not.toContain("principal");
    expect(events.at(-1)).toBe("audit");
  });

  it("does not let a handler claim a different audit base", async () => {
    const events: string[] = [];
    const handle = createExternalApiRequestBoundary({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
      parseRequest: async () => {
        events.push("bounded_parse");
        return {};
      },
      handler: async () => ({
        result: { accepted: true },
        auditBase: commitExternalApiAuditBase(
          "10000000-0000-4000-8000-000000000099"
        ),
        audit: {
          outcome: "accepted",
          idempotencyResult: "new",
          cacheResult: "not_applicable",
          metricSet: [],
          grouping: [],
          resultSize: 1,
        },
      }),
      createResponse: () => Response.json({ unsafe: true }),
      dependencies: dependencies(events),
    });

    const response = await handle(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error" },
    });
  });

  it("finalizes a transactionally committed base when the handler throws after the command", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    const handle = createExternalApiRequestBoundary({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
      parseRequest: async () => ({}),
      handler: async () => {
        throw new Error("post-command response mapping failed");
      },
      createResponse: vi.fn(),
      dependencies: deps,
    });

    const response = await handle(request());

    expect(response.status).toBe(500);
    expect(deps.audit.finalizeAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({
        base: expect.objectContaining({ requestId: auditRequestId }),
        outcome: "error",
        errorCode: "internal_error",
      })
    );
    expect(deps.audit.recordPreAuth).not.toHaveBeenCalled();
  });

  it("records authenticated source denials before returning the safe error", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.recordAuthorizationDenial = vi.fn(async () => {
      events.push("security_denial");
    });
    const handle = createExternalApiRequestBoundary({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
      parseRequest: async () => ({}),
      handler: async () => {
        throw new ExternalApiSafeError("source_not_allowed");
      },
      createResponse: vi.fn(),
      dependencies: deps,
    });

    const response = await handle(request());

    expect(response.status).toBe(403);
    expect(deps.recordAuthorizationDenial).toHaveBeenCalledWith(
      actor,
      "source_not_allowed"
    );
    expect(events.indexOf("security_denial")).toBeLessThan(
      events.lastIndexOf("audit")
    );
  });

  it("fails closed when a source denial cannot be durably recorded", async () => {
    const deps = dependencies([]);
    deps.recordAuthorizationDenial = vi.fn(async () => {
      throw new Error("private backend detail");
    });
    const handle = createExternalApiRequestBoundary({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
      parseRequest: async () => ({}),
      handler: async () => {
        throw new ExternalApiSafeError("form_not_allowed");
      },
      createResponse: vi.fn(),
      dependencies: deps,
    });

    const response = await handle(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "temporarily_unavailable" },
    });
  });
});
