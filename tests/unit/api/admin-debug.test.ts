/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAdminAuth: vi.fn(),
  verifyFirebaseToken: vi.fn(),
  isAdminEmail: vi.fn(),
  getAdminSupabase: vi.fn(),
  listAllAuthUsers: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: mocks.verifyAdminAuth,
  verifyFirebaseToken: mocks.verifyFirebaseToken,
}));
vi.mock("@/lib/admin/admin-queries", () => ({
  isAdminEmail: mocks.isAdminEmail,
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: mocks.getAdminSupabase,
}));
vi.mock("@/lib/firebase/admin-sdk", () => ({
  listAllAuthUsers: mocks.listAllAuthUsers,
}));

import { GET } from "@/app/api/admin-debug/route";

function request(): NextRequest {
  return new NextRequest("https://app.opsapp.co/api/admin-debug");
}

describe("GET /api/admin-debug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdminAuth.mockResolvedValue(null);
    mocks.isAdminEmail.mockResolvedValue(false);
    mocks.getAdminSupabase.mockReturnValue({
      from: () => ({
        select: () => ({
          is: async () => ({ count: 55, error: null }),
        }),
      }),
    });
    mocks.listAllAuthUsers.mockResolvedValue([{ uid: "private-user" }]);
  });

  it("returns 401 without exposing diagnostics to an unauthenticated caller", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(body).not.toHaveProperty("envVars");
    expect(body).not.toHaveProperty("supabase");
    expect(body).not.toHaveProperty("firebaseAdmin");
    expect(mocks.getAdminSupabase).not.toHaveBeenCalled();
    expect(mocks.listAllAuthUsers).not.toHaveBeenCalled();
  });

  it("returns 403 without diagnostics to a verified non-admin", async () => {
    mocks.verifyAdminAuth.mockResolvedValue({
      uid: "firebase-user",
      email: "member@opsapp.co",
      claims: {},
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Forbidden" });
    expect(mocks.getAdminSupabase).not.toHaveBeenCalled();
    expect(mocks.listAllAuthUsers).not.toHaveBeenCalled();
  });
});
