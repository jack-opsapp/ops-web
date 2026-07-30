import { afterEach, describe, expect, it, vi } from "vitest";

import { createConfiguredExternalApiPrivateCache } from "@/lib/external-api/analytics/private-cache";

describe("configured external API private cache", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("bypasses private analytics caching without contacting an external provider", async () => {
    vi.stubEnv("EXTERNAL_API_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("EXTERNAL_API_REDIS_REST_TOKEN", "redis-secret");
    const fetchMock = vi.fn().mockRejectedValue(new Error("must not be called"));
    vi.stubGlobal("fetch", fetchMock);

    const cache = createConfiguredExternalApiPrivateCache();

    await expect(
      cache.get(`ops:external:v1:private:${"A".repeat(43)}`)
    ).resolves.toEqual({ outcome: "unavailable", value: null });
    await expect(
      cache.set(`ops:external:v1:private:${"A".repeat(43)}`, { safe: true }, 60)
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
