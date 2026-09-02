import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseExternalApiHmacKeyRing } from "@/lib/external-api/auth/credential-secret";
import {
  NetworkFingerprintUnavailableError,
  createExternalApiNetworkFingerprint,
} from "@/lib/external-api/security/network-fingerprint";

const ring = parseExternalApiHmacKeyRing(
  JSON.stringify({
    activeKid: "4",
    keys: {
      "3": Buffer.alloc(32, 3).toString("base64url"),
      "4": Buffer.alloc(32, 4).toString("base64url"),
    },
  }),
  "TEST_NETWORK_RING"
);

function request(address?: string): Request {
  return new Request("https://app.opsapp.co/v1/analytics/leads", {
    headers: address ? { "x-vercel-forwarded-for": address } : {},
  });
}

describe("external API network fingerprints", () => {
  it("uses a rotating HMAC rather than storing or hashing a plain IP", () => {
    const first = createExternalApiNetworkFingerprint({
      request: request("203.0.113.8"),
      keyRing: ring,
      presentedPrefix: "opsx_4_abcdefghijkl",
    });
    const second = createExternalApiNetworkFingerprint({
      request: request("203.0.113.8"),
      keyRing: ring,
      presentedPrefix: "opsx_4_abcdefghijkl",
    });

    expect(first.version).toBe(4);
    expect(first.digest).toHaveLength(32);
    expect(first.rateLimitIdentity).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.digest.equals(second.digest)).toBe(true);
    expect(
      first.digest.equals(createHash("sha256").update("203.0.113.8").digest())
    ).toBe(false);
    expect(JSON.stringify(first)).not.toContain("203.0.113.8");
    expect(JSON.stringify(first)).not.toContain("Bearer");
  });

  it("binds the fingerprint to the active network key version", () => {
    const previousRing = parseExternalApiHmacKeyRing(
      JSON.stringify({
        activeKid: "3",
        keys: {
          "3": Buffer.alloc(32, 3).toString("base64url"),
          "4": Buffer.alloc(32, 4).toString("base64url"),
        },
      }),
      "TEST_NETWORK_RING"
    );
    const previous = createExternalApiNetworkFingerprint({
      request: request("203.0.113.8"),
      keyRing: previousRing,
      presentedPrefix: "missing",
    });
    const current = createExternalApiNetworkFingerprint({
      request: request("203.0.113.8"),
      keyRing: ring,
      presentedPrefix: "missing",
    });

    expect(previous.version).toBe(3);
    expect(current.version).toBe(4);
    expect(previous.digest.equals(current.digest)).toBe(false);
  });

  it("fails closed when a trusted network address is absent or malformed", () => {
    expect(() =>
      createExternalApiNetworkFingerprint({
        request: request(),
        keyRing: ring,
        presentedPrefix: "missing",
      })
    ).toThrow(NetworkFingerprintUnavailableError);
    expect(() =>
      createExternalApiNetworkFingerprint({
        request: request("203.0.113.8, 10.0.0.1"),
        keyRing: ring,
        presentedPrefix: "missing",
      })
    ).toThrow(NetworkFingerprintUnavailableError);
    expect(() =>
      createExternalApiNetworkFingerprint({
        request: request("not-an-ip"),
        keyRing: ring,
        presentedPrefix: "missing",
      })
    ).toThrow(NetworkFingerprintUnavailableError);
  });
});
