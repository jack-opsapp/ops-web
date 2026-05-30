/**
 * POST /api/duplicates/conflicts — granular-permission gate + response shape.
 *
 * The conflict-detection route exposes DuplicateDetectionService.detectMergeConflicts
 * to the merge UI. It must require the granular `pipeline.manage` permission
 * (never a role filter) and return the service's `{ entityType, perLoser }`
 * shape verbatim. These tests assert:
 *   - permission denied → 403, the service is never invoked.
 *   - permission granted → 200, the service shape is returned.
 *   - missing/invalid reviewIds or winnerId → 400.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkPermMock, findUserMock, verifyAuthMock, detectConflictsMock } = vi.hoisted(
  () => ({
    checkPermMock: vi.fn(),
    findUserMock: vi.fn(),
    verifyAuthMock: vi.fn(),
    detectConflictsMock: vi.fn(),
  })
);

vi.mock("@/lib/supabase/server-client", () => ({ getServiceRoleClient: () => ({}) }));
vi.mock("@/lib/supabase/helpers", () => ({ setSupabaseOverride: vi.fn() }));
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyAuthMock }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: findUserMock }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: checkPermMock }));
vi.mock("@/lib/api/services/duplicate-detection-service", () => ({
  DuplicateDetectionService: { detectMergeConflicts: detectConflictsMock },
}));

import { POST } from "@/app/api/duplicates/conflicts/route";

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

const SERVICE_RESULT = {
  entityType: "opportunity" as const,
  perLoser: [
    {
      loserId: "loser-1",
      reconciliation: {
        fieldFill: { address: "1 Main St" },
        conflicts: [
          { field: "contact_email", winnerValue: "a@x.com", loserValue: "b@y.com" },
        ],
      },
    },
  ],
};

beforeEach(() => {
  verifyAuthMock.mockResolvedValue({ uid: "fb-1", email: "u@co.com" });
  findUserMock.mockResolvedValue({ id: "user-1", company_id: "co-1" });
  detectConflictsMock.mockResolvedValue(SERVICE_RESULT);
});
afterEach(() => vi.clearAllMocks());

describe("conflicts route — pipeline.manage gate", () => {
  it("returns 403 and never detects when pipeline.manage is denied", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await POST(req({ reviewIds: ["r-1"], winnerId: "w-1" }));
    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith("user-1", "pipeline.manage");
    expect(detectConflictsMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await POST(req({ reviewIds: ["r-1"], winnerId: "w-1" }));
    expect(res.status).toBe(401);
    expect(detectConflictsMock).not.toHaveBeenCalled();
  });
});

describe("conflicts route — input validation", () => {
  beforeEach(() => checkPermMock.mockResolvedValue(true));

  it("returns 400 when reviewIds is missing/empty", async () => {
    const res = await POST(req({ winnerId: "w-1" }));
    expect(res.status).toBe(400);
    expect(detectConflictsMock).not.toHaveBeenCalled();
  });

  it("returns 400 when winnerId is missing", async () => {
    const res = await POST(req({ reviewIds: ["r-1"] }));
    expect(res.status).toBe(400);
    expect(detectConflictsMock).not.toHaveBeenCalled();
  });
});

describe("conflicts route — response shape", () => {
  beforeEach(() => checkPermMock.mockResolvedValue(true));

  it("returns the service { entityType, perLoser } shape verbatim on 200", async () => {
    const res = await POST(req({ reviewIds: ["r-1"], winnerId: "w-1" }));
    expect(res.status).toBe(200);
    expect(detectConflictsMock).toHaveBeenCalledWith(["r-1"], "w-1");
    await expect(res.json()).resolves.toEqual(SERVICE_RESULT);
  });

  it("returns 500 with the error message when the service throws", async () => {
    detectConflictsMock.mockRejectedValue(new Error("winner not found"));
    const res = await POST(req({ reviewIds: ["r-1"], winnerId: "w-1" }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "winner not found" });
  });
});
