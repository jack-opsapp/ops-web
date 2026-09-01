import "server-only";

import { createHash } from "node:crypto";

import { secretsEqual } from "./tokens";

/**
 * PKCE (RFC 7636), S256 only. Claude sends code_challenge_method=S256 on
 * every authorization request; `plain` is rejected at the authorize endpoint
 * and never reaches storage (the codes table CHECK-constrains S256 too).
 */

const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && CODE_CHALLENGE_PATTERN.test(value);
}

export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && CODE_VERIFIER_PATTERN.test(value);
}

export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyS256Challenge(
  verifier: unknown,
  storedChallenge: string
): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  return secretsEqual(s256Challenge(verifier), storedChallenge);
}
