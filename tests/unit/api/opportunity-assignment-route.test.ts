import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyTokenMock, rpcMock, accessTokenClientMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  rpcMock: vi.fn(),
  accessTokenClientMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyTokenMock,
}));

vi.mock("@/lib/supabase/accessToken-client", () => ({
  getAccessTokenClient: accessTokenClientMock,
}));

import { POST } from "@/app/api/opportunities/[id]/assignment/route";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const PREVIOUS_ASSIGNEE = "22222222-2222-4222-8222-222222222222";
const NEW_ASSIGNEE = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-8444-444444444444";

function request(body: unknown, token: string | null = "firebase-token") {
  return {
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

const context = (id = OPPORTUNITY_ID) => ({
  params: Promise.resolve({ id }),
});

const validBody = {
  expectedAssignedTo: PREVIOUS_ASSIGNEE,
  expectedAssignmentVersion: 7,
  newAssignedTo: NEW_ASSIGNEE,
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyTokenMock.mockResolvedValue({ uid: "firebase-user" });
  accessTokenClientMock.mockReturnValue({ rpc: rpcMock });
  rpcMock.mockResolvedValue({
    data: {
      ok: true,
      conflict: false,
      assigned_to: NEW_ASSIGNEE,
      assignment_version: 8,
      event_id: EVENT_ID,
    },
    error: null,
  });
});

describe("POST /api/opportunities/[id]/assignment", () => {
  it("uses the verified caller token and the human guarded RPC", async () => {
    const response = await POST(request(validBody), context());

    expect(response.status).toBe(200);
    expect(verifyTokenMock).toHaveBeenCalledWith("firebase-token");
    expect(accessTokenClientMock).toHaveBeenCalledWith("firebase-token");
    expect(rpcMock).toHaveBeenCalledWith("change_opportunity_assignment", {
      p_opportunity_id: OPPORTUNITY_ID,
      p_expected_assignment_version: 7,
      p_expected_assigned_to: PREVIOUS_ASSIGNEE,
      p_new_assigned_to: NEW_ASSIGNEE,
      p_source: "manual",
      p_suggestion_id: null,
      p_metadata: { surface: "web" },
    });
    expect(await response.json()).toEqual({
      ok: true,
      conflict: false,
      assignedTo: NEW_ASSIGNEE,
      assignmentVersion: 8,
      eventId: EVENT_ID,
    });
  });

  it("never trusts body actor or company identity", async () => {
    await POST(
      request({
        ...validBody,
        actorUserId: "attacker",
        companyId: "other-company",
      }),
      context()
    );

    const params = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(params).not.toHaveProperty("p_actor_user_id");
    expect(params).not.toHaveProperty("p_company_id");
    expect(JSON.stringify(params)).not.toContain("attacker");
    expect(JSON.stringify(params)).not.toContain("other-company");
  });

  it("maps a guarded snapshot conflict to 409 with authoritative state", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: false,
        conflict: true,
        assigned_to: NEW_ASSIGNEE,
        assignment_version: 9,
        event_id: null,
      },
      error: null,
    });

    const response = await POST(request(validBody), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      conflict: true,
      assignedTo: NEW_ASSIGNEE,
      assignmentVersion: 9,
      eventId: null,
    });
  });

  it("returns a state-free access-lost signal after an assigned-scope transfer", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "assignment_access_lost" },
    });

    const response = await POST(request(validBody), context());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Assignment not allowed",
      accessLost: true,
    });
  });

  it.each([
    [{ ...validBody, expectedAssignmentVersion: -1 }],
    [{ ...validBody, expectedAssignmentVersion: 1.5 }],
    [{ ...validBody, expectedAssignmentVersion: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...validBody, expectedAssignedTo: "not-a-uuid" }],
    [{ ...validBody, newAssignedTo: "not-a-uuid" }],
    [{ ...validBody, source: "system_repair" }],
    [{ ...validBody, source: "suggestion_accept", suggestionId: null }],
  ])("rejects malformed assignment input before the RPC", async (body) => {
    const response = await POST(request(body), context());

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("accepts an exact suggestion snapshot", async () => {
    await POST(
      request({
        ...validBody,
        source: "suggestion_accept",
        suggestionId: EVENT_ID,
      }),
      context()
    );

    expect(rpcMock).toHaveBeenCalledWith(
      "change_opportunity_assignment",
      expect.objectContaining({
        p_source: "suggestion_accept",
        p_suggestion_id: EVENT_ID,
      })
    );
  });

  it("returns 401 without a valid Firebase token", async () => {
    expect((await POST(request(validBody, null), context())).status).toBe(401);

    verifyTokenMock.mockRejectedValueOnce(new Error("expired"));
    expect((await POST(request(validBody), context())).status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects cookie-only authority for the state-changing boundary", async () => {
    const cookieOnlyRequest = {
      headers: new Headers(),
      cookies: { get: () => ({ value: "cookie-token" }) },
      json: async () => validBody,
    } as unknown as Parameters<typeof POST>[0];

    const response = await POST(cookieOnlyRequest, context());

    expect(response.status).toBe(401);
    expect(verifyTokenMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("validates the opportunity route id without disclosing a row", async () => {
    const response = await POST(request(validBody), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", 403],
    ["P0002", 404],
    ["22023", 400],
    ["22P02", 400],
    ["XX000", 500],
  ])(
    "maps RPC error %s to HTTP %s without leaking state",
    async (code, status) => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code, message: "sensitive database detail" },
      });

      const response = await POST(request(validBody), context());
      const body = await response.json();

      expect(response.status).toBe(status);
      expect(JSON.stringify(body)).not.toContain("sensitive database detail");
      if (status === 403 || status === 404) {
        expect(body).not.toHaveProperty("assignedTo");
        expect(body).not.toHaveProperty("assignmentVersion");
        expect(body).not.toHaveProperty("accessLost");
      }
    }
  );
});
