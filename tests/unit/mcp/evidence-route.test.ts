import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpBearerResolution } from "@/lib/agent-control-plane/mcp/bearer";
import type { McpEvidenceRedemptionResult } from "@/lib/agent-control-plane/mcp/evidence-redemption";
import { createMcpEvidenceTokenCodec } from "@/lib/agent-control-plane/mcp/evidence-token";
import type { McpServerRuntime } from "@/lib/agent-control-plane/mcp/runtime";
import * as evidenceRoute from "@/app/api/mcp/evidence/[token]/route";
import {
  createEvidenceGetHandler,
  type EvidenceRouteDependencies,
} from "@/lib/agent-control-plane/mcp/evidence-route";

const { DELETE, GET, HEAD, PATCH, POST, PUT } = evidenceRoute;

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const TOKEN_HASH = "a".repeat(64);
const EVIDENCE_REF = `ops_evidence:v1:${"b".repeat(64)}`;
const NOW_SECONDS = 1_787_899_200;

const codec = createMcpEvidenceTokenCodec({
  key: Uint8Array.from(Buffer.from("11".repeat(32), "hex")),
  now: () => NOW_SECONDS,
  randomBytes: () => Uint8Array.from(Buffer.from("22".repeat(32), "hex")),
});
const verified = codec.issue({
  audience: "https://app.opsapp.co/api/mcp",
  clientId: CLIENT_ID,
  grantId: GRANT_ID,
  actorUserId: ACTOR_ID,
  companyId: COMPANY_ID,
  parent: { kind: "project", id: JOB_ID },
  sourceKind: "email_attachment",
  evidenceRef: EVIDENCE_REF,
  sourceRevisions: [
    { domain: "artifacts", source_revision: 7 },
    { domain: "legacy_operational", source_revision: 9 },
  ],
});

function authenticated(): Extract<
  McpBearerResolution,
  { kind: "authenticated" }
> {
  return {
    kind: "authenticated",
    requestId: "request-redemption",
    actorContext: {
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      auth: {
        channel: "mcp",
        oauthGrantId: GRANT_ID,
        oauthClientId: CLIENT_ID,
        audience: "https://app.opsapp.co/api/mcp",
        issuer: "https://app.opsapp.co",
        scopeCeiling: ["ops.correspondence.read", "ops.files.read"],
        tokenId: TOKEN_HASH,
        grantRevision: "c".repeat(32),
      },
    } as never,
    grantFacts: {
      grantId: GRANT_ID,
      clientId: CLIENT_ID,
      clientName: "Claude",
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      scopes: ["ops.correspondence.read", "ops.files.read"],
      tokenId: TOKEN_HASH,
      expiresAtEpochSeconds: NOW_SECONDS + 3600,
    },
  };
}

function request(headers: Record<string, string> = {}) {
  return new Request(
    `https://app.opsapp.co/api/mcp/evidence/${verified.token}`,
    {
      headers: { authorization: "Bearer opaque", ...headers },
    }
  );
}

function context(token = verified.token) {
  return { params: Promise.resolve({ token }) };
}

function dependencies(
  overrides: Partial<EvidenceRouteDependencies> = {}
): EvidenceRouteDependencies {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const stored = new Blob([bytes], { type: "application/pdf" });
  Object.defineProperty(stored, "stream", {
    value: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  });
  const runtime = {
    durableRateLimiter: {
      consume: vi.fn().mockResolvedValue({
        allowed: true,
        remainingUnits: 29,
        resetAt: "2026-08-28T12:01:00.000Z",
      }),
    },
  } as unknown as McpServerRuntime;
  return {
    runtimeConfigured: () => true,
    evidenceSigningConfigured: () => true,
    getRuntime: () => runtime,
    resolveBearer: vi.fn().mockResolvedValue(authenticated()),
    verifyToken: vi.fn().mockReturnValue(verified),
    redeem: vi.fn().mockResolvedValue({
      outcome: "delivered",
      locatorKind: "storage_path",
      locator: "company/object.pdf",
      mimeType: "application/pdf",
      byteSize: 4,
    } satisfies McpEvidenceRedemptionResult),
    download: vi.fn().mockResolvedValue(stored),
    ...overrides,
  };
}

