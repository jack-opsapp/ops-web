import { createHash, createHmac } from "node:crypto";

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

  it("leaves IPv4 fingerprints byte-for-byte unchanged in IPv6 /64 mode", () => {
    const address = "203.0.113.8";
    const existing = createExternalApiNetworkFingerprint({
      request: request(address),
      keyRing: ring,
      presentedPrefix: "missing",
    });
    const scoped = createExternalApiNetworkFingerprint({
      request: request(address),
      keyRing: ring,
      presentedPrefix: "missing",
      ipv6PrefixLength: 64,
    });
    const expected = createHmac("sha256", Buffer.alloc(32, 4))
      .update(`network\0${address}`, "utf8")
      .digest();

    expect(existing.digest.equals(expected)).toBe(true);
    expect(scoped.digest.equals(expected)).toBe(true);
  });

  it("groups compressed and expanded IPv6 hosts within one /64", () => {
    const compressed = createExternalApiNetworkFingerprint({
      request: request("2001:db8:abcd:12::1"),
      keyRing: ring,
      presentedPrefix: "missing",
      ipv6PrefixLength: 64,
    });
    const expanded = createExternalApiNetworkFingerprint({
      request: request("2001:0db8:abcd:0012:ffff:eeee:dddd:cccc"),
      keyRing: ring,
      presentedPrefix: "missing",
      ipv6PrefixLength: 64,
    });

    expect(compressed.digest.equals(expanded.digest)).toBe(true);
  });

  it("keeps separate IPv6 /64s distinct while default callers remain host-specific", () => {
    const firstAddress = "2001:db8:abcd:12::1";
    const secondHost = "2001:db8:abcd:12::2";
    const secondNetwork = "2001:db8:abcd:13::1";
    const scopedFirst = createExternalApiNetworkFingerprint({
      request: request(firstAddress),
      keyRing: ring,
      presentedPrefix: "missing",
      ipv6PrefixLength: 64,
    });
    const scopedSecondNetwork = createExternalApiNetworkFingerprint({
      request: request(secondNetwork),
      keyRing: ring,
      presentedPrefix: "missing",
      ipv6PrefixLength: 64,
    });
    const existingFirst = createExternalApiNetworkFingerprint({
      request: request(firstAddress),
      keyRing: ring,
      presentedPrefix: "missing",
    });
    const existingSecondHost = createExternalApiNetworkFingerprint({
      request: request(secondHost),
      keyRing: ring,
      presentedPrefix: "missing",
    });

    expect(scopedFirst.digest.equals(scopedSecondNetwork.digest)).toBe(false);
    expect(existingFirst.digest.equals(existingSecondHost.digest)).toBe(false);
  });

  it("treats compressed and expanded IPv4-mapped IPv6 as the underlying IPv4 address", () => {
    const ipv4 = createExternalApiNetworkFingerprint({
      request: request("192.0.2.128"),
      keyRing: ring,
      presentedPrefix: "missing",
      ipv6PrefixLength: 64,
    });
    const dottedMapped = createExternalApiNetworkFingerprint({
      request: request("::ffff:192.0.2.128"),
      keyRing: ring,
      presentedPrefix: "missing",
      ipv6PrefixLength: 64,
    });
    const expandedMapped = createExternalApiNetworkFingerprint({
      request: request("0:0:0:0:0:ffff:c000:0280"),
      keyRing: ring,
      presentedPrefix: "missing",
      ipv6PrefixLength: 64,
    });

    expect(dottedMapped.digest.equals(ipv4.digest)).toBe(true);
    expect(expandedMapped.digest.equals(ipv4.digest)).toBe(true);
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
