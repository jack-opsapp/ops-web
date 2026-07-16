export type LeadAssignmentSource = "manual" | "suggestion_accept";

export interface ChangeLeadAssignmentInput {
  opportunityId: string;
  expectedAssignedTo: string | null;
  expectedAssignmentVersion: number;
  newAssignedTo: string | null;
  source?: LeadAssignmentSource;
  suggestionId?: string | null;
}

export interface LeadAssignmentResult {
  ok: true;
  conflict: false;
  assignedTo: string | null;
  assignmentVersion: number;
  eventId: string | null;
}

export interface LeadAssignmentCandidate {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  userColor: string | null;
}

export interface LeadAssignmentCandidates {
  canUnassign: boolean;
  candidates: LeadAssignmentCandidate[];
}

interface LeadAssignmentResponse {
  ok?: unknown;
  conflict?: unknown;
  accessLost?: unknown;
  assignedTo?: unknown;
  assignmentVersion?: unknown;
  eventId?: unknown;
}

function hasAuthoritativeState(
  value: LeadAssignmentResponse
): value is LeadAssignmentResponse & {
  assignedTo: string | null;
  assignmentVersion: number;
  eventId: string | null;
} {
  return (
    (value.assignedTo === null || typeof value.assignedTo === "string") &&
    Number.isSafeInteger(value.assignmentVersion) &&
    (value.assignmentVersion as number) >= 0 &&
    (value.eventId === null || typeof value.eventId === "string")
  );
}

export class LeadAssignmentConflictError extends Error {
  readonly assignedTo: string | null;
  readonly assignmentVersion: number;

  constructor(assignedTo: string | null, assignmentVersion: number) {
    super("Lead assignment changed before this update completed");
    this.name = "LeadAssignmentConflictError";
    this.assignedTo = assignedTo;
    this.assignmentVersion = assignmentVersion;
  }
}

/**
 * The guarded write can complete and then deny the caller's follow-up read
 * because the transfer removed their assigned-only access. Callers must purge
 * any cached copy instead of treating that state as an ordinary transport
 * failure.
 */
export class LeadAssignmentAccessLostError extends Error {
  constructor() {
    super("Lead assignment access was lost");
    this.name = "LeadAssignmentAccessLostError";
  }
}

export const LeadAssignmentService = {
  async listCandidates(
    opportunityId: string
  ): Promise<LeadAssignmentCandidates> {
    const { requireSupabase } = await import("@/lib/supabase/helpers");
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc(
      "list_opportunity_assignment_candidates",
      { p_opportunity_id: opportunityId }
    );
    if (error) throw new Error("Unable to load assignment candidates");

    const result = data as {
      can_unassign?: unknown;
      candidates?: unknown;
    } | null;
    if (
      typeof result?.can_unassign !== "boolean" ||
      !Array.isArray(result.candidates)
    ) {
      throw new Error("Unable to load assignment candidates");
    }

    const candidates = result.candidates.map((value) => {
      const row = value as Record<string, unknown>;
      const nullableStringKeys = [
        "first_name",
        "last_name",
        "profile_image_url",
        "user_color",
      ] as const;
      if (
        typeof row.id !== "string" ||
        nullableStringKeys.some(
          (key) => row[key] !== null && typeof row[key] !== "string"
        )
      ) {
        throw new Error("Unable to load assignment candidates");
      }
      return {
        id: row.id,
        firstName: (row.first_name as string | null) ?? null,
        lastName: (row.last_name as string | null) ?? null,
        profileImageUrl: (row.profile_image_url as string | null) ?? null,
        userColor: (row.user_color as string | null) ?? null,
      };
    });

    return { canUnassign: result.can_unassign, candidates };
  },

  async changeAssignment(
    input: ChangeLeadAssignmentInput
  ): Promise<LeadAssignmentResult> {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    if (!idToken) throw new Error("Not authenticated");

    let response: Response;
    try {
      response = await fetch(
        `/api/opportunities/${input.opportunityId}/assignment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            expectedAssignedTo: input.expectedAssignedTo,
            expectedAssignmentVersion: input.expectedAssignmentVersion,
            newAssignedTo: input.newAssignedTo,
            source: input.source ?? "manual",
            suggestionId: input.suggestionId ?? null,
          }),
        }
      );
    } catch {
      throw new Error("Lead assignment failed");
    }

    const body = (await response
      .json()
      .catch(() => ({}))) as LeadAssignmentResponse;
    if (
      response.status === 409 &&
      body.conflict === true &&
      hasAuthoritativeState(body)
    ) {
      throw new LeadAssignmentConflictError(
        body.assignedTo,
        body.assignmentVersion
      );
    }

    if (response.status === 403 && body.accessLost === true) {
      throw new LeadAssignmentAccessLostError();
    }

    if (!response.ok) {
      throw new Error("Lead assignment failed");
    }

    if (
      body.ok !== true ||
      body.conflict !== false ||
      !hasAuthoritativeState(body)
    ) {
      throw new Error("Lead assignment failed");
    }

    return {
      ok: true,
      conflict: false,
      assignedTo: body.assignedTo,
      assignmentVersion: body.assignmentVersion,
      eventId: body.eventId,
    };
  },
};
