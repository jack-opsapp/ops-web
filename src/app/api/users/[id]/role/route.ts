/**
 * Atomic member role replacement.
 *
 * Web and iOS send the exact current role snapshot, the desired role, and any
 * lead-responsibility transfers. The service-only RPC commits them together,
 * preventing role reductions from hiding leads that remain assigned.
 */

import { NextRequest, NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface AssignmentResolution {
  opportunity_id: string;
  expected_assigned_to: string;
  expected_assignment_version: number;
  new_assigned_to: string | null;
}

interface GuardedRequestBody {
  expectedRoleId: string | null;
  newRoleId: string | null;
  assignmentResolutions: AssignmentResolution[];
}

interface RpcError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

const BODY_KEYS = [
  "assignmentResolutions",
  "expectedRoleId",
  "newRoleId",
] as const;
const RESOLUTION_KEYS = [
  "expected_assigned_to",
  "expected_assignment_version",
  "new_assigned_to",
  "opportunity_id",
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isNullableUuid(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && UUID_PATTERN.test(value))
  );
}

function validateAssignmentResolutions(
  value: unknown
): value is AssignmentResolution[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();

  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, RESOLUTION_KEYS) ||
      typeof item.opportunity_id !== "string" ||
      !UUID_PATTERN.test(item.opportunity_id) ||
      typeof item.expected_assigned_to !== "string" ||
      !UUID_PATTERN.test(item.expected_assigned_to) ||
      !Number.isSafeInteger(item.expected_assignment_version) ||
      (item.expected_assignment_version as number) < 0 ||
      !isNullableUuid(item.new_assigned_to) ||
      seen.has(item.opportunity_id)
    ) {
      return false;
    }
    seen.add(item.opportunity_id);
  }
  return true;
}

function parseBody(value: unknown): GuardedRequestBody | null {
  if (!isRecord(value) || !hasExactKeys(value, BODY_KEYS)) return null;
  if (
    !isNullableUuid(value.expectedRoleId) ||
    !isNullableUuid(value.newRoleId) ||
    !validateAssignmentResolutions(value.assignmentResolutions)
  ) {
    return null;
  }
  return value as unknown as GuardedRequestBody;
}

function parseDetails(
  details: string | null | undefined
): Record<string, unknown> {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rpcErrorResponse(error: RpcError): NextResponse {
  const message = error.message ?? "role_update_failed";
  const details = parseDetails(error.details);

  if (message === "assignment_resolution_required") {
    return NextResponse.json(
      {
        code: "assignment_resolution_required",
        strandedCount:
          typeof details.stranded_count === "number"
            ? details.stranded_count
            : 0,
        stranded: Array.isArray(details.stranded) ? details.stranded : [],
        eligibleAssignees: Array.isArray(details.eligible_assignees)
          ? details.eligible_assignees
          : [],
      },
      { status: 409 }
    );
  }
  if (message === "permission_snapshot_mismatch") {
    return NextResponse.json(
      {
        code: message,
        currentRoleId:
          details.current_role_id === null ||
          typeof details.current_role_id === "string"
            ? details.current_role_id
            : null,
      },
      { status: 409 }
    );
  }
  if (message === "assignment_resolution_conflict") {
    return NextResponse.json({ code: message, ...details }, { status: 409 });
  }
  if (message === "target_is_admin") {
    return NextResponse.json({ code: message }, { status: 409 });
  }
  if (error.code === "42501") {
    return NextResponse.json({ code: "access_denied" }, { status: 403 });
  }
  if (
    error.code === "P0002" ||
    message === "target_user_not_found" ||
    message === "role_not_found"
  ) {
    return NextResponse.json({ code: message }, { status: 404 });
  }
  if (error.code === "22023" || error.code === "23514") {
    return NextResponse.json({ code: message }, { status: 400 });
  }

  console.error("[api/users/[id]/role] Guarded RPC failed", {
    code: error.code,
    message,
  });
  return NextResponse.json({ code: "role_update_failed" }, { status: 500 });
}

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }

  let firebaseUser: Awaited<ReturnType<typeof verifyAuthToken>>;
  try {
    firebaseUser = await verifyAuthToken(token);
  } catch {
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  }

  const body = parseBody(rawBody);
  const { id: targetUserId } = await context.params;
  if (!body || !UUID_PATTERN.test(targetUserId)) {
    return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  }

  const caller = await findUserByAuth(
    firebaseUser.uid,
    firebaseUser.email,
    "id, company_id"
  );
  if (
    !caller ||
    typeof caller.id !== "string" ||
    !UUID_PATTERN.test(caller.id)
  ) {
    return NextResponse.json({ code: "access_denied" }, { status: 403 });
  }

  const db = getServiceRoleClient();
  const { data, error } = await db.rpc("replace_user_role_as_system", {
    p_actor_user_id: caller.id,
    p_target_user_id: targetUserId,
    p_expected_role_id: body.expectedRoleId,
    p_new_role_id: body.newRoleId,
    p_assignment_resolutions: body.assignmentResolutions,
  });

  if (error) return rpcErrorResponse(error);
  if (
    !isRecord(data) ||
    data.ok !== true ||
    data.user_id !== targetUserId ||
    !(data.role_id === null || typeof data.role_id === "string") ||
    typeof data.legacy_role !== "string" ||
    typeof data.resolved_assignments !== "number"
  ) {
    console.error("[api/users/[id]/role] Invalid guarded RPC result");
    return NextResponse.json({ code: "role_update_failed" }, { status: 500 });
  }

  // The role is already committed. Clearing this rail prompt is best-effort
  // and deliberately cannot turn a successful atomic change into a retry.
  if (typeof caller.company_id === "string") {
    const { error: notificationError } = await db
      .from("notifications")
      .update({ is_read: true })
      .eq("company_id", caller.company_id)
      .eq("type", "role_needed")
      .like("action_url", `%assignRole=${targetUserId}%`)
      .eq("is_read", false);
    if (notificationError) {
      console.error(
        "[api/users/[id]/role] role_needed notification clear failed",
        notificationError.message
      );
    }
  }

  return NextResponse.json({
    ok: true,
    userId: targetUserId,
    roleId: data.role_id,
    legacyRole: data.legacy_role,
    resolvedAssignments: data.resolved_assignments,
  });
}
