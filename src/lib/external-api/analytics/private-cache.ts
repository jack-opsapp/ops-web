import "server-only";

import { createHash } from "node:crypto";

export type ExternalApiPrivateCacheRead =
  | Readonly<{ outcome: "hit"; value: unknown }>
  | Readonly<{ outcome: "miss" | "unavailable"; value: null }>;

export interface ExternalApiPrivateCache {
  get(key: string): Promise<ExternalApiPrivateCacheRead>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createExternalApiPrivateCacheKey(value: unknown): string {
  return `ops:external:v1:private:${createHash("sha256")
    .update(stableJson(value), "utf8")
    .digest("base64url")}`;
}

const configuredCache: ExternalApiPrivateCache = Object.freeze({
  async get(): Promise<ExternalApiPrivateCacheRead> {
    return { outcome: "unavailable", value: null };
  },
  async set(): Promise<boolean> {
    return false;
  },
});

/**
 * The pilot intentionally bypasses server-side private analytics caching.
 * Authorization still runs first, then the privacy-safe projection is read
 * directly from Supabase. A private cache can be reintroduced only through a
 * separately approved design and provider.
 */
export function createConfiguredExternalApiPrivateCache(): ExternalApiPrivateCache {
  return configuredCache;
}
