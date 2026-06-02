/**
 * Integration test — GET /api/feature-flags
 *
 * Verifies that the route includes the `inbox_ui` per-company state in its
 * response, sourced from admin_feature_overrides via the service-role client.
 *
 * What's mocked (external boundaries only):
 *   - verifyAdminAuth            → Firebase JWT verification
 *   - findUserByAuth             → Supabase user lookup (returns id + company_id)
 *   - getServiceRoleClient       → DB calls (feature_flags, feature_flag_overrides)
 *   - AdminFeatureOverrideService.isFeatureEnabled → per-company flag check
 *
 * What's NOT mocked:
 *   - Route handler logic (the unit under test)
 *   - Flag result construction and JSON serialisation
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  verifyAdminAuthMock,
  findUserByAuthMock,
  getServiceRoleClientMock,
  isFeatureEnabledMock,
} = vi.hoisted(() => ({
  verifyAdminAuthMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  isFeatureEnabledMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAdminAuthMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isFeatureEnabled: isFeatureEnabledMock,
  },
}));

// Import the handler AFTER mocks are registered
import { NextRequest } from "next/server";
import { GET } from "@/app/api/feature-flags/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = "user-abc";
const TEST_COMPANY_ID = "company-xyz";
const TEST_UID = "firebase-uid-123";

function makeRequest(userId?: string): NextRequest {
  const url = userId
    ? `https://ops.test/api/feature-flags?userId=${userId}`
    : "https://ops.test/api/feature-flags";
  return new NextRequest(url, {
    method: "GET",
    headers: { authorization: "Bearer test-token" },
  });
}

/**
 * Build a minimal service-role Supabase double that handles the two queries
 * the route makes: feature_flags (returns flags array) and
 * feature_flag_overrides (returns empty overrides).
 */
function makeDbDouble(
  flags: Array<{ slug: string; enabled: boolean; routes: string[]; permissions: string[] }>
) {
  return {
    from: (table: string) => {
      if (table === "feature_flags") {
        return {
          select: () => Promise.resolve({ data: flags, error: null }),
        };
      }
      if (table === "feature_flag_overrides") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Auth resolves to a known user
  verifyAdminAuthMock.mockResolvedValue({ uid: TEST_UID, email: "test@ops.co" });

  // User lookup returns id + company_id
  findUserByAuthMock.mockResolvedValue({
    id: TEST_USER_ID,
    company_id: TEST_COMPANY_ID,
  });

  // Default: one global flag in the feature_flags table
  getServiceRoleClientMock.mockReturnValue(
    makeDbDouble([{ slug: "pipeline", enabled: true, routes: ["/pipeline"], permissions: ["pipeline.view"] }])
  );
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/feature-flags — inbox_ui inclusion", () => {
  it("includes inbox_ui with enabled: true when admin_feature_overrides returns true", async () => {
    isFeatureEnabledMock.mockResolvedValue(true);

    const res = await GET(makeRequest(TEST_USER_ID) );
    expect(res.status).toBe(200);

    const body = await res.json();
    const inboxFlag = body.find((f: { slug: string }) => f.slug === "inbox_ui");

    expect(inboxFlag).toBeDefined();
    expect(inboxFlag.enabled).toBe(true);
    expect(inboxFlag.hasOverride).toBe(false);
    expect(inboxFlag.routes).toContain("/inbox");
  });

  it("includes inbox_ui with enabled: false when admin_feature_overrides returns false", async () => {
    isFeatureEnabledMock.mockResolvedValue(false);

    const res = await GET(makeRequest(TEST_USER_ID) );
    expect(res.status).toBe(200);

    const body = await res.json();
    const inboxFlag = body.find((f: { slug: string }) => f.slug === "inbox_ui");

    expect(inboxFlag).toBeDefined();
    expect(inboxFlag.enabled).toBe(false);
  });

  it("includes inbox_ui with enabled: false (fail-closed) when the override check throws", async () => {
    isFeatureEnabledMock.mockRejectedValue(new Error("DB timeout"));

    const res = await GET(makeRequest(TEST_USER_ID) );
    expect(res.status).toBe(200);

    const body = await res.json();
    const inboxFlag = body.find((f: { slug: string }) => f.slug === "inbox_ui");

    expect(inboxFlag).toBeDefined();
    expect(inboxFlag.enabled).toBe(false);
  });

  it("calls isFeatureEnabled with the resolved company_id (not the user id)", async () => {
    isFeatureEnabledMock.mockResolvedValue(false);

    await GET(makeRequest(TEST_USER_ID) );

    expect(isFeatureEnabledMock).toHaveBeenCalledWith(TEST_COMPANY_ID, "inbox_ui");
  });

  it("includes inbox_ui disabled when no userId param (JWT-resolved path)", async () => {
    isFeatureEnabledMock.mockResolvedValue(false);

    // No userId param — route resolves user from JWT
    const res = await GET(makeRequest() );
    expect(res.status).toBe(200);

    const body = await res.json();
    const inboxFlag = body.find((f: { slug: string }) => f.slug === "inbox_ui");
    expect(inboxFlag).toBeDefined();
    expect(inboxFlag.enabled).toBe(false);
  });

  it("returns 403 when userId param does not match JWT-resolved user", async () => {
    findUserByAuthMock.mockResolvedValue({
      id: "different-user-id",
      company_id: TEST_COMPANY_ID,
    });

    const res = await GET(makeRequest("someone-elses-id") );
    expect(res.status).toBe(403);
  });

  it("returns 401 when auth fails", async () => {
    verifyAdminAuthMock.mockResolvedValue(null);

    const res = await GET(makeRequest(TEST_USER_ID) );
    expect(res.status).toBe(401);
  });

  it("also returns the standard global flags alongside inbox_ui", async () => {
    isFeatureEnabledMock.mockResolvedValue(true);

    const res = await GET(makeRequest(TEST_USER_ID) );
    const body = await res.json();

    const slugs = body.map((f: { slug: string }) => f.slug);
    expect(slugs).toContain("pipeline");
    expect(slugs).toContain("inbox_ui");
  });
});
