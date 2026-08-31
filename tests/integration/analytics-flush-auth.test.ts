import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  verifyAdminAuthMock,
  findUserMock,
  rateLimitMock,
  companyMaybeSingleMock,
  upsertMock,
} = vi.hoisted(() => ({
  verifyAdminAuthMock: vi.fn(),
  findUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  companyMaybeSingleMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: (...args: unknown[]) => verifyAdminAuthMock(...args),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: (...args: unknown[]) => findUserMock(...args),
}));
vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === "companies") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: companyMaybeSingleMock }),
          }),
        };
      }
      if (table === "analytics_events") return { upsert: upsertMock };
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/analytics/flush/route";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    event_type: "action",
    event_name: "project_table_bulk_applied",
    session_id: "44444444-4444-4444-8444-444444444444",
    properties: { action: "archive", row_count: 3 },
    duration_ms: null,
    app_version: "2026.8.30",
    device_type: "desktop",
    os_version: "macOS",
    schema_version: 1,
    environment: "production",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function request(
  body: unknown,
  options: { token?: string | null; url?: string; origin?: string } = {}
) {
  const token = options.token === undefined ? "firebase-token" : options.token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.origin) headers.origin = options.origin;
  return new NextRequest(
    options.url ?? "https://app.opsapp.co/api/analytics/flush",
    { method: "POST", headers, body: JSON.stringify(body) }
  );
}

beforeEach(() => {
  verifyAdminAuthMock.mockReset();
  findUserMock.mockReset();
  rateLimitMock.mockReset();
  companyMaybeSingleMock.mockReset();
  upsertMock.mockReset();

  verifyAdminAuthMock.mockResolvedValue({ uid: "firebase-uid", email: "verified@example.com" });
  findUserMock.mockResolvedValue({
    id: USER_ID,
    company_id: COMPANY_ID,
    role: "Admin",
    is_active: true,
    deleted_at: null,
  });
  companyMaybeSingleMock.mockResolvedValue({
    data: { subscription_plan: "business" },
    error: null,
  });
  rateLimitMock.mockResolvedValue({ exceeded: false, retryAfterSec: 0 });
  upsertMock.mockResolvedValue({ error: null });
});

describe("POST /api/analytics/flush", () => {
  it("requires verified bearer authentication and writes nothing anonymously", async () => {
    verifyAdminAuthMock.mockResolvedValue(null);
    const response = await POST(request([event()], { token: null }));
    expect(response.status).toBe(401);
    expect(findUserMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("ignores claimed identity and stores the server-resolved active identity", async () => {
    const response = await POST(
      request([
        event({
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          company_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          role: "Owner",
          plan: "enterprise",
          platform: "ios",
        }),
      ])
    );
    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: EVENT_ID,
          user_id: USER_ID,
          company_id: COMPANY_ID,
          role: "Admin",
          plan: "business",
          platform: "web",
        }),
      ],
      { onConflict: "id", ignoreDuplicates: true }
    );
  });

  it("uses UUID conflict handling so an identical retry is idempotent", async () => {
    const payload = event();
    const first = await POST(request([payload]));
    const second = await POST(request([payload]));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(upsertMock.mock.calls[0]).toEqual(upsertMock.mock.calls[1]);
  });

  it("removes PII properties before the service-role write", async () => {
    await POST(
      request([
        event({
          properties: {
            action: "created",
            customer_email: "owner@example.com",
            project_id: EVENT_ID,
          },
        }),
      ])
    );
    expect(upsertMock.mock.calls[0]?.[0]?.[0]?.properties).toEqual({
      action: "created",
    });
  });

  it("rejects production telemetry claimed by localhost and test builds", async () => {
    const localhost = await POST(
      request([event()], {
        url: "http://localhost:3000/api/analytics/flush",
        origin: "http://localhost:3000",
      })
    );
    const testBuild = await POST(request([event({ environment: "test" })]));
    expect(localhost.status).toBe(400);
    expect(testBuild.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rate-limits by authenticated user and accepted event cost", async () => {
    rateLimitMock.mockResolvedValue({ exceeded: true, retryAfterSec: 42 });
    const response = await POST(request([event()]));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(rateLimitMock).toHaveBeenCalledWith({
      key: `analytics:${USER_ID}`,
      limit: 5000,
      windowSec: 3600,
      cost: 1,
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
