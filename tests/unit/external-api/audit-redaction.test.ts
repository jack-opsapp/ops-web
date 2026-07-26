import { describe, expect, it, vi } from "vitest";

import {
  commitExternalApiAuditBase,
  createSupabaseExternalApiAuditRecorder,
  redactExternalApiAuditValue,
} from "@/lib/external-api/security/audit";

describe("external API audit redaction", () => {
  it("recursively removes credentials, contact content, answers, files, and URL queries", () => {
    const input: Record<string, unknown> = {
      requestId: "req_0123456789abcdefghijklm",
      route: "/v1/intake/submissions",
      authorization: "Bearer opsx_1_prefix_raw-secret",
      nested: {
        apiKey: "key-secret",
        token: "token-secret",
        contact: {
          name: "Customer Name",
          email: "customer@example.com",
          phone: "+15555550123",
        },
        message: "Please quote the back deck.",
        answers: [{ key: "budget", value: "$50,000" }],
        callbackUrl:
          "https://customer.example/form?token=signed-secret#fragment",
        filename: "private-house-photo.jpg",
        storageKey: "company/customer/private-house-photo.jpg",
        signedUrl: "https://storage.example/file?X-Amz-Signature=signed-secret",
      },
      safe: {
        outcome: "rejected",
        responseClass: 4,
      },
    };

    const redacted = redactExternalApiAuditValue(input);
    const serialized = JSON.stringify(redacted);

    for (const secret of [
      "raw-secret",
      "key-secret",
      "token-secret",
      "Customer Name",
      "customer@example.com",
      "+15555550123",
      "back deck",
      "$50,000",
      "signed-secret",
      "private-house-photo.jpg",
      "company/customer",
      "X-Amz-Signature",
      "#fragment",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(redacted).toMatchObject({
      requestId: "req_0123456789abcdefghijklm",
      route: "/v1/intake/submissions",
      safe: { outcome: "rejected", responseClass: 4 },
    });
    expect(serialized).toContain("https://customer.example/form");
  });

  it("bounds depth, object size, strings, and circular structures", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    circular.long = "x".repeat(20_000);
    circular.many = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [`field${index}`, index])
    );

    const serialized = JSON.stringify(redactExternalApiAuditValue(circular));
    expect(serialized.length).toBeLessThan(20_000);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("[TRUNCATED]");
  });

  it("redacts contact details embedded inside otherwise ordinary strings", () => {
    const serialized = JSON.stringify(
      redactExternalApiAuditValue({
        safeLabel:
          "Reply to customer@example.com or call +1 (555) 555-0123 today",
      })
    );

    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).not.toContain("555-0123");
    expect(serialized).toContain("[REDACTED]");
  });

  it("sends only the fixed redacted audit contract to Supabase", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const recorder = createSupabaseExternalApiAuditRecorder({ rpc });
    const fingerprint = {
      version: 2,
      digest: Buffer.alloc(32, 9),
      redisIdentity: "safe-fingerprint",
      presentedPrefix: "opsx_2_abcdefghijkl",
    };

    await recorder.recordPreAuth({
      requestId: "10000000-0000-4000-8000-000000000001",
      route: "/v1/intake/submissions",
      method: "POST",
      requestReceivedAt: new Date("2026-07-26T20:00:00.000Z"),
      outcome: "rejected",
      errorCode: "invalid_credentials",
      responseClass: 4,
      durationMs: 12,
      rateLimitResult: "allowed",
      networkFingerprint: fingerprint,
    });
    await recorder.finalizeAuthenticated({
      base: commitExternalApiAuditBase("10000000-0000-4000-8000-000000000002"),
      outcome: "accepted",
      errorCode: null,
      responseClass: 2,
      durationMs: 20,
      rateLimitResult: "allowed",
      idempotencyResult: "new",
      cacheResult: "not_applicable",
      metricSet: [],
      grouping: [],
      resultSize: 1,
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "record_external_api_request_audit_as_system",
      expect.objectContaining({
        p_phase: "pre_auth",
        p_request_id: "10000000-0000-4000-8000-000000000001",
        p_fingerprint_version: 2,
        p_fingerprint_digest: `\\x${"09".repeat(32)}`,
        p_presented_prefix: "opsx_2_abcdefghijkl",
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "record_external_api_request_audit_as_system",
      expect.objectContaining({
        p_phase: "finalize",
        p_request_id: "10000000-0000-4000-8000-000000000002",
        p_route: null,
        p_fingerprint_digest: null,
        p_presented_prefix: null,
      })
    );
    const serialized = JSON.stringify(rpc.mock.calls);
    expect(serialized).not.toMatch(
      /authorization|bearer|request_body|signed_url|customer@example/i
    );
  });
});
