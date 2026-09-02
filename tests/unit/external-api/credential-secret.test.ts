import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createCredentialSecret,
  deriveCredentialLookupDigest,
  parseExternalApiHmacKeyRing,
  verifyCredentialLookupDigest,
} from "@/lib/external-api/auth/credential-secret";

function key(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64url");
}

const ringJson = JSON.stringify({
  activeKid: "2",
  keys: {
    "1": key(1),
    "2": key(2),
  },
});

describe("external API credential secrets", () => {
  it("creates a versioned token with 256 random bits and a non-secret prefix", () => {
    const ring = parseExternalApiHmacKeyRing(ringJson, "TEST_RING");
    const created = createCredentialSecret(ring);
    const match = created.secret.match(
      /^opsx_2_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/
    );

    expect(match).not.toBeNull();
    expect(created.digestVersion).toBe(2);
    expect(created.visiblePrefix).toBe(`opsx_2_${match?.[1]}`);
    expect(Buffer.from(match?.[2] ?? "", "base64url")).toHaveLength(32);
    expect(created.lookupDigest).toHaveLength(32);
    expect(created.secret).not.toContain(created.lookupDigest.toString("hex"));
  });

  it("derives version-bound HMAC digests and verifies them safely", () => {
    const ring = parseExternalApiHmacKeyRing(ringJson, "TEST_RING");
    const secret = `opsx_1_abcdefghijkl_${"A".repeat(43)}`;
    const digest = deriveCredentialLookupDigest(secret, 1, ring);

    expect(digest).toHaveLength(32);
    expect(digest.equals(createHash("sha256").update(secret).digest())).toBe(
      false
    );
    expect(verifyCredentialLookupDigest(secret, 1, digest, ring)).toBe(true);
    expect(
      verifyCredentialLookupDigest(`${secret.slice(0, -1)}x`, 1, digest, ring)
    ).toBe(false);
    expect(
      verifyCredentialLookupDigest(secret, 1, Buffer.alloc(31), ring)
    ).toBe(false);
  });

  it("keeps bounded validation overlap while generating only with the active key", () => {
    const ring = parseExternalApiHmacKeyRing(ringJson, "TEST_RING");
    expect(ring.activeKid).toBe(2);
    expect([...ring.keys.keys()]).toEqual([1, 2]);
    expect(createCredentialSecret(ring).digestVersion).toBe(2);
    expect(() =>
      deriveCredentialLookupDigest(
        `opsx_3_abcdefghijkl_${"A".repeat(43)}`,
        3,
        ring
      )
    ).toThrow("credential HMAC key version is unavailable");
  });

  it("fails closed for missing, weak, ambiguous, or oversized key rings", () => {
    expect(() => parseExternalApiHmacKeyRing("", "TEST_RING")).toThrow(
      "TEST_RING is required"
    );
    expect(() => parseExternalApiHmacKeyRing("not-json", "TEST_RING")).toThrow(
      "TEST_RING is malformed"
    );
    expect(() =>
      parseExternalApiHmacKeyRing(
        JSON.stringify({
          activeKid: "2",
          keys: { "1": key(1) },
        }),
        "TEST_RING"
      )
    ).toThrow("active key is unavailable");
    expect(() =>
      parseExternalApiHmacKeyRing(
        JSON.stringify({
          activeKid: "1",
          keys: { "1": Buffer.alloc(16).toString("base64url") },
        }),
        "TEST_RING"
      )
    ).toThrow("at least 32 bytes");
    expect(() =>
      parseExternalApiHmacKeyRing(
        JSON.stringify({
          activeKid: "1",
          keys: {
            "1": key(1),
            "2": key(2),
            "3": key(3),
            "4": key(4),
          },
        }),
        "TEST_RING"
      )
    ).toThrow("at most 3 keys");
  });
});
