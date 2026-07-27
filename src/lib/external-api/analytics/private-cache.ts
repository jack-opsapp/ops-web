import "server-only";

import { createHash } from "node:crypto";

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

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

function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function createExternalApiPrivateCache(config: {
  url: string | undefined;
  token: string | undefined;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
}): ExternalApiPrivateCache {
  const url = safeUrl(config.url);
  const token = config.token;
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 1_500;

  async function command(commandValue: unknown[]): Promise<unknown> {
    if (
      !url ||
      !token ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 10_000
    ) {
      throw new Error("private cache unavailable");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(commandValue),
        cache: "no-store",
        signal: controller.signal,
      });
      if (
        !response.ok ||
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("application/json")
      ) {
        throw new Error("private cache unavailable");
      }
      const payload = (await response.json()) as { result?: unknown };
      if (!Object.hasOwn(payload, "result")) {
        throw new Error("private cache unavailable");
      }
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  const cache: ExternalApiPrivateCache = {
    async get(key: string): Promise<ExternalApiPrivateCacheRead> {
      if (!/^ops:external:v1:private:[A-Za-z0-9_-]{43}$/.test(key)) {
        return { outcome: "unavailable", value: null };
      }
      try {
        const result = await command(["GET", key]);
        if (result === null) return { outcome: "miss", value: null };
        if (typeof result !== "string" || result.length > 524_288) {
          return { outcome: "unavailable", value: null };
        }
        return { outcome: "hit", value: JSON.parse(result) };
      } catch {
        return { outcome: "unavailable", value: null };
      }
    },
    async set(
      key: string,
      value: unknown,
      ttlSeconds: number
    ): Promise<boolean> {
      if (
        !/^ops:external:v1:private:[A-Za-z0-9_-]{43}$/.test(key) ||
        !Number.isInteger(ttlSeconds) ||
        ttlSeconds < 1 ||
        ttlSeconds > 300
      ) {
        return false;
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(value);
      } catch {
        return false;
      }
      if (Buffer.byteLength(serialized, "utf8") > 524_288) return false;
      try {
        return (
          (await command(["SET", key, serialized, "EX", ttlSeconds])) === "OK"
        );
      } catch {
        return false;
      }
    },
  };
  return Object.freeze(cache);
}

export function createConfiguredExternalApiPrivateCache(): ExternalApiPrivateCache {
  return createExternalApiPrivateCache({
    url: process.env.EXTERNAL_API_REDIS_REST_URL,
    token: process.env.EXTERNAL_API_REDIS_REST_TOKEN,
  });
}