describe("GET /api/mcp/evidence/[token]", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("exports only fields supported by the Next route-module contract", () => {
    expect(Object.keys(evidenceRoute).sort()).toEqual(
      [
        "DELETE",
        "GET",
        "HEAD",
        "PATCH",
        "POST",
        "PUT",
        "dynamic",
        "maxDuration",
        "runtime",
      ].sort()
    );
  });

  it("redeems once and streams exact verified bytes with no-store, no-range, and no-redirect headers", async () => {
    const deps = dependencies();
    const response = await createEvidenceGetHandler(deps)(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin"
    );
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      1, 2, 3, 4,
    ]);
    expect(deps.redeem).toHaveBeenCalledTimes(1);
    expect(deps.download).toHaveBeenCalledWith({
      outcome: "delivered",
      locatorKind: "storage_path",
      locator: "company/object.pdf",
      mimeType: "application/pdf",
      byteSize: 4,
    });
    const runtime = deps.getRuntime();
    expect(runtime.durableRateLimiter.consume).toHaveBeenCalledWith({
      requestId: "request-redemption",
      grantId: GRANT_ID,
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      capabilityId: "redeem_mcp_evidence",
      protocolEra: "modern",
      bucket: "evidence_search",
    });
  });

  it("rejects every range before verification or nonce consumption", async () => {
    const deps = dependencies();
    const response = await createEvidenceGetHandler(deps)(
      request({ range: "bytes=0-1" }),
      context()
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(deps.verifyToken).not.toHaveBeenCalled();
    expect(deps.redeem).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("rejects a wrong client/actor binding and a revoked bearer before redemption", async () => {
    const wrong = {
      ...authenticated(),
      grantFacts: { ...authenticated().grantFacts, clientId: JOB_ID },
    } as Extract<McpBearerResolution, { kind: "authenticated" }>;
    const wrongDeps = dependencies({
      resolveBearer: vi.fn().mockResolvedValue(wrong),
    });
    expect(
      (await createEvidenceGetHandler(wrongDeps)(request(), context())).status
    ).toBe(404);
    expect(wrongDeps.redeem).not.toHaveBeenCalled();

    const revokedDeps = dependencies({
      resolveBearer: vi.fn().mockResolvedValue({ kind: "invalid_token" }),
    });
    const revoked = await createEvidenceGetHandler(revokedDeps)(
      request(),
      context()
    );
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain("invalid_token");
    expect(revokedDeps.verifyToken).not.toHaveBeenCalled();
    expect(revokedDeps.redeem).not.toHaveBeenCalled();
  });

  it("collapses replay, expiry, stale revision, unsafe scan, and missing evidence to the same response", async () => {
    for (const outcome of ["replay", "expired", "unavailable"] as const) {
      const deps = dependencies({
        redeem: vi.fn().mockResolvedValue({ outcome }),
      });
      const response = await createEvidenceGetHandler(deps)(
        request(),
        context()
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
      expect(deps.download).not.toHaveBeenCalled();
    }
  });

  it("fails closed after redemption when storage MIME or length differs from the same-statement declaration", async () => {
    for (const blob of [
      new Blob([Uint8Array.from([1, 2, 3, 4])], { type: "text/html" }),
      new Blob([Uint8Array.from([1, 2, 3])], { type: "application/pdf" }),
    ]) {
      const deps = dependencies({ download: vi.fn().mockResolvedValue(blob) });
      const response = await createEvidenceGetHandler(deps)(
        request(),
        context()
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("never logs the URL token or redeemed storage locator", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = dependencies({
      download: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    });
    const response = await createEvidenceGetHandler(deps)(request(), context());
    expect(response.status).toBe(404);
    const logs = JSON.stringify([...error.mock.calls, ...warn.mock.calls]);
    expect(logs).not.toContain(verified.token);
    expect(logs).not.toContain("company/object.pdf");
    expect(logs).not.toContain(request().url);
  });

  it("keeps production exports GET-only and explicitly refuses HEAD and mutation verbs", async () => {
    expect(typeof GET).toBe("function");
    for (const handler of [HEAD, POST, PUT, PATCH, DELETE]) {
      const response = await handler(request());
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});
