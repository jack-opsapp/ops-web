// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const isConfigured = vi.fn();
vi.mock("@/lib/analytics/app-store-client", () => ({ isAppStoreConfigured: () => isConfigured() }));
vi.mock("@/lib/admin/app-store-sync", () => ({ bootstrapIfNeeded: vi.fn(), syncOnce: vi.fn() }));
vi.mock("@/lib/admin/app-store-queries", () => ({ updateAscSyncStatus: vi.fn() }));

import { GET } from "@/app/api/cron/app-store-sync/route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/app-store-sync", {
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  isConfigured.mockReset();
});

describe("app-store-sync cron auth", () => {
  it("401 when no authorization header", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("401 when the bearer token is wrong", async () => {
    const res = await GET(req("Bearer nope"));
    expect(res.status).toBe(401);
  });

  it("short-circuits to skipped when configured-check is false", async () => {
    isConfigured.mockReturnValue(false);
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: true, reason: "App Store Connect not configured" });
  });
});
