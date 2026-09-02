import "server-only";

import { createHash, randomBytes } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InstagramOAuthStateStore {
  pruneExpired(now: string): Promise<void>;
  insert(input: {
    nonceHash: string;
    adminEmail: string;
    expiresAt: string;
  }): Promise<void>;
  consume(nonceHash: string): Promise<string | null>;
}

function stateDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeAdminEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new Error("A verified admin email is required for Instagram OAuth state");
  }
  return normalized;
}

export async function createInstagramOAuthState(
  store: InstagramOAuthStateStore,
  adminEmail: string,
  now = new Date()
): Promise<string> {
  const normalizedEmail = normalizeAdminEmail(adminEmail);
  const stateToken = randomBytes(32).toString("base64url");
  await store.pruneExpired(now.toISOString());
  await store.insert({
    nonceHash: stateDigest(stateToken),
    adminEmail: normalizedEmail,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
  });
  return stateToken;
}

export async function consumeInstagramOAuthState(
  store: InstagramOAuthStateStore,
  stateToken: string
): Promise<string | null> {
  if (!stateToken || stateToken.length > 512) return null;
  const email = await store.consume(stateDigest(stateToken));
  if (!email) return null;
  try {
    return normalizeAdminEmail(email);
  } catch {
    return null;
  }
}
