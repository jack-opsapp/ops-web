import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SESSION_CREDENTIAL_PREFIX,
  emailDigest,
  mintSessionCredential,
  networkFingerprint,
  normalizeEmail,
  sessionDigest,
} from "@/lib/customer-identity/credentials";
import type { CustomerIdentityHmacKeyRing } from "@/lib/customer-identity/config";

const BASE64URL_SECRET = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function keyRing(
  activeKid: number,
  keys: Record<number, number>
): CustomerIdentityHmacKeyRing {
  return Object.freeze({
    activeKid,
    keys: new Map(
      Object.entries(keys).map(([kid, fill]) => [
        Number(kid),
        Buffer.alloc(32, fill),
      ])
    ),
  });
}

describe("customer session credentials", () => {
  it("pins the greppable ops_cs_ prefix", () => {
    expect(SESSION_CREDENTIAL_PREFIX).toBe("ops_cs_");
  });

  it("mints 256-bit base64url secrets behind the prefix, never repeating", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 64; index += 1) {
      const credential = mintSessionCredential();
      expect(credential.startsWith(SESSION_CREDENTIAL_PREFIX)).toBe(true);
      expect(credential.slice(SESSION_CREDENTIAL_PREFIX.length)).toMatch(
        BASE64URL_SECRET
      );
      seen.add(credential);
    }
    expect(seen.size).toBe(64);
  });

  it("digests a well-formed credential as the SHA-256 hex of the full string", () => {
    const credential = mintSessionCredential();
    const digest = sessionDigest(credential);
    expect(digest).toMatch(SHA256_HEX);
    expect(digest).toBe(
      createHash("sha256").update(credential, "utf8").digest("hex")
    );
  });

  it("refuses anything not shaped like a credential this broker mints", () => {
    const secret = mintSessionCredential().slice(
      SESSION_CREDENTIAL_PREFIX.length
    );
    expect(sessionDigest("")).toBeNull();
    expect(sessionDigest(secret)).toBeNull();
    expect(sessionDigest(`ops_mcp_at_${secret}`)).toBeNull();
    expect(sessionDigest(`${SESSION_CREDENTIAL_PREFIX}${secret}x`)).toBeNull();
    expect(
      sessionDigest(`${SESSION_CREDENTIAL_PREFIX}${secret.slice(1)}`)
    ).toBeNull();
    expect(
      sessionDigest(`${SESSION_CREDENTIAL_PREFIX}${secret.slice(0, -1)}+`)
    ).toBeNull();
    expect(sessionDigest(` ${SESSION_CREDENTIAL_PREFIX}${secret}`)).toBeNull();
    expect(sessionDigest(undefined as unknown as string)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases, trims and NFKC-folds so one mailbox has one form", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM \n")).toBe(
      "jane.doe@example.com"
    );
    // Fullwidth letters fold to ASCII under NFKC.
    expect(normalizeEmail("ｊａｎｅ@example.com")).toBe(
      "jane@example.com"
    );
  });

  it("rejects shapes the database normalizer would also reject", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail("jane")).toBeNull();
    expect(normalizeEmail("@example.com")).toBeNull();
    expect(normalizeEmail("jane@")).toBeNull();
    expect(normalizeEmail("jane@localhost")).toBeNull();
    expect(normalizeEmail("jane doe@example.com")).toBeNull();
    expect(normalizeEmail("jane@exam ple.com")).toBeNull();
    expect(normalizeEmail("jane..doe@example.com")).toBeNull();
    expect(normalizeEmail(".jane@example.com")).toBeNull();
    expect(normalizeEmail("jane@-example.com")).toBeNull();
    // Right-to-left override embedded in the local part.
    expect(normalizeEmail("jane‮@example.com")).toBeNull();
    expect(normalizeEmail("jäne@example.com")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(65)}@example.com`)).toBeNull();
    expect(normalizeEmail(`a@${"b".repeat(64)}.com`)).toBeNull();
    expect(normalizeEmail(`a@${"b.".repeat(100)}com`)).toBeNull();
    expect(normalizeEmail(undefined as unknown as string)).toBeNull();
    expect(normalizeEmail(42 as unknown as string)).toBeNull();
  });

  it("accepts the full RFC local-part alphabet the database accepts", () => {
    expect(normalizeEmail("o'brien+tag_1@sub.example.co.uk")).toBe(
      "o'brien+tag_1@sub.example.co.uk"
    );
  });
});

describe("emailDigest", () => {
  const ring = keyRing(2, { 1: 1, 2: 2 });

  it("is a keyed HMAC-SHA256 under the active key, labelled with the key id", () => {
    const digest = emailDigest("jane@example.com", ring);
    const expected = createHmac("sha256", Buffer.alloc(32, 2))
      .update("jane@example.com", "utf8")
      .digest("hex");
    expect(digest).toBe(`2:${expected}`);
  });

  it("is stable across case, whitespace and compatibility forms", () => {
    const canonical = emailDigest("jane@example.com", ring);
    const inputs = [
      "JANE@EXAMPLE.COM",
      "  jane@example.com  ",
      "\tJane@Example.com\n",
      "ｊａｎｅ@example.com",
    ];
    for (const input of inputs) {
      expect(emailDigest(input, ring)).toBe(canonical);
    }
  });

  it("changes with the active key so a rotated ring never collides with the old one", () => {
    const rotated = keyRing(1, { 1: 1, 2: 2 });
    expect(emailDigest("jane@example.com", rotated)).not.toBe(
      emailDigest("jane@example.com", ring)
    );
    expect(emailDigest("jane@example.com", rotated).startsWith("1:")).toBe(
      true
    );
  });

  it("refuses to digest an email the normalizer rejects", () => {
    expect(() => emailDigest("not an email", ring)).toThrow(TypeError);
  });
});

describe("networkFingerprint", () => {
  it("is a SHA-256 hex over the address and user agent, never the raw values", () => {
    const fingerprint = networkFingerprint("203.0.113.9", "Mozilla/5.0");
    expect(fingerprint).toMatch(SHA256_HEX);
    expect(fingerprint).not.toContain("203.0.113.9");
    expect(fingerprint).toBe(networkFingerprint("203.0.113.9", "Mozilla/5.0"));
    expect(fingerprint).not.toBe(
      networkFingerprint("203.0.113.10", "Mozilla/5.0")
    );
    expect(fingerprint).not.toBe(networkFingerprint("203.0.113.9", "curl/8"));
  });

  it("treats missing inputs as unknown rather than throwing", () => {
    expect(networkFingerprint(null, null)).toMatch(SHA256_HEX);
    expect(networkFingerprint(null, null)).toBe(
      networkFingerprint(undefined, "")
    );
  });
});
