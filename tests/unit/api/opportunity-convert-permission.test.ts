/**
 * POST /api/opportunities/[id]/convert — granular-permission gate (P6).
 *
 * Converting a won opportunity into a project mutates pipeline + project
 * records, so the route is gated on the granular `pipeline.manage` permission
 * via checkPermissionById (NEVER a role filter). These tests assert:
 *   - permission denied  → 403, the conversion service is never invoked.
 *   - permission granted → 200, the service is invoked with sourcePath
 *     'won_dialog', the caller's company, and the operator as decidedBy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkPermMock, findUserMock, verifyAuthMock, convertMock, linkMock } =
  vi.hoisted(() => ({
    checkPermMock: vi.fn(),
    findUserMock: vi.fn(),
    verifyAuthMock: vi.fn(),
    convertMock: vi.fn(async () => ({
      converted: true,
      alreadyConverted: false,
      projectId: "proj-1",
      opportunityId: "opp-1",
      dispositionId: "disp-1",
      relinkedEstimates: 2,
    })),
    linkMock: vi.fn(async () => ({
      converted: true,
      alreadyConverted: false,
      projectId: "existing-proj",
      opportunityId: "opp-1",
      linkedExisting: true,
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
  ProjectConversionService: {
    convertOpportunityToProject: convertMock,
    linkOpportunityToExistingProject: linkMock,
  },
}));

import { POST } from "@/app/api/opportunities/[id]/convert/route";

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}
const params = { params: Promise.resolve({ id: "opp-1" }) };

beforeEach(() => {
  verifyAuthMock.mockResolvedValue({ uid: "fb-1", email: "u@co.com" });
  findUserMock.mockResolvedValue({ id: "user-1", company_id: "co-1" });
});
afterEach(() => vi.clearAllMocks());

describe("convert route — pipeline.manage gate", () => {
  it("returns 401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await POST(req({}), params);
    expect(res.status).toBe(401);
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("returns 403 and never converts when pipeline.manage is denied", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await POST(req({ actualValue: 1000 }), params);
    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith("user-1", "pipeline.manage");
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("returns 200 and converts with won_dialog source when granted", async () => {
    checkPermMock.mockResolvedValue(true);
    const res = await POST(
      req({ actualValue: 1500, expectedStage: "won" }),
      params
    );
    expect(res.status).toBe(200);
    expect(convertMock).toHaveBeenCalledWith({
      opportunityId: "opp-1",
      companyId: "co-1",
      decidedBy: "user-1",
      sourcePath: "won_dialog",
      actualValue: 1500,
      expectedStage: "won",
      notesSeed: null,
      titleOverride: null,
    });
    expect(linkMock).not.toHaveBeenCalled();
  });

  it("forwards an operator-typed name as titleOverride", async () => {
    checkPermMock.mockResolvedValue(true);
    const res = await POST(req({ titleOverride: "Custom name" }), params);
    expect(res.status).toBe(200);
    expect(convertMock).toHaveBeenCalledWith(
      expect.objectContaining({ titleOverride: "Custom name" })
    );
  });

  it("routes to linkOpportunityToExistingProject when linkToProjectId is present (no create)", async () => {
    checkPermMock.mockResolvedValue(true);
    const res = await POST(
      req({ linkToProjectId: "existing-proj", actualValue: 800 }),
      params
    );
    expect(res.status).toBe(200);
    expect(linkMock).toHaveBeenCalledWith({
      opportunityId: "opp-1",
      companyId: "co-1",
      decidedBy: "user-1",
      sourcePath: "won_dialog",
      actualValue: 800,
      expectedStage: null,
      notesSeed: null,
      linkToProjectId: "existing-proj",
    });
    // the create path must NOT fire when linking an existing project.
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("tolerates a missing body (conversion still proceeds with defaults)", async () => {
    checkPermMock.mockResolvedValue(true);
    const badReq = {
      json: async () => {
        throw new Error("no body");
      },
    } as unknown as Parameters<typeof POST>[0];
    const res = await POST(badReq, params);
    expect(res.status).toBe(200);
    expect(convertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opp-1",
        companyId: "co-1",
        sourcePath: "won_dialog",
        actualValue: null,
        expectedStage: null,
      })
    );
  });
});
