import { describe, it, expect } from "vitest";
import {
  ALL_PERMISSIONS,
  getPermissionLabel,
  getModuleLabel,
  getPermissionScopes,
  getActionsForTier,
} from "@/lib/types/permissions";

describe("catalog.run_setup permission registration", () => {
  it("is present in ALL_PERMISSIONS (or admins/account-holders are silently denied)", () => {
    // The load-bearing guard: usePermissionStore.fetchPermissions grants
    // account-holders & company-admins exactly the permissions in
    // ALL_PERMISSIONS at scope 'all'. If the DB grants catalog.run_setup
    // (migration 0.4) but it is absent here, those users' can('catalog.run_setup')
    // returns false — the wizard's primary audience (the owner) is silently
    // locked out. See client-permission-catalog-sync rule.
    expect(ALL_PERMISSIONS).toContain("catalog.run_setup");
  });

  it("has a real human label, not the id fallback", () => {
    const label = getPermissionLabel("catalog.run_setup");
    expect(label).not.toBe("catalog.run_setup");
    expect(label.length).toBeGreaterThan(0);
  });

  it("belongs to a labeled module", () => {
    // module id 'catalog' must resolve to a real label, not the id fallback
    expect(getModuleLabel("catalog")).not.toBe("catalog");
  });

  it("declares scope 'all' only (company-scoped, no assigned/own variants)", () => {
    expect(getPermissionScopes("catalog.run_setup")).toEqual(["all"]);
  });

  it("is a non-destructive action included in the catalog module's 'manage' and 'full' tiers", () => {
    // run_setup must NOT be treated as destructive (it would drop out of the
    // 'manage' tier and the roles editor would mis-render the catalog module).
    expect(getActionsForTier("catalog", "manage")).toContain("catalog.run_setup");
    expect(getActionsForTier("catalog", "full")).toContain("catalog.run_setup");
  });
});
