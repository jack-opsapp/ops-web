/**
 * POST /api/opportunities/[id]/convert — locked actor-aware authorization.
 *
 * Converting a won opportunity into a project mutates pipeline + project
 * records. The route authenticates the subject and forwards a server-created
 * human attribution plus the dialog assignment snapshot; locked SQL makes the
 * canonical authorization decision.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUserMock,
  verifyAuthMock,
  convertMock,
  linkMock,
  ConversionErrorMock,
} = vi.hoisted(() => ({
  findUserMock: vi.fn(),
  verifyAuthMock: vi.fn(),
  ConversionErrorMock: class extends Error {
    constructor(
      public kind: string,
      message: string,
      public guardReason?: string,
      public assignedTo?: string | null,
      public assignmentVersion?: number
    ) {
      super(message);
    }
  },
  convertMock: vi.fn(async () => ({
    converted: true,
    alreadyConverted: false,
    projectId: "proj-1",
    opportunityId: "opp-1",
    dispositionId: "disp-1",
    relinkedEstimates: 2,
    projectAccessible: true,
    assignmentVersion: 4,
  })),
  linkMock: vi.fn(async () => ({
    converted: true,
    alreadyConverted: false,
    projectId: "existing-proj",
    opportunityId: "opp-1",
    linkedExisting: true,
    projectAccessible: true,
    assignmentVersion: 4,
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
  verifyAuthMock.mockResolvedValue({ uid: "fb-1", email: "mailbox@co.com" });
  findUserMock.mockResolvedValue({ id: "user-1", company_id: "co-1" });
});
afterEach(() => vi.clearAllMocks());

describe("convert route — canonical SQL authorization and snapshot", () => {
  it("returns 401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await POST(req({}), params);
    expect(res.status).toBe(401);
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("returns 200 and converts with server-created won_dialog attribution", async () => {
    const res = await POST(
      req({
        actualValue: 1500,
        expectedStage: "won",
        expectedAssignmentVersion: 4,
      }),
      params
    );
    expect(res.status).toBe(200);
    expect(convertMock).toHaveBeenCalledWith({
      opportunityId: "opp-1",
      companyId: "co-1",
      decidedBy: "user-1",
      sourcePath: "won_dialog",
      expectedAssignmentVersion: 4,
      evidence: { surface: "web_won_dialog" },
      actualValue: 1500,
      expectedStage: "won",
      notesSeed: null,
      titleOverride: null,
    });
    expect(linkMock).not.toHaveBeenCalled();
  });

  it("forwards an operator-typed name as titleOverride", async () => {
    const res = await POST(
      req({ titleOverride: "Custom name", expectedAssignmentVersion: 4 }),
      params
    );
    expect(res.status).toBe(200);
    expect(convertMock).toHaveBeenCalledWith(
      expect.objectContaining({ titleOverride: "Custom name" })
    );
  });

  it("routes to linkOpportunityToExistingProject when linkToProjectId is present (no create)", async () => {
    const res = await POST(
      req({
        linkToProjectId: "existing-proj",
        actualValue: 800,
        expectedAssignmentVersion: 4,
      }),
      params
    );
    expect(res.status).toBe(200);
    expect(linkMock).toHaveBeenCalledWith({
      opportunityId: "opp-1",
      companyId: "co-1",
      decidedBy: "user-1",
      sourcePath: "won_dialog",
      expectedAssignmentVersion: 4,
      evidence: { surface: "web_won_dialog" },
      actualValue: 800,
      expectedStage: null,
      notesSeed: null,
      linkToProjectId: "existing-proj",
    });
    // the create path must NOT fire when linking an existing project.
    expect(convertMock).not.toHaveBeenCalled();
  });

  it.each([undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid expectedAssignmentVersion %s before conversion",
    async (expectedAssignmentVersion) => {
      const res = await POST(req({ expectedAssignmentVersion }), params);
      expect(res.status).toBe(400);
      expect(convertMock).not.toHaveBeenCalled();
      expect(linkMock).not.toHaveBeenCalled();
    }
  );

  it("rejects a missing body because it has no assignment snapshot", async () => {
    const badReq = {
      json: async () => {
        throw new Error("no body");
      },
    } as unknown as Parameters<typeof POST>[0];
    const res = await POST(badReq, params);
    expect(res.status).toBe(400);
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("resolves the OPS actor by verified auth subject only", async () => {
    await POST(req({ expectedAssignmentVersion: 4 }), params);
    expect(findUserMock).toHaveBeenCalledWith("fb-1", undefined);
  });

  it("maps assignment conflicts to 409 with authoritative ownership", async () => {
    convertMock.mockRejectedValueOnce(
      new ConversionErrorMock(
        "conflict",
        "assignment_snapshot_mismatch",
        "assignment_snapshot_mismatch",
        "user-2",
        5
      )
    );
    const res = await POST(req({ expectedAssignmentVersion: 4 }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      guardReason: "assignment_snapshot_mismatch",
      assignedTo: "user-2",
      assignmentVersion: 5,
    });
  });

  it("maps canonical denial to 403 and unavailable lead/link to 404", async () => {
    convertMock.mockRejectedValueOnce(
      new ConversionErrorMock("access_denied", "access_denied")
    );
    expect(
      (await POST(req({ expectedAssignmentVersion: 4 }), params)).status
    ).toBe(403);

    convertMock.mockRejectedValueOnce(
      new ConversionErrorMock("not_found", "project_link_unavailable")
    );
    expect(
      (await POST(req({ expectedAssignmentVersion: 4 }), params)).status
    ).toBe(404);
  });

  it("masks the internal project id when the converter cannot view it", async () => {
    convertMock.mockResolvedValueOnce({
      converted: true,
      alreadyConverted: false,
      projectId: "proj-hidden",
      opportunityId: "opp-1",
      dispositionId: "disp-hidden",
      relinkedEstimates: 0,
      projectAccessible: false,
      assignmentVersion: 4,
    });
    const res = await POST(req({ expectedAssignmentVersion: 4 }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ projectId: null });
  });
});
