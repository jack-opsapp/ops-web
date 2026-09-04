import { createHash, timingSafeEqual } from "node:crypto";

export function secureTokenEquals(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function readBearerToken(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function validateIdempotencyKey(value: string | null): string | null {
  const key = value?.trim() ?? "";
  if (key.length < 8 || key.length > 200) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) return null;
  return key;
}
