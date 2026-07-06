import { beforeEach, describe, it, expect } from "vitest";
import {
  ALL_PERMISSIONS,
  getPermissionLabel,
  getModuleLabel,
  getPermissionScopes,
  getActionsForTier,
} from "@/lib/types/permissions";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

const LIVE_CATALOG_PERMISSIONS = [
  "catalog.view",
  "catalog.manage",
  "catalog.import",
  "catalog.stock.adjust",
  "catalog.products.view",
  "catalog.products.manage",
  "catalog.orders.view",
  "catalog.orders.manage",
  "catalog.run_setup",
] as const;

beforeEach(() => {
  usePermissionStore.getState().clear();
  useAuthStore.setState({
    company: null,
    currentUser: null,
    isAuthenticated: false,
  });
});

describe("catalog.run_setup permission registration", () => {
  it("registers the live catalog namespace in ALL_PERMISSIONS", () => {
    // The load-bearing guard: usePermissionStore.fetchPermissions grants
    // account-holders & company-admins exactly the permissions in
    // ALL_PERMISSIONS at scope 'all'. If the DB grants a catalog.* bit but it
    // is absent here, those users' can('catalog.*') returns false.
    for (const permission of LIVE_CATALOG_PERMISSIONS) {
      expect(ALL_PERMISSIONS).toContain(permission);
    }
  });

  it("keeps the dead inventory bits retired, but registers the live one", () => {
    // The catalog refactor retired inventory.view / inventory.import — nothing
    // checks them and role_permissions carries no rows. They stay out so dead
    // toggles can't resurface in the editors.
    for (const permission of ["inventory.view", "inventory.import"]) {
      expect(ALL_PERMISSIONS).not.toContain(permission);
    }
    // inventory.manage however was never actually retired in the product:
    // settings-domains gates SETTINGS › INVENTORY on it, the catalog manage
    // modals gate on it, iOS Inventory* models call can("inventory.manage"),
    // and role_permissions grants it to Admin/Office/Owner (verified live
    // 2026-07-03, BUG BURNDOWN W5). Unregistered, the admin bypass denied it
    // to account holders — hiding the Inventory section from the owner. It is
    // registered as an action of the catalog module (no standalone module).
    expect(ALL_PERMISSIONS).toContain("inventory.manage");
    // Still no standalone inventory module — getModuleLabel falls back to the id.
    expect(getModuleLabel("inventory")).toBe("inventory");
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

  it("resolves every catalog permission for account-holders and company-admins", async () => {
    const cases = [
      {
        company: { accountHolderId: "user-account-holder", adminIds: [] },
        userId: "user-account-holder",
      },
      {
        company: { accountHolderId: "other-user", adminIds: ["user-company-admin"] },
        userId: "user-company-admin",
      },
    ];

    for (const testCase of cases) {
      usePermissionStore.getState().clear();
      useAuthStore.setState({ company: testCase.company as never });

      await usePermissionStore.getState().fetchPermissions(testCase.userId);

      const can = usePermissionStore.getState().can;
      for (const permission of LIVE_CATALOG_PERMISSIONS) {
        expect(can(permission, "all")).toBe(true);
      }
    }
  });
});
