/**
 * draft-feedback route — granular-permission gate (replaces a role filter).
 *
 * The route previously gated on `["admin","owner"].includes(role)`, violating
 * the "never filter by role" rule. It now gates on the granular `inbox.send`
 * permission via checkPermissionById. These tests assert:
 *   - permission denied → 403, recordDraftOutcome never called.
 *   - permission granted + an owned discarded draft → 200 and bookkeeping.
 *   - browser-reported sent outcomes are rejected before they can train.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkPermMock,
  recordOutcomeMock,
  findUserMock,
  verifyAuthMock,
  fromMock,
} = vi.hoisted(() => ({
  checkPermMock: vi.fn(),
  recordOutcomeMock: vi.fn(async () => {}),
  findUserMock: vi.fn(),
  verifyAuthMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: fromMock }),
}));
vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: vi.fn(),
}));
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAuthMock,
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserMock,
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermMock,
}));
vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { recordDraftOutcome: recordOutcomeMock },
}));

import { POST } from "@/app/api/integrations/email/draft-feedback/route";

function makeRequest(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  verifyAuthMock.mockResolvedValue({ uid: "fb-1", email: "u@co.com" });
  findUserMock.mockResolvedValue({ id: "user-1", company_id: "co-1" });
  fromMock.mockImplementation(() => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: { id: "d-1" }, error: null })),
    };
    return query;
  });
  recordOutcomeMock.mockClear();
});

afterEach(() => vi.clearAllMocks());

describe("draft-feedback — granular permission gate", () => {
  it("returns 403 and skips recordDraftOutcome when inbox.send is denied", async () => {
    checkPermMock.mockResolvedValue(false);

    const res = await POST(
      makeRequest({
        draftHistoryId: "d-1",
        companyId: "co-1",
        userId: "user-1",
        outcome: "sent",
        finalVersion: "body",
      })
    );

    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith("user-1", "inbox.send");
    expect(recordOutcomeMock).not.toHaveBeenCalled();
  });

  it("returns 200 and records an owned discarded outcome when inbox.send is granted", async () => {
    checkPermMock.mockResolvedValue(true);

    const res = await POST(
      makeRequest({
        draftHistoryId: "d-1",
        companyId: "co-1",
        userId: "user-1",
        outcome: "discarded",
      })
    );

    expect(res.status).toBe(200);
    expect(recordOutcomeMock).toHaveBeenCalledWith(
      "d-1",
      "co-1",
      "user-1",
      "discarded"
    );
  });

  it("rejects a browser-reported sent outcome before it can train", async () => {
    checkPermMock.mockResolvedValue(true);

    const res = await POST(
      makeRequest({
        draftHistoryId: "d-1",
        companyId: "co-1",
        userId: "user-1",
        outcome: "sent",
        finalVersion: "body",
      })
    );

    expect(res.status).toBe(400);
    expect(recordOutcomeMock).not.toHaveBeenCalled();
  });

  it("never inspects a role field (the row select omits role)", async () => {
    checkPermMock.mockResolvedValue(true);
    await POST(
      makeRequest({
        draftHistoryId: "d-1",
        companyId: "co-1",
        userId: "user-1",
        outcome: "discarded",
      })
    );
    // findUserByAuth must be asked for id + company_id only — never role.
    const selectArg = findUserMock.mock.calls[0]?.[2] as string;
    expect(selectArg).not.toMatch(/role/);
  });
});
