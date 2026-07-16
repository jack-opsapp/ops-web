import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getIdTokenMock, fetchMock, requireSupabaseMock } = vi.hoisted(() => ({
  getIdTokenMock: vi.fn(),
  fetchMock: vi.fn(),
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({ getIdToken: getIdTokenMock }));
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

import {
  LeadAssignmentConflictError,
  LeadAssignmentService,
} from "@/lib/api/services/lead-assignment-service";

const input = {
  opportunityId: "11111111-1111-4111-8111-111111111111",
  expectedAssignedTo: "22222222-2222-4222-8222-222222222222",
  expectedAssignmentVersion: 7,
  newAssignedTo: "33333333-3333-4333-8333-333333333333",
} as const;

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "status text",
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("LeadAssignmentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    getIdTokenMock.mockResolvedValue("firebase-token");
    fetchMock.mockResolvedValue(
      response(200, {
        ok: true,
        conflict: false,
        assignedTo: input.newAssignedTo,
        assignmentVersion: 8,
        eventId: "44444444-4444-4444-8444-444444444444",
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the exact guarded snapshot with a verified caller token", async () => {
    await expect(
      LeadAssignmentService.changeAssignment(input)
    ).resolves.toEqual({
      ok: true,
      conflict: false,
      assignedTo: input.newAssignedTo,
      assignmentVersion: 8,
      eventId: "44444444-4444-4444-8444-444444444444",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/opportunities/${input.opportunityId}/assignment`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer firebase-token",
        },
        body: JSON.stringify({
          expectedAssignedTo: input.expectedAssignedTo,
          expectedAssignmentVersion: 7,
          newAssignedTo: input.newAssignedTo,
          source: "manual",
          suggestionId: null,
        }),
      }
    );
  });

  it("throws an authoritative conflict that callers can reconcile", async () => {
    fetchMock.mockResolvedValueOnce(
      response(409, {
        ok: false,
        conflict: true,
        assignedTo: null,
        assignmentVersion: 9,
        eventId: null,
      })
    );

    await expect(
      LeadAssignmentService.changeAssignment(input)
    ).rejects.toMatchObject({
      name: "LeadAssignmentConflictError",
      assignedTo: null,
      assignmentVersion: 9,
    } satisfies Partial<LeadAssignmentConflictError>);
  });

  it("classifies a denied post-transfer response as revoked access", async () => {
    fetchMock.mockResolvedValueOnce(
      response(403, {
        error: "Assignment not allowed",
        accessLost: true,
      })
    );

    await expect(
      LeadAssignmentService.changeAssignment(input)
    ).rejects.toMatchObject({
      name: "LeadAssignmentAccessLostError",
    });
  });

  it("does not classify an ordinary permission denial as lost view access", async () => {
    fetchMock.mockResolvedValueOnce(
      response(403, { error: "Assignment not allowed" })
    );

    await expect(
      LeadAssignmentService.changeAssignment(input)
    ).rejects.toMatchObject({
      name: "Error",
      message: "Lead assignment failed",
    });
  });

  it("fails closed without auth and never calls the route", async () => {
    getIdTokenMock.mockResolvedValueOnce(null);

    await expect(LeadAssignmentService.changeAssignment(input)).rejects.toThrow(
      "Not authenticated"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose database or transport detail in ordinary errors", async () => {
    fetchMock.mockResolvedValueOnce(
      response(500, { error: "sensitive database detail" })
    );

    await expect(LeadAssignmentService.changeAssignment(input)).rejects.toThrow(
      "Lead assignment failed"
    );
  });

  it("loads only the actor-authorized assignment candidates from the guarded RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        can_unassign: true,
        candidates: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            first_name: "Jason",
            last_name: "Zavarella",
            profile_image_url: "https://cdn.example/jason.jpg",
            user_color: "steel",
          },
        ],
      },
      error: null,
    });
    requireSupabaseMock.mockReturnValue({ rpc });

    await expect(
      LeadAssignmentService.listCandidates(input.opportunityId)
    ).resolves.toEqual({
      canUnassign: true,
      candidates: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          firstName: "Jason",
          lastName: "Zavarella",
          profileImageUrl: "https://cdn.example/jason.jpg",
          userColor: "steel",
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith("list_opportunity_assignment_candidates", {
      p_opportunity_id: input.opportunityId,
    });
  });
});
