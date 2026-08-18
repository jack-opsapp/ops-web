import { describe, expect, it } from "vitest";

import {
  isValidCodeChallenge,
  isValidCodeVerifier,
  s256Challenge,
  verifyS256Challenge,
} from "@/lib/agent-control-plane/mcp/oauth/pkce";

/**
 * RFC 7636 Appendix B — the normative S256 test vector. If this drifts, every
 * Claude authorization exchange breaks, so it is asserted verbatim.
 */
const RFC_7636_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_7636_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const UNRESERVED_43 = `${"A".repeat(39)}-._~`;
const NON_STRINGS: readonly unknown[] = [
  null,
  undefined,
  42,
  0,
  true,
  false,
  {},
  [],
  [RFC_7636_VERIFIER],
  Symbol("verifier"),
  Buffer.from(RFC_7636_VERIFIER, "utf8"),
];

describe("PKCE S256 challenge derivation", () => {
  it("reproduces the RFC 7636 Appendix B vector exactly", () => {
    expect(RFC_7636_VERIFIER).toHaveLength(43);
    expect(s256Challenge(RFC_7636_VERIFIER)).toBe(RFC_7636_CHALLENGE);
  });

  it("emits unpadded base64url of the SHA-256 digest", () => {
    const challenge = s256Challenge(UNRESERVED_43);

    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toContain("=");
  });

  it("is deterministic and collision-free across distinct verifiers", () => {
    expect(s256Challenge(RFC_7636_VERIFIER)).toBe(
      s256Challenge(RFC_7636_VERIFIER)
    );
    expect(s256Challenge(`${"a".repeat(43)}`)).not.toBe(
      s256Challenge(`${"a".repeat(42)}b`)
    );
  });
});

describe("PKCE S256 verification", () => {
  it("accepts the verifier that produced the stored challenge", () => {
    expect(verifyS256Challenge(RFC_7636_VERIFIER, RFC_7636_CHALLENGE)).toBe(
      true
    );
    expect(
      verifyS256Challenge(UNRESERVED_43, s256Challenge(UNRESERVED_43))
    ).toBe(true);
  });

  it("rejects a verifier that does not hash to the stored challenge", () => {
    expect(
      verifyS256Challenge(
        `${RFC_7636_VERIFIER.slice(0, 42)}A`,
        RFC_7636_CHALLENGE
      )
    ).toBe(false);
    expect(verifyS256Challenge("a".repeat(43), RFC_7636_CHALLENGE)).toBe(false);
  });

  it("cannot be downgraded to `plain` by echoing the verifier as the challenge", () => {
    expect(verifyS256Challenge(RFC_7636_VERIFIER, RFC_7636_VERIFIER)).toBe(
      false
    );
  });

  it("rejects a stored challenge of the wrong length without throwing", () => {
    expect(
      verifyS256Challenge(RFC_7636_VERIFIER, RFC_7636_CHALLENGE.slice(0, 42))
    ).toBe(false);
    expect(
      verifyS256Challenge(RFC_7636_VERIFIER, `${RFC_7636_CHALLENGE}A`)
    ).toBe(false);
    expect(verifyS256Challenge(RFC_7636_VERIFIER, "")).toBe(false);
  });

  it.each([
    { label: "a verifier one character below the 43-char floor", value: "a".repeat(42) },
    { label: "a verifier one character above the 128-char ceiling", value: "a".repeat(129) },
    { label: "an empty verifier", value: "" },
    { label: "a verifier containing a space", value: `${"a".repeat(42)} ` },
    { label: "a verifier containing base64 padding", value: `${"a".repeat(42)}=` },
    { label: "a verifier containing a plus", value: `${"a".repeat(42)}+` },
    { label: "a verifier containing a slash", value: `${"a".repeat(42)}/` },
    { label: "a verifier containing a newline", value: `${"a".repeat(42)}\n` },
    { label: "a verifier containing a percent escape", value: `${"a".repeat(40)}%20` },
  ])("rejects $label", ({ value }) => {
    expect(verifyS256Challenge(value, s256Challenge(value))).toBe(false);
  });

  it.each(NON_STRINGS.map((value) => ({ value })))(
    "rejects the non-string verifier %#",
    ({ value }) => {
      expect(verifyS256Challenge(value, RFC_7636_CHALLENGE)).toBe(false);
    }
  );
});

describe("PKCE parameter shape guards", () => {
  it("accepts the RFC length boundaries exactly", () => {
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(128))).toBe(true);
    expect(isValidCodeChallenge("a".repeat(43))).toBe(true);
    expect(isValidCodeChallenge("a".repeat(128))).toBe(true);
  });

  it("rejects one character outside each boundary", () => {
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeChallenge("a".repeat(42))).toBe(false);
    expect(isValidCodeChallenge("a".repeat(129))).toBe(false);
  });

  it("accepts the full RFC 7636 unreserved alphabet", () => {
    expect(isValidCodeVerifier(UNRESERVED_43)).toBe(true);
    expect(isValidCodeChallenge(UNRESERVED_43)).toBe(true);
    expect(isValidCodeVerifier(RFC_7636_VERIFIER)).toBe(true);
    expect(isValidCodeChallenge(RFC_7636_CHALLENGE)).toBe(true);
  });

  it.each([
    { label: "a space", value: `${"a".repeat(42)} ` },
    { label: "a tab", value: `${"a".repeat(42)}\t` },
    { label: "a carriage return", value: `${"a".repeat(42)}\r` },
    { label: "base64 padding", value: `${"a".repeat(42)}=` },
    { label: "a plus", value: `${"a".repeat(42)}+` },
    { label: "a slash", value: `${"a".repeat(42)}/` },
    { label: "a quote", value: `${"a".repeat(42)}"` },
    { label: "a NUL byte", value: `${"a".repeat(42)}\u0000` },
    { label: "a non-ASCII letter", value: `${"a".repeat(42)}é` },
  ])("rejects $label in either parameter", ({ value }) => {
    expect(isValidCodeVerifier(value)).toBe(false);
    expect(isValidCodeChallenge(value)).toBe(false);
  });

  it.each(NON_STRINGS.map((value) => ({ value })))(
    "rejects the non-string parameter %#",
    ({ value }) => {
      expect(isValidCodeVerifier(value)).toBe(false);
      expect(isValidCodeChallenge(value)).toBe(false);
    }
  );
});
