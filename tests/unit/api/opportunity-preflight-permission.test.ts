/**
 * GET /api/opportunities/[id]/preflight — actor-aware authorization.
 *
 * The browser client cannot call the definer RPC directly. This route supplies
 * the subject-derived actor/company; locked SQL authorizes the lead and filters
 * each returned project independently.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUserMock, verifyAuthMock, preflightMock, ConversionErrorMock } =
  vi.hoisted(() => ({
    findUserMock: vi.fn(),
    verifyAuthMock: vi.fn(),
    ConversionErrorMock: class extends Error {
      constructor(
        public kind: string,
        message: string
      ) {
        super(message);
      }
    },
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
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAuthMock,
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserMock,
}));
vi.mock("@/lib/api/services/project-conversion-service", () => ({
  ProjectConversionError: ConversionErrorMock,
  ProjectConversionService: { getConversionPreflight: preflightMock },
}));

import { GET } from "@/app/api/opportunities/[id]/preflight/route";

const reqObj = {} as unknown as Parameters<typeof GET>[0];
const params = { params: Promise.resolve({ id: "opp-1" }) };

beforeEach(() => {
  verifyAuthMock.mockResolvedValue({ uid: "fb-1", email: "mailbox@co.com" });
  findUserMock.mockResolvedValue({ id: "user-1", company_id: "co-1" });
});
afterEach(() => vi.clearAllMocks());

describe("preflight route — canonical SQL authorization", () => {
  it("returns 401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await GET(reqObj, params);
    expect(res.status).toBe(401);
    expect(preflightMock).not.toHaveBeenCalled();
  });

  it("returns 403 for the service's canonical access denial", async () => {
    preflightMock.mockRejectedValueOnce(
      new ConversionErrorMock("access_denied", "access_denied")
    );
    const res = await GET(reqObj, params);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a missing lead without disclosure", async () => {
    preflightMock.mockRejectedValueOnce(
      new ConversionErrorMock("not_found", "opportunity_not_found")
    );
    const res = await GET(reqObj, params);
    expect(res.status).toBe(404);
  });

  it("returns 200 and passes only subject-derived server identity", async () => {
    const res = await GET(reqObj, params);
    expect(res.status).toBe(200);
    expect(findUserMock).toHaveBeenCalledWith("fb-1", undefined);
    expect(preflightMock).toHaveBeenCalledWith("opp-1", "co-1", "user-1");
    const json = await res.json();
    expect(json.suggestedName).toBe("1240 W 6th Ave");
  });
});
