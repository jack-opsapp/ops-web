import { NextRequest, NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";

type AssignmentSource = "manual" | "suggestion_accept";

interface AssignmentBody {
  expectedAssignedTo?: unknown;
  expectedAssignmentVersion?: unknown;
  newAssignedTo?: unknown;
  source?: unknown;
  suggestionId?: unknown;
}

interface AssignmentRpcResult {
  ok?: boolean;
  conflict?: boolean;
  assigned_to?: string | null;
  assignment_version?: number;
  event_id?: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function extractToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function assignmentResponse(result: AssignmentRpcResult) {
  return {
    ok: result.ok === true,
    conflict: result.conflict === true,
    assignedTo: result.assigned_to ?? null,
    assignmentVersion: result.assignment_version,
    eventId: result.event_id ?? null,
  };
}

function rpcErrorStatus(code: string | undefined): number {
  switch (code) {
    case "42501":
      return 403;
    case "P0002":
      return 404;
    case "22023":
    case "22P02":
      return 400;
    default:
      return 500;
  }
}

/**
 * Human assignment boundary. The caller identity comes exclusively from the
 * verified Firebase token carried into the SECURITY INVOKER RPC; this route
 * never accepts actor or company authority from browser input.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = extractToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await verifyAuthToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: opportunityId } = await params;
  if (!isUuid(opportunityId)) {
    return NextResponse.json({ error: "Invalid opportunity" }, { status: 400 });
  }

  let body: AssignmentBody;
  try {
    body = (await request.json()) as AssignmentBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const source = body.source === undefined ? "manual" : body.source;
  const suggestionId = body.suggestionId ?? null;
  if (
    !Number.isSafeInteger(body.expectedAssignmentVersion) ||
    (body.expectedAssignmentVersion as number) < 0 ||
    !isNullableUuid(body.expectedAssignedTo) ||
    !isNullableUuid(body.newAssignedTo) ||
    (source !== "manual" && source !== "suggestion_accept") ||
    (source === "suggestion_accept" && !isUuid(suggestionId)) ||
    (source === "manual" && suggestionId !== null)
  ) {
    return NextResponse.json(
      { error: "Invalid assignment snapshot" },
      { status: 400 }
    );
  }

  const client = getAccessTokenClient(token);
  const { data, error } = await client.rpc("change_opportunity_assignment", {
    p_opportunity_id: opportunityId,
    p_expected_assignment_version: body.expectedAssignmentVersion as number,
    p_expected_assigned_to: body.expectedAssignedTo,
    p_new_assigned_to: body.newAssignedTo,
    p_source: source as AssignmentSource,
    p_suggestion_id: suggestionId,
    p_metadata: { surface: "web" },
  });

  if (error) {
    const status = rpcErrorStatus(error.code);
    const accessLost =
      status === 403 && error.message === "assignment_access_lost";
    if (status === 500) {
      console.error("[OpportunityAssignment] Guarded RPC failed", {
        code: error.code ?? "unknown",
      });
    }
    return NextResponse.json(
      {
        error: status === 500 ? "Assignment failed" : "Assignment not allowed",
        ...(accessLost ? { accessLost: true } : {}),
      },
      { status }
    );
  }

  const result = (data ?? {}) as AssignmentRpcResult;
  if (
    typeof result.ok !== "boolean" ||
    typeof result.conflict !== "boolean" ||
    !Number.isSafeInteger(result.assignment_version) ||
    !isNullableUuid(result.assigned_to) ||
    !isNullableUuid(result.event_id)
  ) {
    console.error(
      "[OpportunityAssignment] Guarded RPC returned an invalid result"
    );
    return NextResponse.json({ error: "Assignment failed" }, { status: 500 });
  }

  return NextResponse.json(assignmentResponse(result), {
    status: result.conflict ? 409 : 200,
  });
}
