/**
 * Atomic custom-role permission replacement.
 *
 * The API is shared by web and iOS. It accepts one exact optimistic snapshot,
 * one registry-complete desired state, and any required lead-responsibility
 * resolutions. The service-only database RPC commits all three together.
 */

import { NextRequest, NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  PERMISSION_EDITOR_REGISTRY,
  type PermissionScope,
} from "@/lib/types/permissions";

interface PermissionSnapshotEntry {
  permission: string;
  scope: PermissionScope;
}

interface PermissionReplacementEntry {
  permission: string;
  scope: PermissionScope | null;
}

interface AssignmentResolution {
  opportunity_id: string;
  expected_assigned_to: string;
  expected_assignment_version: number;
  new_assigned_to: string | null;
}

interface GuardedRequestBody {
  expectedPermissions: PermissionSnapshotEntry[];
  newPermissions: PermissionReplacementEntry[];
  assignmentResolutions: AssignmentResolution[];
}

interface RpcError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

const BODY_KEYS = [
  "assignmentResolutions",
  "expectedPermissions",
  "newPermissions",
] as const;
const ENTRY_KEYS = ["permission", "scope"] as const;
const RESOLUTION_KEYS = [
  "expected_assigned_to",
  "expected_assignment_version",
  "new_assigned_to",
  "opportunity_id",
] as const;
const VALID_SCOPES = new Set<PermissionScope>(["all", "assigned", "own"]);
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

function isScope(value: unknown): value is PermissionScope {
  return (
    typeof value === "string" && VALID_SCOPES.has(value as PermissionScope)
  );
}

function validateExpectedPermissions(
  value: unknown
): value is PermissionSnapshotEntry[] {
  if (!Array.isArray(value)) return false;

  let previous = "";
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ENTRY_KEYS) ||
      typeof item.permission !== "string" ||
      item.permission.length === 0 ||
      !isScope(item.scope) ||
      item.permission <= previous
    ) {
      return false;
    }
    previous = item.permission;
  }
  return true;
}

function validateNewPermissions(
  value: unknown
): value is PermissionReplacementEntry[] {
  if (
    !Array.isArray(value) ||
    value.length !== PERMISSION_EDITOR_REGISTRY.length
  ) {
    return false;
  }

  return value.every((item, index) => {
    const registered = PERMISSION_EDITOR_REGISTRY[index];
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ENTRY_KEYS) ||
      item.permission !== registered.id
    ) {
      return false;
    }
    return (
      item.scope === null ||
      registered.scopes.includes(item.scope as PermissionScope)
    );
  });
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
      !(
        item.new_assigned_to === null ||
        (typeof item.new_assigned_to === "string" &&
          UUID_PATTERN.test(item.new_assigned_to))
      ) ||
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
    !validateExpectedPermissions(value.expectedPermissions) ||
    !validateNewPermissions(value.newPermissions) ||
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
  const message = error.message ?? "permission_update_failed";
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

  if (
    message === "permission_snapshot_mismatch" ||
    message === "assignment_resolution_conflict"
  ) {
    return NextResponse.json(
      message === "permission_snapshot_mismatch"
        ? {
            code: message,
            currentPermissions: Array.isArray(details.current_permissions)
              ? details.current_permissions
              : [],
          }
        : { code: message, ...details },
      { status: 409 }
    );
  }

  if (error.code === "42501") {
    return NextResponse.json({ code: "access_denied" }, { status: 403 });
  }
  if (error.code === "P0002" || message === "role_not_found") {
    return NextResponse.json({ code: "role_not_found" }, { status: 404 });
  }
  if (error.code === "22023" || error.code === "23514") {
    return NextResponse.json({ code: message }, { status: 400 });
  }

  console.error("[api/roles/[id]/permissions] Guarded RPC failed", {
    code: error.code,
    message,
  });
  return NextResponse.json(
    { code: "permission_update_failed" },
    { status: 500 }
  );
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
  const { id: roleId } = await context.params;
  if (!body || !UUID_PATTERN.test(roleId)) {
    return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  }

  const caller = await findUserByAuth(
    firebaseUser.uid,
    firebaseUser.email,
    "id"
  );
  if (
    !caller ||
    typeof caller.id !== "string" ||
    !UUID_PATTERN.test(caller.id)
  ) {
    return NextResponse.json({ code: "access_denied" }, { status: 403 });
  }

  const db = getServiceRoleClient();
  const { data, error } = await db.rpc("replace_role_permissions_as_system", {
    p_actor_user_id: caller.id,
    p_role_id: roleId,
    p_expected_permissions: body.expectedPermissions,
    p_new_permissions: body.newPermissions,
    p_assignment_resolutions: body.assignmentResolutions,
  });

  if (error) return rpcErrorResponse(error);
  if (
    !isRecord(data) ||
    data.ok !== true ||
    data.role_id !== roleId ||
    !Array.isArray(data.permissions) ||
    typeof data.resolved_assignments !== "number"
  ) {
    console.error("[api/roles/[id]/permissions] Invalid guarded RPC result");
    return NextResponse.json(
      { code: "permission_update_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    roleId,
    permissions: data.permissions,
    resolvedAssignments: data.resolved_assignments,
  });
}
