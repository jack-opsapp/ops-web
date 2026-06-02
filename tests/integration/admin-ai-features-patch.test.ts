/**
 * Integration test — PATCH /api/admin/ai-features/[companyId]
 *
 * Verifies:
 *   1. `feature: inbox_ui` routes to AdminFeatureOverrideService.setFeatureOverride (generic, no wizard)
 *   2. `feature: phase_c`  routes to AdminFeatureOverrideService.setOverride (wizard side-effect)
 *   3. Admin auth guard is enforced (unauthenticated → 401)
 *   4. Unknown features yield 400
 *
 * External boundaries mocked:
 *   - verifyAdminAuth     → Firebase JWT verification
 *   - isAdminEmail        → admin table lookup
 *   - getServiceRoleClient / getAdminSupabase → DB
 *   - AdminFeatureOverrideService.setOverride / setFeatureOverride
 *   - setSupabaseOverride → no-op in tests (override context not needed)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  verifyAdminAuthMock,
  isAdminEmailMock,
  setOverrideMock,
  setFeatureOverrideMock,
  getServiceRoleClientMock,
  setSupabaseOverrideMock,
} = vi.hoisted(() => ({
  verifyAdminAuthMock: vi.fn(),
  isAdminEmailMock: vi.fn(),
  setOverrideMock: vi.fn(),
  setFeatureOverrideMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  setSupabaseOverrideMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAdminAuthMock,
}));

vi.mock("@/lib/admin/admin-queries", () => ({
  isAdminEmail: isAdminEmailMock,
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    setOverride: setOverrideMock,
    setFeatureOverride: setFeatureOverrideMock,
  },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: setSupabaseOverrideMock,
}));

// Import handler AFTER mocks are registered
import { PATCH } from "@/app/api/admin/ai-features/[companyId]/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_COMPANY_ID = "company-abc-123";
const ADMIN_EMAIL = "jackson@opsapp.co";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    new URL(`https://ops.test/api/admin/ai-features/${TEST_COMPANY_ID}`),
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer admin-token",
      },
      body: JSON.stringify(body),
    }
  );
}

function makeParams(companyId = TEST_COMPANY_ID) {
  return { params: Promise.resolve({ companyId }) };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Happy-path admin auth
  verifyAdminAuthMock.mockResolvedValue({ uid: "firebase-uid", email: ADMIN_EMAIL });
  isAdminEmailMock.mockResolvedValue(true);

  // Service-role client stub (used to pin the override context)
  getServiceRoleClientMock.mockReturnValue({});

  // Default: both service methods succeed
  setOverrideMock.mockResolvedValue(undefined);
  setFeatureOverrideMock.mockResolvedValue(undefined);
  setSupabaseOverrideMock.mockImplementation(() => undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/ai-features/[companyId] — inbox_ui", () => {
  it("calls setFeatureOverride (generic) when enabling inbox_ui", async () => {
    const res = await PATCH(makeRequest({ inbox_ui: true }), makeParams());

    expect(res.status).toBe(200);
    expect(setFeatureOverrideMock).toHaveBeenCalledOnce();
    expect(setFeatureOverrideMock).toHaveBeenCalledWith(
      TEST_COMPANY_ID,
      "inbox_ui",
      true,
      ADMIN_EMAIL
    );
    // setOverride (wizard path) must NOT be called
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it("calls setFeatureOverride (generic) when disabling inbox_ui", async () => {
    const res = await PATCH(makeRequest({ inbox_ui: false }), makeParams());

    expect(res.status).toBe(200);
    expect(setFeatureOverrideMock).toHaveBeenCalledOnce();
    expect(setFeatureOverrideMock).toHaveBeenCalledWith(
      TEST_COMPANY_ID,
      "inbox_ui",
      false,
      ADMIN_EMAIL
    );
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it("returns ok:true with updated list on success", async () => {
    const res = await PATCH(makeRequest({ inbox_ui: true }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.updated).toContainEqual({ feature: "inbox_ui", enabled: true });
  });
});

describe("PATCH /api/admin/ai-features/[companyId] — phase_c regression", () => {
  it("still calls setOverride (wizard path) for phase_c", async () => {
    const res = await PATCH(makeRequest({ phase_c: true }), makeParams());

    expect(res.status).toBe(200);
    expect(setOverrideMock).toHaveBeenCalledOnce();
    expect(setOverrideMock).toHaveBeenCalledWith(
      TEST_COMPANY_ID,
      "phase_c",
      true,
      ADMIN_EMAIL
    );
    // Generic setter must NOT be called for phase_c
    expect(setFeatureOverrideMock).not.toHaveBeenCalled();
  });

  it("still calls setOverride when disabling phase_c", async () => {
    const res = await PATCH(makeRequest({ phase_c: false }), makeParams());

    expect(res.status).toBe(200);
    expect(setOverrideMock).toHaveBeenCalledWith(
      TEST_COMPANY_ID,
      "phase_c",
      false,
      ADMIN_EMAIL
    );
    expect(setFeatureOverrideMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/ai-features/[companyId] — both features in one request", () => {
  it("routes phase_c to setOverride and inbox_ui to setFeatureOverride simultaneously", async () => {
    const res = await PATCH(
      makeRequest({ phase_c: true, inbox_ui: true }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect(setOverrideMock).toHaveBeenCalledOnce();
    expect(setFeatureOverrideMock).toHaveBeenCalledOnce();

    expect(setOverrideMock).toHaveBeenCalledWith(TEST_COMPANY_ID, "phase_c", true, ADMIN_EMAIL);
    expect(setFeatureOverrideMock).toHaveBeenCalledWith(TEST_COMPANY_ID, "inbox_ui", true, ADMIN_EMAIL);
  });
});

describe("PATCH /api/admin/ai-features/[companyId] — auth guard", () => {
  it("returns 401 when verifyAdminAuth returns null", async () => {
    verifyAdminAuthMock.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ inbox_ui: true }), makeParams());

    expect(res.status).toBe(401);
    expect(setFeatureOverrideMock).not.toHaveBeenCalled();
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the user has no email", async () => {
    verifyAdminAuthMock.mockResolvedValue({ uid: "uid-no-email" });

    const res = await PATCH(makeRequest({ inbox_ui: true }), makeParams());

    expect(res.status).toBe(401);
    expect(setFeatureOverrideMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the email is not in the admin list", async () => {
    isAdminEmailMock.mockResolvedValue(false);

    const res = await PATCH(makeRequest({ inbox_ui: true }), makeParams());

    expect(res.status).toBe(401);
    expect(setFeatureOverrideMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/ai-features/[companyId] — unknown features", () => {
  it("returns 400 when no recognised feature keys are present", async () => {
    const res = await PATCH(makeRequest({ unknown_flag: true }), makeParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no valid features/i);
  });
});

describe("PATCH /api/admin/ai-features/[companyId] — service errors", () => {
  it("returns 500 when setFeatureOverride throws", async () => {
    setFeatureOverrideMock.mockRejectedValue(new Error("DB connection lost"));

    const res = await PATCH(makeRequest({ inbox_ui: true }), makeParams());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("DB connection lost");
  });
});
