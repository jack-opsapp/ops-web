/**
 * OPS Web — Pure permission-resolution core.
 *
 * The single client-side definition of how a member's effective access is
 * computed from role grants + user_permission_overrides, and how a desired
 * state diffs back into minimal override rows.
 *
 * Semantics are contractual across three implementations that MUST stay in
 * lockstep:
 *   - iOS PermissionService (granted+scope replaces; granted=false removes;
 *     granted=true with null scope is inert),
 *   - the DB functions public.has_permission / private.current_user_scope_for
 *     (migration 20260703120000_permission_overrides_engine),
 *   - this module (permissions-store + the Team member access editor).
 *
 * The admin bypass (account holder ∪ admin_ids ∪ is_company_admin) is decided
 * by isAdminBypass and applied ABOVE this module: admins never resolve through
 * roles or overrides.
 */

import type { PermissionScope } from "@/lib/types/permissions";

export interface RolePermissionInput {
  permission: string;
  scope: PermissionScope;
}

export interface OverrideInput {
  permission: string;
  /** null is legal in the DB; a granted row with null scope is inert. */
  scope: PermissionScope | null;
  granted: boolean;
}

export type ExceptionKind = "added" | "widened" | "narrowed" | "revoked";

export interface MemberException {
  permission: string;
  kind: ExceptionKind;
  /** What the member's role grants (null = role does not grant it). */
  roleScope: PermissionScope | null;
  /** What the member effectively holds (null = no access). */
  effectiveScope: PermissionScope | null;
}

export interface OverrideWrite {
  permission: string;
  scope: PermissionScope | null;
  granted: boolean;
}

export interface OverrideDiff {
  set: OverrideWrite[];
  clear: string[];
}

/** Scope containment rank: all ⊃ assigned ⊃ own. */
const SCOPE_RANK: Record<PermissionScope, number> = { all: 3, assigned: 2, own: 1 };

function widest(a: PermissionScope, b: PermissionScope): PermissionScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/** Role grants as a map, keeping the widest scope should a duplicate ever appear. */
export function roleGrantMap(rolePermissions: RolePermissionInput[]): Map<string, PermissionScope> {
  const map = new Map<string, PermissionScope>();
  for (const rp of rolePermissions) {
    const existing = map.get(rp.permission);
    map.set(rp.permission, existing ? widest(existing, rp.scope) : rp.scope);
  }
  return map;
}

/**
 * Effective access = role grants with overrides applied.
 * An override row is authoritative for its permission (widen or narrow);
 * granted=false removes; granted=true with null scope falls through to role.
 */
export function resolveEffectivePermissions(
  rolePermissions: RolePermissionInput[],
  overrides: OverrideInput[],
): Map<string, PermissionScope> {
  const map = roleGrantMap(rolePermissions);
  for (const o of overrides) {
    if (o.granted) {
      if (o.scope !== null) map.set(o.permission, o.scope);
    } else {
      map.delete(o.permission);
    }
  }
  return map;
}

/**
 * The member's visible deviations from their role — only overrides that
 * actually change effective access are exceptions. Redundant rows (same value
 * as the role), inert null-scope grants, and revokes of never-granted
 * permissions classify as nothing.
 */
export function classifyExceptions(
  rolePermissions: RolePermissionInput[],
  overrides: OverrideInput[],
): MemberException[] {
  const roleMap = roleGrantMap(rolePermissions);
  const exceptions: MemberException[] = [];

  for (const o of overrides) {
    const roleScope = roleMap.get(o.permission) ?? null;

    if (!o.granted) {
      if (roleScope !== null) {
        exceptions.push({ permission: o.permission, kind: "revoked", roleScope, effectiveScope: null });
      }
      continue;
    }

    if (o.scope === null) continue; // inert grant

    if (roleScope === null) {
      exceptions.push({ permission: o.permission, kind: "added", roleScope, effectiveScope: o.scope });
      continue;
    }
    if (o.scope === roleScope) continue; // redundant

    exceptions.push({
      permission: o.permission,
      kind: SCOPE_RANK[o.scope] > SCOPE_RANK[roleScope] ? "widened" : "narrowed",
      roleScope,
      effectiveScope: o.scope,
    });
  }

  return exceptions;
}

/**
 * Write-side inverse: given the role's grants and the full desired state for
 * every permission the editor manages (scope, or null for no access), produce
 * the minimal override rows.
 *
 *   desired == role default → clear (also self-heals redundant legacy rows)
 *   desired null, role grants → set { granted:false }
 *   desired scope ≠ role      → set { granted:true, scope }
 *
 * Permissions absent from `desired` are untouched — unregistered DB strings
 * (e.g. spec.admin) can never be affected by the editor.
 *
 * Law: resolveEffectivePermissions(role, diff.set) == desired for every
 * permission present in `desired`.
 */
export function diffAgainstRole(
  rolePermissions: RolePermissionInput[],
  desired: Map<string, PermissionScope | null>,
): OverrideDiff {
  const roleMap = roleGrantMap(rolePermissions);
  const set: OverrideWrite[] = [];
  const clear: string[] = [];

  for (const [permission, want] of desired) {
    const roleScope = roleMap.get(permission) ?? null;

    if (want === roleScope) {
      clear.push(permission);
      continue;
    }
    if (want === null) {
      set.push({ permission, scope: null, granted: false });
      continue;
    }
    set.push({ permission, scope: want, granted: true });
  }

  return { set, clear };
}

/**
 * Trim a role-derived diff to the minimal write against what is already
 * stored, so a save only touches genuinely-changed rows:
 *   - a `set` row identical to a stored override is dropped,
 *   - a `clear` for a permission with no stored override is dropped,
 *   - `hasChanges` is false when the batch would be a no-op.
 * Keeps the sticky save bar honest and avoids a ~90-row delete every save.
 */
export function computeOverrideMutation(
  existing: OverrideInput[],
  diff: OverrideDiff,
): OverrideDiff & { hasChanges: boolean } {
  const stored = new Map<string, OverrideInput>();
  for (const o of existing) stored.set(o.permission, o);

  const set = diff.set.filter((row) => {
    const prior = stored.get(row.permission);
    if (!prior) return true;
    const priorScope = row.granted ? prior.scope : null;
    const rowScope = row.granted ? row.scope : null;
    return !(prior.granted === row.granted && priorScope === rowScope);
  });

  const clear = diff.clear.filter((permission) => stored.has(permission));

  return { set, clear, hasChanges: set.length > 0 || clear.length > 0 };
}

/**
 * The master bypass, defined once for client display + store resolution.
 * Mirrors private.current_user_is_admin() and public.has_permission() step 1:
 * account holder OR admin_ids member OR is_company_admin flag.
 */
export function isAdminBypass(
  user: { id: string; isCompanyAdmin?: boolean | null },
  company: { accountHolderId?: string | null; adminIds?: string[] | null } | null | undefined,
): boolean {
  if (user.isCompanyAdmin) return true;
  if (!company) return false;
  if (company.accountHolderId && company.accountHolderId === user.id) return true;
  return (company.adminIds ?? []).includes(user.id);
}
