/**
 * duplicates merge + dismiss routes — granular-permission gate.
 *
 * The merge route previously relied on verifyAdminAuth alone; the dismiss route
 * likewise. Both now require the granular `pipeline.manage` permission via
 * checkPermissionById (never a role filter). These tests assert:
 *   - permission denied → 403, the merge/dismiss service is never invoked.
 *   - permission granted → 200, the service is invoked.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkPermMock,
  findUserMock,
  verifyAuthMock,
  mergeEntitiesMock,
  mergeClusterMock,
  dismissPairMock,
  applyEntityEditsMock,
  insertMock,
  fromMock,
} = vi.hoisted(() => ({
  checkPermMock: vi.fn(),
  findUserMock: vi.fn(),
  verifyAuthMock: vi.fn(),
  mergeEntitiesMock: vi.fn(async () => ({ applied: true })),
  mergeClusterMock: vi.fn(async () => {}),
  dismissPairMock: vi.fn(async () => {}),
  applyEntityEditsMock: vi.fn(async () => {}),
  insertMock: vi.fn(async () => ({ error: null })),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (...args: unknown[]) => {
      fromMock(...args);
      return { insert: insertMock };
    },
  }),
}));
vi.mock("@/lib/supabase/helpers", () => ({ setSupabaseOverride: vi.fn() }));
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyAuthMock }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: findUserMock }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: checkPermMock }));
vi.mock("@/lib/api/services/duplicate-detection-service", () => ({
  DuplicateDetectionService: {
    mergeEntities: mergeEntitiesMock,
    mergeCluster: mergeClusterMock,
    dismissPair: dismissPairMock,
    applyEntityEdits: applyEntityEditsMock,
  },
}));

import { POST as MERGE } from "@/app/api/duplicates/[id]/merge/route";
import { POST as DISMISS } from "@/app/api/duplicates/[id]/dismiss/route";

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof MERGE>[0];
}
const params = { params: Promise.resolve({ id: "review-1" }) };

beforeEach(() => {
  verifyAuthMock.mockResolvedValue({ uid: "fb-1", email: "u@co.com" });
  findUserMock.mockResolvedValue({ id: "user-1", company_id: "co-1" });
});
afterEach(() => vi.clearAllMocks());

describe("merge route — pipeline.manage gate", () => {
  it("returns 403 and never merges when pipeline.manage is denied", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await MERGE(req({ winnerId: "w-1" }), params);
    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith("user-1", "pipeline.manage");
    expect(mergeEntitiesMock).not.toHaveBeenCalled();
    expect(mergeClusterMock).not.toHaveBeenCalled();
  });

  it("returns 200 and merges (single) when pipeline.manage is granted", async () => {
    checkPermMock.mockResolvedValue(true);
    const res = await MERGE(req({ winnerId: "w-1" }), params);
    expect(res.status).toBe(200);
    expect(mergeEntitiesMock).toHaveBeenCalledWith("review-1", "w-1", "user-1", undefined);
  });

  it("routes confirmedOverrides to the service (operator-confirmed Q2 overrides)", async () => {
    checkPermMock.mockResolvedValue(true);
    await MERGE(req({ winnerId: "w-1", confirmedOverrides: { contact_email: "x@y.com" } }), params);
    expect(mergeEntitiesMock).toHaveBeenCalledWith("review-1", "w-1", "user-1", {
      contact_email: "x@y.com",
    });
  });

  it("still accepts the legacy fieldOverrides alias", async () => {
    checkPermMock.mockResolvedValue(true);
    await MERGE(req({ winnerId: "w-1", fieldOverrides: { address: "1 St" } }), params);
    expect(mergeEntitiesMock).toHaveBeenCalledWith("review-1", "w-1", "user-1", { address: "1 St" });
  });

  it("fires a dismissible duplicates_merged notification when display fields are supplied", async () => {
    checkPermMock.mockResolvedValue(true);
    const res = await MERGE(
      req({
        winnerId: "w-1",
        winnerTitle: "Deck — Smith",
        absorbedCount: 1,
        resolvedCount: 2,
        notificationActionUrl: "/dashboard?openProject=w-1&mode=view",
      }),
      params
    );
    expect(res.status).toBe(200);
    expect(fromMock).toHaveBeenCalledWith("notifications");
    const payload = (insertMock.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload.type).toBe("duplicates_merged");
    expect(payload.persistent).toBe(false);
    expect(payload.title).toContain("MERGED");
    expect(payload.action_label).toBe("VIEW");
    expect(payload.action_url).toBe("/dashboard?openProject=w-1&mode=view");
  });

  it("skips the notification when display fields are absent (merge still 200)", async () => {
    checkPermMock.mockResolvedValue(true);
    const res = await MERGE(req({ winnerId: "w-1" }), params);
    expect(res.status).toBe(200);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("dismiss route — pipeline.manage gate", () => {
  it("returns 403 and never dismisses when pipeline.manage is denied", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await DISMISS(req({}), params);
    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith("user-1", "pipeline.manage");
    expect(dismissPairMock).not.toHaveBeenCalled();
  });

  it("returns 200 and dismisses when pipeline.manage is granted", async () => {
    checkPermMock.mockResolvedValue(true);
    const res = await DISMISS(req({}), params);
    expect(res.status).toBe(200);
    expect(dismissPairMock).toHaveBeenCalledWith("review-1", "user-1");
  });
});

describe("duplicate-scan cron — recipient selection never filters by role", () => {
  const cronSource = readFileSync(
    path.join(process.cwd(), "src/app/api/cron/duplicate-scan/route.ts"),
    "utf8"
  );

  it("does not use a role filter (.in(\"role\", ...)) for recipient selection", () => {
    expect(cronSource).not.toMatch(/\.in\(\s*["']role["']/);
    expect(cronSource).not.toMatch(/\[\s*["']admin["']\s*,\s*["']owner["']/);
  });

  it("gates notification recipients on the granular pipeline.manage permission", () => {
    expect(cronSource).toContain("checkPermissionById");
    expect(cronSource).toMatch(/checkPermissionById\([\s\S]*?["']pipeline\.manage["']/);
  });
});
