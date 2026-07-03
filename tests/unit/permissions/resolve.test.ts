/**
 * Pure permission-resolution core — the single definition of how a member's
 * effective access is computed from role grants + user_permission_overrides.
 *
 * Contract (normative, mirrors shipped iOS PermissionService semantics and the
 * override-aware DB functions in 20260703120000_permission_overrides_engine.sql):
 *   1. Role grants seed the map (widest scope wins defensively).
 *   2. An override row is authoritative for its permission:
 *      granted=true  + scope        → that scope (widen OR narrow vs role)
 *      granted=true  + scope=null   → ignored (falls through to role)
 *      granted=false                → permission removed (revoke)
 *   3. Admin bypass (account holder ∪ admin_ids ∪ is_company_admin) is decided
 *      by isAdminBypass and handled ABOVE this module — resolver never sees it.
 *
 * diffAgainstRole is the write-side inverse: desired state → minimal override
 * rows ({set, clear}) such that resolve(role, rows) == desired, and anything
 * matching the role default is cleared (self-healing for redundant legacy rows).
 */

import { describe, expect, it } from "vitest";
import {
  classifyExceptions,
  diffAgainstRole,
  isAdminBypass,
  resolveEffectivePermissions,
  type OverrideInput,
  type RolePermissionInput,
} from "@/lib/permissions/resolve";

const role = (...rows: [string, "all" | "assigned" | "own"][]): RolePermissionInput[] =>
  rows.map(([permission, scope]) => ({ permission, scope }));

const ov = (
  permission: string,
  granted: boolean,
  scope: "all" | "assigned" | "own" | null = null,
): OverrideInput => ({ permission, granted, scope });

describe("resolveEffectivePermissions", () => {
  it("returns role grants untouched when there are no overrides", () => {
    const result = resolveEffectivePermissions(
      role(["projects.view", "assigned"], ["tasks.view", "all"]),
      [],
    );
    expect(result.get("projects.view")).toBe("assigned");
    expect(result.get("tasks.view")).toBe("all");
    expect(result.size).toBe(2);
  });

  it("adds a permission the role does not grant (granted=true + scope)", () => {
    const result = resolveEffectivePermissions(role(["projects.view", "assigned"]), [
      ov("estimates.view", true, "all"),
    ]);
    expect(result.get("estimates.view")).toBe("all");
    expect(result.get("projects.view")).toBe("assigned");
  });

  it("widens a role grant (assigned → all)", () => {
    const result = resolveEffectivePermissions(role(["projects.edit", "assigned"]), [
      ov("projects.edit", true, "all"),
    ]);
    expect(result.get("projects.edit")).toBe("all");
  });

  it("narrows a role grant (all → own) — override is authoritative", () => {
    const result = resolveEffectivePermissions(role(["expenses.view", "all"]), [
      ov("expenses.view", true, "own"),
    ]);
    expect(result.get("expenses.view")).toBe("own");
  });

  it("revokes a role grant (granted=false)", () => {
    const result = resolveEffectivePermissions(role(["expenses.view", "all"]), [
      ov("expenses.view", false),
    ]);
    expect(result.has("expenses.view")).toBe(false);
  });

  it("ignores granted=true with null scope (iOS parity)", () => {
    const result = resolveEffectivePermissions(role(["projects.view", "assigned"]), [
      ov("projects.view", true, null),
    ]);
    expect(result.get("projects.view")).toBe("assigned");
  });

  it("a revoke for a permission the role never granted is a no-op", () => {
    const result = resolveEffectivePermissions(role(["projects.view", "all"]), [
      ov("estimates.view", false),
    ]);
    expect(result.has("estimates.view")).toBe(false);
    expect(result.size).toBe(1);
  });

  it("keeps the widest scope if role rows ever duplicate a permission (defensive)", () => {
    const result = resolveEffectivePermissions(
      [
        { permission: "tasks.view", scope: "own" },
        { permission: "tasks.view", scope: "all" },
        { permission: "tasks.view", scope: "assigned" },
      ],
      [],
    );
    expect(result.get("tasks.view")).toBe("all");
  });
});

