/**
 * Atomic per-member permission override replacement.
 *
 * Web and iOS share this exact optimistic contract. The service-only RPC
 * applies the override diff and any required lead-responsibility transfers in
 * one transaction, so reducing access can never leave an assigned lead hidden
 * from its owner.
 */

import { NextRequest, NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  PERMISSION_EDITOR_REGISTRY,
  type PermissionScope,
} from "@/lib/types/permissions";

interface OverrideEntry {
  permission: string;
  scope: PermissionScope | null;
  granted: boolean;
}

interface AssignmentResolution {
  opportunity_id: string;
  expected_assigned_to: string;
  expected_assignment_version: number;
  new_assigned_to: string | null;
}

interface GuardedRequestBody {
  expectedOverrides: OverrideEntry[];
  set: OverrideEntry[];
  clear: string[];
  assignmentResolutions: AssignmentResolution[];
}

interface RpcError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

const BODY_KEYS = [
  "assignmentResolutions",
  "clear",
  "expectedOverrides",
  "set",
] as const;
const OVERRIDE_KEYS = ["granted", "permission", "scope"] as const;
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

function validateExpectedOverrides(value: unknown): value is OverrideEntry[] {
  if (!Array.isArray(value)) return false;

  let previous = "";
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, OVERRIDE_KEYS) ||
      typeof item.permission !== "string" ||
      item.permission.length === 0 ||
      !(
        item.scope === null ||
        (typeof item.scope === "string" && item.scope.length > 0)
      ) ||
      typeof item.granted !== "boolean" ||
      item.permission <= previous
    ) {
      return false;
    }
    previous = item.permission;
  }
  return true;
}

function validateSet(value: unknown): value is OverrideEntry[] {
  if (!Array.isArray(value)) return false;
  const registry = new Map(
    PERMISSION_EDITOR_REGISTRY.map((action) => [action.id, action.scopes])
  );
  let previous = "";

  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, OVERRIDE_KEYS) ||
      typeof item.permission !== "string" ||
      item.permission <= previous ||
      typeof item.granted !== "boolean"
    ) {
      return false;
    }
    const scopes = registry.get(item.permission);
    if (!scopes) return false;
    if (item.granted) {
      if (
        typeof item.scope !== "string" ||
        !scopes.includes(item.scope as PermissionScope)
      ) {
        return false;
      }
    } else if (item.scope !== null) {
      return false;
    }
    previous = item.permission;
  }
  return true;
}

function validateClear(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const registered = new Set(
    PERMISSION_EDITOR_REGISTRY.map((action) => action.id)
  );
  let previous = "";
  for (const permission of value) {
    if (
      typeof permission !== "string" ||
      !registered.has(permission) ||
      permission <= previous
    ) {
      return false;
    }
    previous = permission;
  }
  return true;
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
    !validateExpectedOverrides(value.expectedOverrides) ||
    !validateSet(value.set) ||
    !validateClear(value.clear) ||
    !validateAssignmentResolutions(value.assignmentResolutions)
  ) {
    return null;
  }

  const setPermissions = new Set(value.set.map((entry) => entry.permission));
  if (value.clear.some((permission) => setPermissions.has(permission))) {
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
  if (message === "permission_snapshot_mismatch") {
    return NextResponse.json(
      {
        code: message,
        currentOverrides: Array.isArray(details.current_overrides)
          ? details.current_overrides
          : [],
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
  if (error.code === "P0002" || message === "target_user_not_found") {
    return NextResponse.json(
      { code: "target_user_not_found" },
      { status: 404 }
    );
  }
  if (error.code === "22023" || error.code === "23514") {
    return NextResponse.json({ code: message }, { status: 400 });
  }

  console.error("[api/users/[id]/permission-overrides] Guarded RPC failed", {
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
  const { id: targetUserId } = await context.params;
  if (!body || !UUID_PATTERN.test(targetUserId)) {
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
  const { data, error } = await db.rpc(
    "apply_user_permission_overrides_as_system",
    {
      p_actor_user_id: caller.id,
      p_target_user_id: targetUserId,
      p_expected_overrides: body.expectedOverrides,
      p_set: body.set,
      p_clear: body.clear,
      p_assignment_resolutions: body.assignmentResolutions,
    }
  );

  if (error) return rpcErrorResponse(error);
  if (
    !isRecord(data) ||
    data.ok !== true ||
    data.user_id !== targetUserId ||
    !Array.isArray(data.overrides) ||
    typeof data.resolved_assignments !== "number"
  ) {
    console.error(
      "[api/users/[id]/permission-overrides] Invalid guarded RPC result"
    );
    return NextResponse.json(
      { code: "permission_update_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    userId: targetUserId,
    overrides: data.overrides,
    resolvedAssignments: data.resolved_assignments,
  });
}
