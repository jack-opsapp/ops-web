/**
 * GET /api/opportunities/[id]/preflight — granular-permission gate.
 *
 * The conversion preflight reads pipeline + project records to surface dedup
 * candidates before a win, so it is gated on the granular `pipeline.manage`
 * permission via checkPermissionById (NEVER a role filter) — the same gate as
 * the convert route. The browser client runs as anon and cannot call the
 * SECURITY DEFINER RPC directly, so this service-role route is the only path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkPermMock, findUserMock, verifyAuthMock, preflightMock } =
  vi.hoisted(() => ({
    checkPermMock: vi.fn(),
    findUserMock: vi.fn(),
    verifyAuthMock: vi.fn(),
    preflightMock: vi.fn(async () => ({
      existingLinkedProject: null,
      duplicateCandidates: [],
      otherClientProjects: [],
      suggestedName: "1240 W 6th Ave",
    })),
  }));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({}),
}));
vi.mock("@/lib/supabase/helpers", () => ({ setSupabaseOverride: vi.fn() }));
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyAuthMock }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: findUserMock }));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermMock,
}));
vi.mock("@/lib/api/services/project-conversion-service", () => ({
  ProjectConversionService: { getConversionPreflight: preflightMock },
}));

import { GET } from "@/app/api/opportunities/[id]/preflight/route";

const reqObj = {} as unknown as Parameters<typeof GET>[0];
const params = { params: Promise.resolve({ id: "opp-1" }) };

beforeEach(() => {
  verifyAuthMock.mockResolvedValue({ uid: "fb-1", email: "u@co.com" });
  findUserMock.mockResolvedValue({ id: "user-1", company_id: "co-1" });
});
afterEach(() => vi.clearAllMocks());

describe("preflight route — pipeline.manage gate", () => {
  it("returns 401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await GET(reqObj, params);
    expect(res.status).toBe(401);
    expect(preflightMock).not.toHaveBeenCalled();
  });

  it("returns 403 and never reads preflight when pipeline.manage is denied", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await GET(reqObj, params);
    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith("user-1", "pipeline.manage");
    expect(preflightMock).not.toHaveBeenCalled();
  });

  it("returns 200 and the preflight for the caller's company when granted", async () => {
    checkPermMock.mockResolvedValue(true);
    const res = await GET(reqObj, params);
    expect(res.status).toBe(200);
    expect(preflightMock).toHaveBeenCalledWith("opp-1", "co-1");
    const json = await res.json();
    expect(json.suggestedName).toBe("1240 W 6th Ave");
  });
});