describe("classifyExceptions", () => {
  it("returns an empty list when overrides do not deviate from the role", () => {
    expect(classifyExceptions(role(["projects.view", "all"]), [])).toEqual([]);
    // Redundant row (same value as role) is not a visible exception.
    expect(
      classifyExceptions(role(["projects.view", "all"]), [ov("projects.view", true, "all")]),
    ).toEqual([]);
    // Null-scope grant is inert.
    expect(
      classifyExceptions(role(["projects.view", "all"]), [ov("projects.view", true, null)]),
    ).toEqual([]);
    // Revoke of something the role never granted is inert.
    expect(classifyExceptions(role(), [ov("estimates.view", false)])).toEqual([]);
  });

  it("classifies added / widened / narrowed / revoked", () => {
    const exceptions = classifyExceptions(
      role(["projects.edit", "assigned"], ["expenses.view", "all"], ["invoices.view", "all"]),
      [
        ov("estimates.view", true, "all"), // added
        ov("projects.edit", true, "all"), // widened
        ov("expenses.view", true, "own"), // narrowed
        ov("invoices.view", false), // revoked
      ],
    );
    const byPerm = Object.fromEntries(exceptions.map((e) => [e.permission, e]));
    expect(byPerm["estimates.view"]).toMatchObject({
      kind: "added",
      roleScope: null,
      effectiveScope: "all",
    });
    expect(byPerm["projects.edit"]).toMatchObject({
      kind: "widened",
      roleScope: "assigned",
      effectiveScope: "all",
    });
    expect(byPerm["expenses.view"]).toMatchObject({
      kind: "narrowed",
      roleScope: "all",
      effectiveScope: "own",
    });
    expect(byPerm["invoices.view"]).toMatchObject({
      kind: "revoked",
      roleScope: "all",
      effectiveScope: null,
    });
    expect(exceptions).toHaveLength(4);
  });
});

describe("diffAgainstRole", () => {
  it("produces no writes when desired matches the role exactly", () => {
    const rolePerms = role(["projects.view", "all"], ["tasks.view", "assigned"]);
    const desired = new Map<string, "all" | "assigned" | "own" | null>([
      ["projects.view", "all"],
      ["tasks.view", "assigned"],
    ]);
    const diff = diffAgainstRole(rolePerms, desired);
    expect(diff.set).toEqual([]);
    // Matching-the-role entries are cleared so redundant legacy rows self-heal.
    expect(diff.clear.sort()).toEqual(["projects.view", "tasks.view"]);
  });

  it("emits grant rows for additions and scope changes, revoke rows for removals", () => {
    const rolePerms = role(
      ["projects.edit", "assigned"],
      ["expenses.view", "all"],
      ["invoices.view", "all"],
    );
    const desired = new Map<string, "all" | "assigned" | "own" | null>([
      ["projects.edit", "all"], // widen
      ["expenses.view", "own"], // narrow
      ["invoices.view", null], // revoke
      ["estimates.view", "all"], // add
    ]);
    const diff = diffAgainstRole(rolePerms, desired);
    expect(diff.set).toEqual(
      expect.arrayContaining([
        { permission: "projects.edit", scope: "all", granted: true },
        { permission: "expenses.view", scope: "own", granted: true },
        { permission: "invoices.view", scope: null, granted: false },
        { permission: "estimates.view", scope: "all", granted: true },
      ]),
    );
    expect(diff.set).toHaveLength(4);
    expect(diff.clear).toEqual([]);
  });

  it("clears a no-access permission the role also lacks (idempotent cleanup)", () => {
    const diff = diffAgainstRole(role(["projects.view", "all"]), new Map([["estimates.view", null]]));
    expect(diff.set).toEqual([]);
    expect(diff.clear).toEqual(["estimates.view"]);
  });

  it("round-trips: resolve(role, diff(role, desired).set) == desired", () => {
    const rolePerms = role(
      ["projects.view", "all"],
      ["projects.edit", "assigned"],
      ["tasks.view", "assigned"],
      ["expenses.view", "all"],
    );
    const desired = new Map<string, "all" | "assigned" | "own" | null>([
      ["projects.view", "all"], // unchanged
      ["projects.edit", "all"], // widened
      ["tasks.view", null], // revoked
      ["expenses.view", "own"], // narrowed
      ["estimates.view", "assigned"], // added
    ]);
    const diff = diffAgainstRole(rolePerms, desired);
    const effective = resolveEffectivePermissions(
      rolePerms,
      diff.set.map((s) => ({ permission: s.permission, scope: s.scope, granted: s.granted })),
    );
    for (const [permission, scope] of desired) {
      if (scope === null) expect(effective.has(permission)).toBe(false);
      else expect(effective.get(permission)).toBe(scope);
    }
  });
});

describe("isAdminBypass", () => {
  const company = { accountHolderId: "u-holder", adminIds: ["u-admin1", "u-admin2"] };

  it("true for the account holder", () => {
    expect(isAdminBypass({ id: "u-holder" }, company)).toBe(true);
  });

  it("true for admin_ids members", () => {
    expect(isAdminBypass({ id: "u-admin2" }, company)).toBe(true);
  });

  it("true for the is_company_admin flag (server parity)", () => {
    expect(isAdminBypass({ id: "u-x", isCompanyAdmin: true }, company)).toBe(true);
  });

  it("false for a regular member, null company, or missing fields", () => {
    expect(isAdminBypass({ id: "u-x" }, company)).toBe(false);
    expect(isAdminBypass({ id: "u-x" }, null)).toBe(false);
    expect(isAdminBypass({ id: "u-x", isCompanyAdmin: false }, { accountHolderId: null, adminIds: undefined })).toBe(false);
  });
});
